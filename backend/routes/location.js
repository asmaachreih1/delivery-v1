// ============================================================
// backend/routes/location.js
// ============================================================
// Express Router for driver GPS location and address autocomplete.
//
// ENDPOINTS:
//   POST /api/location                 — Receive driver GPS from phone
//   GET  /api/location                 — Return latest driver position
//   GET  /api/location/autocomplete?q= — Address suggestions while typing
//
// HOW LIVE TRACKING WORKS IN V1:
//   1. The driver opens the web app on their phone browser
//   2. The browser asks for location permission (one-time prompt)
//   3. The frontend's useGPS hook calls navigator.geolocation.watchPosition()
//   4. Every time the phone updates its GPS position, the hook fires
//   5. The hook POSTs { lat, lng, accuracy } to this endpoint
//   6. The frontend also polls GET /api/location every 5 seconds
//      to update the driver's dot on the map
//
// In V2, this is replaced by the FMC920 IoT device which POSTs
// directly to the server over 4G, independent of the phone browser.
// ============================================================

const express  = require('express');
const { body, query, validationResult } = require('express-validator');
const { autocomplete } = require('../services/ors');
const store    = require('../services/store');

const router = express.Router();

// Reusable validation error handler
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
}

// ══════════════════════════════════════════════════════════════
// POST /api/location
// ══════════════════════════════════════════════════════════════
// Receives the driver's current GPS coordinates from the phone.
//
// Called by the frontend useGPS hook approximately every 5 seconds
// while the driver is on the Route screen.
//
// Request body: { lat: number, lng: number, accuracy?: number }
//   - lat/lng: decimal degrees from navigator.geolocation
//   - accuracy: radius in metres (optional, from the browser API)
//     Lower accuracy value = more precise (e.g. 5m is better than 50m)
router.post(
  '/',
  [
    body('lat').isFloat({ min: -90,  max: 90  }).withMessage('Invalid latitude'),
    body('lng').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  ],
  validate,
  (req, res) => {
    const { lat, lng, accuracy } = req.body;
    // Store overwrites the previous position — we only care about "right now"
    const loc = store.saveLocation({ lat, lng, accuracy: accuracy || null });
    res.json(loc); // return the saved location with server timestamp
  }
);

// ══════════════════════════════════════════════════════════════
// GET /api/location
// ══════════════════════════════════════════════════════════════
// Returns the driver's most recent GPS position.
//
// Polled by the frontend map every 5 seconds to move the driver dot.
// Returns HTTP 204 (No Content) if the driver hasn't sent a location
// yet (e.g. GPS permission not yet granted, or driver just opened app).
//
// 204 is better than returning an error — it means "everything is
// fine, there's just nothing to return yet". The frontend handles it
// gracefully by leaving the driver dot off the map.
router.get('/', (req, res) => {
  const loc = store.getLocation();
  if (!loc) return res.status(204).send(); // no location yet
  res.json(loc);
});

// ══════════════════════════════════════════════════════════════
// GET /api/location/autocomplete?q=partial+address
// ══════════════════════════════════════════════════════════════
// Returns address suggestions for the address input field.
//
// Called by the AddressInput component as the driver types.
// The frontend debounces calls to this endpoint (350ms delay)
// to avoid spamming the API on every keystroke.
//
// Example: GET /api/location/autocomplete?q=Hamra
// Returns: [
//   { label: "Hamra Street, Beirut, Lebanon", lat: 33.89, lng: 35.48 },
//   { label: "Hamra, Tripoli, Lebanon", lat: 34.43, lng: 35.85 },
//   ...
// ]
router.get(
  '/autocomplete',
  [query('q').notEmpty().withMessage('q query parameter is required')],
  validate,
  async (req, res, next) => {
    try {
      const suggestions = await autocomplete(req.query.q);
      res.json(suggestions);
    } catch (err) {
      next(err); // pass to global error handler
    }
  }
);

module.exports = router;
