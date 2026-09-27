// backend/services/ors.js
// Google Maps APIs: Geocoding, Places Autocomplete, Place Details, Distance Matrix

const axios = require('axios');

const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY;
const GOOGLE_BASE = 'https://maps.googleapis.com/maps/api';

// ── Geocode a single address string → { lat, lng, display }
async function geocodeAddress(address) {
  const res = await axios.get(`${GOOGLE_BASE}/geocode/json`, {
    params: { address, key: GOOGLE_KEY }
  });
  const results = res.data.results;
  if (!results || results.length === 0) throw new Error(`Cannot geocode: ${address}`);
  const loc = results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng, display: results[0].formatted_address };
}

// ── Geocode multiple addresses in parallel
async function geocodeAll(addresses) {
  return Promise.all(addresses.map(geocodeAddress));
}

// ── Autocomplete suggestions for a partial query (returns array of { label, place_id })
async function autocomplete(text, sessiontoken) {
  const res = await axios.get(`${GOOGLE_BASE}/place/autocomplete/json`, {
    params: {
      input: text,
      key: GOOGLE_KEY,
      language: 'tr',
      components: 'country:tr',   // restrict to Turkey
      sessiontoken                // groups autocomplete + detail into 1 billing session
    }
  });
  const preds = res.data.predictions || [];
  return preds.map(p => ({ label: p.description, place_id: p.place_id }));
}

// ── Resolve a place_id to { lat, lng } using Place Details
async function getPlaceCoords(place_id, sessiontoken) {
  const res = await axios.get(`${GOOGLE_BASE}/place/details/json`, {
    params: {
      place_id,
      fields: 'geometry',
      key: GOOGLE_KEY,
      sessiontoken
    }
  });
  const loc = res.data.result?.geometry?.location;
  if (!loc) throw new Error(`No geometry for place_id: ${place_id}`);
  return { lat: loc.lat, lng: loc.lng };
}

// ── Build NxN travel-time matrix (minutes) via Distance Matrix API
// points = [{ lat, lng }, ...]
async function getTravelTimeMatrix(points) {
  const n = points.length;
  const latlngs = points.map(p => `${p.lat},${p.lng}`).join('|');

  const res = await axios.get(`${GOOGLE_BASE}/distancematrix/json`, {
    params: {
      origins: latlngs,
      destinations: latlngs,
      mode: 'driving',
      departure_time: 'now',
      traffic_model: 'best_guess',
      key: GOOGLE_KEY
    }
  });

  const rows = res.data.rows;
  const matrix = [];
  for (let i = 0; i < n; i++) {
    matrix[i] = [];
    for (let j = 0; j < n; j++) {
      const el = rows[i].elements[j];
      if (el.status !== 'OK') {
        matrix[i][j] = 999; // unreachable
      } else {
        // duration_in_traffic when available, else duration
        const secs = (el.duration_in_traffic || el.duration).value;
        matrix[i][j] = Math.round(secs / 60); // → minutes
      }
    }
  }
  return matrix;
}

module.exports = { geocodeAddress, geocodeAll, autocomplete, getPlaceCoords, getTravelTimeMatrix };
