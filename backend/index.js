require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const runRoutes      = require('./routes/runs');
const locationRoutes = require('./routes/location');

const app = express();

// Allow all origins — frontend and backend are on the same Vercel domain
// so this is safe. CORS was only needed to distinguish dev vs prod.
app.use(cors());

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: 'v1', timestamp: new Date().toISOString() });
});

app.use('/api/run', runRoutes);
app.use('/api/location', locationRoutes);

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Delivery V1 backend running on port ${PORT}`);
});

module.exports = app;
