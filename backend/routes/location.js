// backend/routes/location.js
// GPS position endpoints + Google Places autocomplete + place details proxy

const express = require('express');
const router  = express.Router();
const { autocomplete, getPlaceCoords } = require('../services/ors');
const store   = require('../services/store');

// POST /api/location  — driver app pushes GPS coordinates
router.post('/', (req, res) => {
  const { lat, lng, accuracy, timestamp } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat/lng required' });
  store.saveLocation({ lat, lng, accuracy, timestamp: timestamp || Date.now() });
  res.json({ ok: true });
});

// GET /api/location  — dispatcher/map reads latest driver position
router.get('/', (req, res) => {
  const loc = store.getLocation();
  if (!loc) return res.status(404).json({ error: 'No location yet' });
  res.json(loc);
});

// GET /api/location/autocomplete?q=text[&sessiontoken=xxx]
router.get('/autocomplete', async (req, res) => {
  const { q, sessiontoken } = req.query;
  if (!q) return res.json([]);
  try {
    const suggestions = await autocomplete(q, sessiontoken);
    res.json(suggestions);
  } catch (err) {
    console.error('Autocomplete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/location/place?place_id=xxx[&sessiontoken=xxx]
// Resolves a Google place_id to { lat, lng }
router.get('/place', async (req, res) => {
  const { place_id, sessiontoken } = req.query;
  if (!place_id) return res.status(400).json({ error: 'place_id required' });
  try {
    const coords = await getPlaceCoords(place_id, sessiontoken);
    res.json(coords);
  } catch (err) {
    console.error('Place details error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
