// frontend/src/utils/api.js
// Thin wrapper around all backend API calls

const BASE = import.meta.env.VITE_API_URL || '';

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  return res.json();
}

const api = {
  // ── Delivery runs
  startRun:    (data)              => request('POST', '/api/run/start', data),
  getRun:      (id)                => request('GET',  `/api/run/${id}`),
  listRuns:    ()                  => request('GET',  '/api/run'),
  markDelivered: (runId, stopIdx)  => request('PATCH', `/api/run/${runId}/stop/${stopIdx}/deliver`),

  // ── Driver GPS
  pushLocation: (loc)              => request('POST', '/api/location', loc),
  getLocation:  ()                 => request('GET',  '/api/location'),

  // ── Google Places (proxied through backend so key stays secret)
  getAutocomplete: (q, sessiontoken) => {
    const params = new URLSearchParams({ q });
    if (sessiontoken) params.set('sessiontoken', sessiontoken);
    return request('GET', `/api/location/autocomplete?${params}`);
  },
  getPlaceCoords: (place_id, sessiontoken) => {
    const params = new URLSearchParams({ place_id });
    if (sessiontoken) params.set('sessiontoken', sessiontoken);
    return request('GET', `/api/location/place?${params}`);
  },
};

export default api;
