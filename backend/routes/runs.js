// ============================================================
// backend/routes/runs.js
// ============================================================
// Express Router for all delivery run endpoints.
//
// A "run" is one delivery session — the driver leaves the restaurant
// with N orders, delivers them all, and the run is complete.
//
// ENDPOINTS:
//   POST   /api/run/start              — Create a new run (main entry point)
//   GET    /api/run/:id                — Get current state of a run
//   GET    /api/run                    — List recent runs
//   PATCH  /api/run/:id/stop/:n/deliver — Mark a stop as delivered
//
// FLOW for POST /api/run/start:
//   1. Validate the request body
//   2. Geocode all addresses → GPS coordinates
//   3. Fetch travel time matrix (real road times with traffic)
//   4. Run the TSPTW brute force solver
//   5. Save the result to the store
//   6. Return the full run object to the frontend
// ============================================================

const express            = require('express');
const { v4: uuidv4 }     = require('uuid');                 // generates unique run IDs
const { body, param, validationResult } = require('express-validator'); // input validation
const { geocodeAll, getTravelTimeMatrix } = require('../services/ors');
const { solve }          = require('../services/tsptw');
const store              = require('../services/store');

const router = express.Router();

// ── Validation helper ─────────────────────────────────────────
// express-validator collects validation errors during middleware.
// This helper checks for those errors and returns a 400 response
// if any exist, stopping the request before the main handler runs.
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Return only the first error message for simplicity
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next(); // no errors — continue to the route handler
}

// ══════════════════════════════════════════════════════════════
// POST /api/run/start
// ══════════════════════════════════════════════════════════════
// Creates a new delivery run. This is the main algorithm endpoint.
//
// Request body example:
// {
//   "restaurant": { "address": "Achrafieh, Beirut" },
//   "stops": [
//     {
//       "name": "Ahmad",
//       "address": "Hamra, Beirut",
//       "windowOpen": "12:15",
//       "windowClose": "12:45"
//     },
//     {
//       "name": "Sara",
//       "address": "Verdun, Beirut",
//       "windowOpen": "12:30",
//       "windowClose": "13:00"
//     }
//   ],
//   "departureTime": "12:00"
// }
router.post(
  '/start',
  // ── Input validation rules ────────────────────────────────
  // express-validator checks these BEFORE the async handler runs
  [
    body('restaurant')
      .exists().withMessage('restaurant is required'),
    body('stops')
      .isArray({ min: 1, max: 10 }).withMessage('stops must be an array of 1–10 items'),
    body('stops.*.address')
      .notEmpty().withMessage('Each stop must have an address'),
    body('stops.*.windowOpen')
      .matches(/^\d{2}:\d{2}$/).withMessage('windowOpen must be HH:MM format'),
    body('stops.*.windowClose')
      .matches(/^\d{2}:\d{2}$/).withMessage('windowClose must be HH:MM format'),
    body('departureTime')
      .notEmpty().withMessage('departureTime is required'),
  ],
  validate, // runs the validation check, returns 400 if anything failed
  async (req, res, next) => {
    try {
      const { restaurant, stops, departureTime } = req.body;

      // ── Extra validation: time window logic ───────────────
      // express-validator checks format but not logical consistency.
      // We manually check that windowClose > windowOpen for each stop.
      for (let i = 0; i < stops.length; i++) {
        const { windowOpen, windowClose } = stops[i];
        if (windowClose <= windowOpen) {
          return res.status(400).json({
            error: `Stop ${i + 1}: windowClose (${windowClose}) must be after windowOpen (${windowOpen})`,
          });
        }
      }

      // ── Parse departure time ──────────────────────────────
      // Support two formats:
      //   'HH:MM' — time only (e.g. "12:00") → treated as today at that time
      //   ISO string — full datetime (e.g. "2024-03-15T12:00:00") → used as-is
      let departure;
      if (/^\d{2}:\d{2}$/.test(departureTime)) {
        // Parse as today at the specified time
        const today  = new Date();
        const [h, m] = departureTime.split(':').map(Number);
        departure    = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, 0);
      } else {
        departure = new Date(departureTime);
      }

      if (isNaN(departure.getTime())) {
        return res.status(400).json({ error: 'Invalid departureTime' });
      }

      // ── Step 1: Geocode all addresses ──────────────────────
      // Convert address strings to { lat, lng } coordinates.
      // If the restaurant already has coordinates (lat/lng provided),
      // skip geocoding it (saves an API call).
      let restaurantCoords;

      if (restaurant.lat && restaurant.lng) {
        // Coordinates already provided — use them directly
        restaurantCoords = {
          lat:   restaurant.lat,
          lng:   restaurant.lng,
          label: restaurant.address || 'Restaurant',
        };
      }

      // Build a flat list of addresses to geocode in parallel
      // We include the restaurant only if we don't already have its coords
      const allToGeocode = [
        ...(restaurantCoords ? [] : [{ type: 'restaurant', address: restaurant.address }]),
        ...stops.map((s, i) => ({ type: 'stop', index: i, address: s.address })),
      ];

      // Geocode all at once (parallel — much faster than sequential)
      const geocoded = await geocodeAll(allToGeocode.map(a => a.address));

      // Assign geocoding results back to the right variables
      let geoIdx = 0;
      if (!restaurantCoords) {
        restaurantCoords = geocoded[geoIdx++];
      }

      // Merge lat/lng into each stop object
      const stopsWithCoords = stops.map((stop, i) => ({
        ...stop,
        lat:   geocoded[geoIdx + i]?.lat,
        lng:   geocoded[geoIdx + i]?.lng,
        label: geocoded[geoIdx + i]?.label,
      }));

      // ── Step 2: Fetch travel time matrix ───────────────────
      // Points array: restaurant first, then stops in order.
      // ORS returns an NxN matrix where index 0 = restaurant,
      // index 1 = stop 0, index 2 = stop 1, etc.
      const points = [restaurantCoords, ...stopsWithCoords];
      const matrix = await getTravelTimeMatrix(points);

      // ── Step 3: Run the TSPTW solver ──────────────────────
      // This is the core algorithm call. It returns:
      //   - status: 'ok' | 'warning' | 'infeasible'
      //   - route: ordered array of stops with ETAs
      //   - alerts: any yellow or red alerts
      //   - diagnosis: conflict details if infeasible
      const result = solve(stopsWithCoords, matrix, departure);

      // ── Step 4: Save the run ───────────────────────────────
      // Merge the algorithm result with run metadata and store it.
      const run = store.saveRun({
        id:         uuidv4(),   // unique ID for this run
        runStatus:  result.status === 'infeasible' ? 'infeasible' : 'active',
        createdAt:  new Date().toISOString(),
        updatedAt:  new Date().toISOString(),
        completedAt: null,
        departureTime: departure.toISOString(),
        restaurant: restaurantCoords,
        stops:      stopsWithCoords,
        matrix,    // stored in case we need it for debugging
        ...result, // spread in: status, route, alerts, diagnosis, totalMinutes, etc.
      });

      // Return the complete run object — frontend uses this to render the UI
      res.status(201).json(run);

    } catch (err) {
      // ── Error handling ─────────────────────────────────────
      // Catch specific error types and return appropriate HTTP codes.
      // Everything else falls through to the global error handler.

      if (err.message?.includes('Address not found') || err.message?.includes('geocod')) {
        // Address couldn't be geocoded — driver needs to correct it
        return res.status(422).json({ error: err.message });
      }
      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        // ORS API didn't respond in time
        return res.status(503).json({ error: 'Maps service timeout. Please try again.' });
      }
      next(err); // unknown error — pass to global handler in index.js
    }
  }
);

// ══════════════════════════════════════════════════════════════
// GET /api/run/:id
// ══════════════════════════════════════════════════════════════
// Returns the current state of a delivery run.
// The frontend can poll this to sync state if needed,
// though in V1 it mainly uses local state and only calls this
// on initial load or page refresh.
router.get(
  '/:id',
  [param('id').isUUID().withMessage('Invalid run ID')],
  validate,
  (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json(run);
  }
);

// ══════════════════════════════════════════════════════════════
// GET /api/run
// ══════════════════════════════════════════════════════════════
// Returns up to 20 most recent runs.
// Useful for a dispatcher view or debugging.
router.get('/', (req, res) => {
  res.json(store.listRuns().slice(0, 20));
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/run/:id/stop/:stopIndex/deliver
// ══════════════════════════════════════════════════════════════
// Marks a specific stop as delivered.
// Called when the driver taps "Mark Delivered" on a stop card.
//
// :stopIndex is the 0-based index of the stop in the stops array
// (NOT the position/display number shown to the driver).
router.patch(
  '/:id/stop/:stopIndex/deliver',
  [
    param('id').isUUID().withMessage('Invalid run ID'),
    param('stopIndex').isInt({ min: 0 }).withMessage('Invalid stop index'),
  ],
  validate,
  (req, res) => {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    // Can't deliver on a run that never had a valid route
    if (run.runStatus === 'infeasible') {
      return res.status(400).json({ error: 'Cannot deliver on an infeasible run' });
    }

    const stopIndex = parseInt(req.params.stopIndex);

    // Verify the stop exists in this run's route
    const stop = run.route.find(s => s.stopIndex === stopIndex);
    if (!stop) return res.status(404).json({ error: 'Stop not found' });

    // Update the stop with delivered status and actual delivery time
    const updated = store.updateStop(run.id, stopIndex, {
      status:             'delivered',
      deliveredAt:        new Date().toISOString(),
      actualDeliveryTime: new Date().toTimeString().slice(0, 5), // "HH:MM"
    });

    // Return the full updated run so the frontend can re-render
    res.json(updated);
  }
);

module.exports = router;
