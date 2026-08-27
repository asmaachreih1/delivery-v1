// ============================================================
// backend/services/ors.js
// ============================================================
// OpenRouteService (ORS) API wrapper.
//
// OpenRouteService is a free, open-source routing engine built
// on OpenStreetMap data. We use three of its APIs:
//
//   1. Geocoding API — converts a text address into GPS coordinates
//      Example: "123 Main St, Beirut" → { lat: 33.88, lng: 35.50 }
//
//   2. Matrix API — given a list of GPS points, returns a table
//      of real road travel times (in seconds) between every pair.
//      This is what makes the algorithm traffic-aware. One call
//      gives us all the data the TSPTW solver needs.
//
//   3. Autocomplete API — as the driver types an address, suggests
//      completions in real time (used in the address input field).
//
// Free tier limits (as of 2024):
//   - 2,000 requests/day for most endpoints
//   - Max 25 locations per matrix call
//   - Sufficient for V1 with a few drivers
//
// Sign up for a free key at: https://openrouteservice.org/dev/#/signup
// ============================================================

const axios = require('axios');

// ORS migrated from api.openrouteservice.org to api.heigit.org (August 2026)
const ORS_BASE = 'https://api.openrouteservice.org';

// Read the API key from environment variable (set in .env file)
const API_KEY = process.env.ORS_API_KEY;

// ── 1. Geocoding ──────────────────────────────────────────────

/**
 * Convert a single address string into GPS coordinates.
 *
 * How it works:
 *   Sends the address text to ORS Geocoding (powered by Pelias).
 *   ORS searches its database of addresses worldwide and returns
 *   the best match with coordinates and a canonical label.
 *
 * @param {string} address - Human-readable address string
 * @returns {Promise<{ lat, lng, label }>}
 *   lat/lng are decimal degrees. label is the canonical address ORS found.
 *
 * @throws if address not found or API call fails
 */
async function geocodeAddress(address) {
  if (!API_KEY) throw new Error('ORS_API_KEY not set in environment');

  const res = await axios.get(`${ORS_BASE}/geocode/search`, {
    params: {
      api_key: API_KEY,
      text:    address,  // the address to look up
      size:    1,        // we only want the single best match
    },
    timeout: 8000, // fail after 8 seconds instead of hanging
  });

  const features = res.data?.features;

  // ORS returns a GeoJSON FeatureCollection. If features array is
  // empty, the address wasn't found in the database.
  if (!features || features.length === 0) {
    throw new Error(`Address not found: "${address}"`);
  }

  // GeoJSON uses [longitude, latitude] order (the opposite of what
  // most people expect). We destructure and rename for clarity.
  const [lng, lat] = features[0].geometry.coordinates;
  const label      = features[0].properties.label; // clean formatted address

  return { lat, lng, label };
}

/**
 * Geocode multiple addresses in parallel.
 *
 * Runs all geocoding requests at the same time using Promise.all
 * instead of sequentially, which is much faster (e.g. 4 addresses
 * takes the time of 1 request, not 4).
 *
 * @param {string[]} addresses - Array of address strings
 * @returns {Promise<Array<{ lat, lng, label }>>} - Same order as input
 * @throws with the specific address name if any one fails
 */
async function geocodeAll(addresses) {
  const results = await Promise.all(
    addresses.map(async (addr, i) => {
      try {
        return await geocodeAddress(addr);
      } catch (err) {
        // Rethrow with context so the error message identifies which stop failed
        throw new Error(`Stop ${i + 1}: ${err.message}`);
      }
    })
  );
  return results;
}

// ── 2. Travel time matrix ─────────────────────────────────────

/**
 * Fetch a travel-time matrix between all points using live road data.
 *
 * This is the most important function in this file — it's what makes
 * the algorithm traffic-aware. Instead of calculating straight-line
 * distances, we ask ORS for the actual driving time on real roads,
 * at the current moment in time.
 *
 * What the matrix looks like:
 *   With 1 restaurant + 3 stops = 4 points, we get a 4×4 matrix:
 *
 *              Restaurant  Stop1  Stop2  Stop3
 *   Restaurant      0        9      14     22
 *   Stop1           9        0       7     16
 *   Stop2          14        7       0      8
 *   Stop3          22       16       8      0
 *
 *   Each cell = minutes to drive between those two points.
 *   The diagonal is always 0 (no time to get from a point to itself).
 *
 * We make ONE API call for the entire matrix. The TSPTW solver then
 * reads from this matrix without any further network requests.
 *
 * @param {Array<{ lat, lng }>} points
 *   First element MUST be the restaurant. Remaining are delivery stops.
 *   Order matters — it determines row/column indices in the result.
 *
 * @returns {Promise<number[][]>}
 *   N×N matrix of travel times in MINUTES (converted from seconds).
 *   Values are rounded to 1 decimal place.
 */
async function getTravelTimeMatrix(points) {
  if (!API_KEY) throw new Error('ORS_API_KEY not set in environment');
  if (points.length < 2) throw new Error('Need at least 2 points for matrix');
  if (points.length > 25) throw new Error('ORS free tier supports max 25 points');

  // ORS expects coordinates in [longitude, latitude] order (GeoJSON standard)
  // We convert from our { lat, lng } objects to [lng, lat] arrays
  const locations = points.map(p => [p.lng, p.lat]);

  const res = await axios.post(
    `${ORS_BASE}/v2/matrix/driving-car`,  // 'driving-car' = standard car routing
    {
      locations,
      metrics:           ['duration'],  // 'duration' = travel time in seconds
      resolve_locations: false,         // don't return place names (we already have them)
    },
    {
      headers: {
        // Matrix API uses Authorization header (not query param like geocoding)
        Authorization:  API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 12000, // matrix calls can take longer — give 12 seconds
    }
  );

  const rawMatrix = res.data?.durations;
  if (!rawMatrix) throw new Error('ORS returned no duration matrix');

  // ORS returns times in SECONDS. Convert to minutes and round to 1 decimal.
  // Example: 547 seconds → 9.1 minutes
  return rawMatrix.map(row =>
    row.map(sec => Math.round((sec / 60) * 10) / 10)
  );
}

// ── 3. Address autocomplete ───────────────────────────────────

/**
 * Return address suggestions as the driver types.
 *
 * This is called from the frontend AddressInput component every time
 * the driver pauses typing (after a 350ms debounce delay).
 * Results are shown as a dropdown below the input field.
 *
 * @param {string} text - Partial address typed by the driver
 * @returns {Promise<Array<{ label, lat, lng }>>}
 *   Up to 5 suggestions, sorted by relevance (ORS decides relevance).
 *   Returns empty array if text is too short or no matches found.
 */
async function autocomplete(text) {
  if (!API_KEY) throw new Error('ORS_API_KEY not set in environment');
  if (!text || text.length < 3) return []; // don't call API for very short strings

  const res = await axios.get(`${ORS_BASE}/geocode/autocomplete`, {
    params: {
      api_key: API_KEY,
      text,
      size: 5,  // maximum suggestions to return
    },
    timeout: 6000,
  });

  // Map the GeoJSON features to a cleaner format for the frontend
  return (res.data?.features || []).map(f => ({
    label: f.properties.label,            // full formatted address string
    lat:   f.geometry.coordinates[1],     // latitude (index 1 in GeoJSON)
    lng:   f.geometry.coordinates[0],     // longitude (index 0 in GeoJSON)
  }));
}

module.exports = { geocodeAddress, geocodeAll, getTravelTimeMatrix, autocomplete };
