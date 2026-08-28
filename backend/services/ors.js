const axios = require('axios');

const ORS_BASE = 'https://api.openrouteservice.org';
const NOM_BASE = 'https://nominatim.openstreetmap.org';
const API_KEY  = process.env.ORS_API_KEY;
const NOM_HEADERS = { 'User-Agent': 'DeliveryV1/1.0 (delivery-app)' };

async function geocodeAddress(address) {
  const res = await axios.get(`${NOM_BASE}/search`, {
    params: { q: address, format: 'json', limit: 1 },
    headers: NOM_HEADERS,
    timeout: 8000,
  });
  if (!res.data || res.data.length === 0) throw new Error(`Address not found: "${address}"`);
  const place = res.data[0];
  return { lat: parseFloat(place.lat), lng: parseFloat(place.lon), label: place.display_name };
}

async function geocodeAll(addresses) {
  const results = await Promise.all(
    addresses.map(async (addr, i) => {
      try { return await geocodeAddress(addr); }
      catch (err) { throw new Error(`Stop ${i + 1}: ${err.message}`); }
    })
  );
  return results;
}

async function autocomplete(text) {
  if (!text || text.length < 3) return [];
  const res = await axios.get(`${NOM_BASE}/search`, {
    params: { q: text, format: 'json', limit: 5 },
    headers: NOM_HEADERS,
    timeout: 6000,
  });
  return (res.data || []).map(p => ({
    label: p.display_name,
    lat: parseFloat(p.lat),
    lng: parseFloat(p.lon),
  }));
}

async function getTravelTimeMatrix(points) {
  if (!API_KEY) throw new Error('ORS_API_KEY not set');
  if (points.length < 2) throw new Error('Need at least 2 points');
  const locations = points.map(p => [p.lng, p.lat]);
  const res = await axios.post(
    `${ORS_BASE}/v2/matrix/driving-car`,
    { locations, metrics: ['duration'], resolve_locations: false },
    { headers: { Authorization: API_KEY, 'Content-Type': 'application/json' }, timeout: 12000 }
  );
  const rawMatrix = res.data?.durations;
  if (!rawMatrix) throw new Error('ORS returned no duration matrix');
  return rawMatrix.map(row => row.map(sec => Math.round((sec / 60) * 10) / 10));
}

module.exports = { geocodeAddress, geocodeAll, getTravelTimeMatrix, autocomplete };
