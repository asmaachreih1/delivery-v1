// ============================================================
// backend/services/store.js
// ============================================================
// In-memory data store for delivery runs and driver location.
//
// WHY IN-MEMORY INSTEAD OF A REAL DATABASE?
//   For V1, this keeps the setup simple — no database server to
//   configure, no connection strings, no migrations. The app works
//   out of the box.
//
// IMPORTANT LIMITATION ON VERCEL:
//   Vercel runs the backend as a "serverless function". Each request
//   may spin up a fresh Node.js process, which means this Map() could
//   reset between requests in production. For V1 demos and development
//   this is acceptable. V2 will replace this with a real Postgres DB.
//
//   If you want persistence now, add a free Vercel Postgres database
//   and update the save/get functions to use SQL queries.
//
// DATA STORED:
//   - runs: Map of delivery run objects, keyed by UUID
//   - driverLocation: the most recent GPS position from the driver's phone
//
// All functions are synchronous (no async needed — it's just a Map).
// ============================================================

// Module-level Map — persists across multiple requests within the
// SAME serverless function instance (but resets on cold starts)
const runs = new Map();

// Stores only the single most recent driver GPS position
// (we don't need history in V1, just "where is the driver right now")
let driverLocation = null;

// ── Run operations ────────────────────────────────────────────

/**
 * Save a new delivery run to the store.
 * The run object comes fully built from routes/runs.js —
 * this function just stores it and returns it back.
 *
 * @param {object} run - The complete run object including id, route, alerts, etc.
 * @returns {object} The same run object (for chaining convenience)
 */
function saveRun(run) {
  runs.set(run.id, run);
  return run;
}

/**
 * Retrieve a delivery run by its UUID.
 * Returns null if the run doesn't exist (so the route handler
 * can return a 404 response).
 *
 * @param {string} id - UUID of the run
 * @returns {object|null}
 */
function getRun(id) {
  return runs.get(id) || null;
}

/**
 * Apply partial updates to a run.
 * Used internally — prefer updateStop() for most operations.
 *
 * @param {string} id - UUID of the run
 * @param {object} updates - Key/value pairs to merge into the run
 * @returns {object|null} Updated run, or null if not found
 */
function updateRun(id, updates) {
  const run = runs.get(id);
  if (!run) return null;
  const updated = { ...run, ...updates, updatedAt: new Date().toISOString() };
  runs.set(id, updated);
  return updated;
}

/**
 * Mark a specific stop as delivered.
 *
 * This is called when the driver taps "Mark Delivered" on a stop card.
 * It updates just that stop's status within the run's route array,
 * then checks if ALL stops are now delivered — if so, marks the whole
 * run as complete.
 *
 * @param {string} runId    - UUID of the run
 * @param {number} stopIndex - 0-based index of the stop within stops array
 * @param {object} updates  - Extra fields to merge into the stop (deliveredAt, etc.)
 * @returns {object|null} Updated run, or null if run not found
 */
function updateStop(runId, stopIndex, updates) {
  const run = runs.get(runId);
  if (!run) return null;

  // Map over the route array — only modify the stop with the matching stopIndex
  // Leave all other stops unchanged (immutable update pattern)
  const newRoute = run.route.map(stop =>
    stop.stopIndex === stopIndex ? { ...stop, ...updates } : stop
  );

  // Check if every stop in the route is now delivered
  const allDelivered = newRoute.every(s => s.status === 'delivered');

  const updated = {
    ...run,
    route:       newRoute,
    // Set completedAt timestamp only if all stops are done
    completedAt: allDelivered ? new Date().toISOString() : null,
    // runStatus drives what the frontend shows ('active' | 'complete')
    runStatus:   allDelivered ? 'complete' : 'active',
    updatedAt:   new Date().toISOString(),
  };

  runs.set(runId, updated);
  return updated;
}

/**
 * List all runs, sorted newest first.
 * Used by GET /api/run to show recent history.
 *
 * @returns {object[]} Array of run objects
 */
function listRuns() {
  return Array.from(runs.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
}

// ── Driver location operations ────────────────────────────────

/**
 * Save the driver's latest GPS position.
 *
 * Called every 5 seconds from the frontend's useGPS hook.
 * We only ever store the MOST RECENT position — old positions
 * are simply overwritten. We don't need history for V1.
 *
 * @param {{ lat, lng, accuracy }} loc - GPS coordinates from phone browser
 * @returns {object} The saved location with a server-side timestamp
 */
function saveLocation(loc) {
  driverLocation = { ...loc, timestamp: new Date().toISOString() };
  return driverLocation;
}

/**
 * Retrieve the driver's most recent GPS position.
 * Returns null if the driver hasn't sent any location yet
 * (e.g. they haven't granted GPS permission yet).
 *
 * Called by GET /api/location — the frontend polls this every 5
 * seconds to update the driver's dot on the map.
 *
 * @returns {{ lat, lng, accuracy, timestamp }|null}
 */
function getLocation() {
  return driverLocation;
}

module.exports = { saveRun, getRun, updateRun, updateStop, listRuns, saveLocation, getLocation };
