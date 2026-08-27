// ============================================================
// frontend/src/utils/api.js
// ============================================================
// Centralised API client — all backend calls go through here.
//
// WHY CENTRALISE API CALLS?
//   If the backend URL changes, or we need to add auth headers,
//   or we want to log all requests — we only change ONE file.
//   Components just call api.startRun(...) without knowing anything
//   about URLs, HTTP methods, or JSON parsing.
//
// VITE_API_URL:
//   In local development, this is empty — Vite's dev server
//   proxies /api/* requests to localhost:3001 automatically
//   (configured in vite.config.js). In production on Vercel,
//   it's also empty because frontend and backend share the same
//   domain. Only set it if you host them on separate domains.
//
// ERROR HANDLING:
//   If the server returns a non-2xx status, we read the error
//   message from the JSON body and throw it as a JS Error.
//   Components catch this with try/catch and show it to the user.
// ============================================================

// Base URL prefix — empty string means "same domain as the frontend"
const BASE = import.meta.env.VITE_API_URL || '';

/**
 * Generic HTTP request helper.
 * Handles JSON serialisation, response parsing, and error throwing.
 *
 * @param {'GET'|'POST'|'PATCH'} method - HTTP method
 * @param {string} path   - API path, e.g. '/api/run/start'
 * @param {object} [body] - Request body (serialised to JSON if provided)
 * @returns {Promise<object|null>}
 *   Parsed JSON response, or null for HTTP 204 (No Content) responses.
 * @throws {Error} with the server's error message if request fails
 */
async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    // Only set Content-Type header when we're sending a body
    // (GET requests must not have a Content-Type header)
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body:    body ? JSON.stringify(body) : undefined,
  });

  // 204 No Content — server has nothing to return (e.g. no driver location yet)
  if (res.status === 204) return null;

  // Parse the response as JSON, fall back to a generic error if it's not valid JSON
  const data = await res.json().catch(() => ({ error: 'Invalid server response' }));

  // Treat any non-2xx status as an error
  if (!res.ok) {
    throw new Error(data.error || `Server error ${res.status}`);
  }

  return data;
}

// ── API methods ───────────────────────────────────────────────
// One method per endpoint. Named clearly so calling code reads naturally.

export const api = {

  /**
   * POST /api/run/start
   * Start a new delivery run. This triggers the full pipeline:
   * geocoding → travel time matrix → TSPTW algorithm → stored run.
   *
   * @param {object} payload - { restaurant, stops, departureTime }
   * @returns {object} The complete run object with route and alerts
   */
  startRun: (payload) => request('POST', '/api/run/start', payload),

  /**
   * GET /api/run/:id
   * Retrieve the current state of a delivery run.
   * Used on page refresh to restore the active run from the server.
   *
   * @param {string} id - UUID of the run
   * @returns {object} Run object
   */
  getRun: (id) => request('GET', `/api/run/${id}`),

  /**
   * PATCH /api/run/:id/stop/:stopIndex/deliver
   * Mark a stop as delivered when the driver taps the button.
   * Backend updates the stop status and returns the full updated run.
   *
   * @param {string} runId     - UUID of the run
   * @param {number} stopIndex - 0-based index of the stop
   * @returns {object} Updated run object
   */
  markDelivered: (runId, stopIndex) =>
    request('PATCH', `/api/run/${runId}/stop/${stopIndex}/deliver`),

  /**
   * POST /api/location
   * Send driver's current GPS coordinates to the server.
   * Called by useGPS hook approximately every 5 seconds.
   *
   * @param {number} lat      - Latitude decimal degrees
   * @param {number} lng      - Longitude decimal degrees
   * @param {number} accuracy - GPS accuracy radius in metres (optional)
   */
  postLocation: (lat, lng, accuracy) =>
    request('POST', '/api/location', { lat, lng, accuracy }),

  /**
   * GET /api/location
   * Get the driver's most recent GPS position from the server.
   * Returns null if no position has been recorded yet (HTTP 204).
   *
   * @returns {{ lat, lng, accuracy, timestamp }|null}
   */
  getLocation: () => request('GET', '/api/location'),

  /**
   * GET /api/location/autocomplete?q=...
   * Get address suggestions as the driver types in the address field.
   *
   * @param {string} q - Partial address string (min 3 characters)
   * @returns {Array<{ label, lat, lng }>} Up to 5 suggestions
   */
  autocomplete: (q) => request('GET', `/api/location/autocomplete?q=${encodeURIComponent(q)}`),
};
