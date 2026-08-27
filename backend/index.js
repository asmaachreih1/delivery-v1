// ============================================================
// backend/index.js
// ============================================================
// Entry point for the Express backend server.
//
// Responsibilities:
//   1. Load environment variables from .env file
//   2. Create and configure the Express app
//   3. Set up CORS so the React frontend can talk to this server
//   4. Mount the two route groups (/api/run and /api/location)
//   5. Provide a global error handler for unhandled errors
//   6. Start listening on a port
//
// In Vercel serverless deployment, this file is the "function"
// that Vercel invokes for every /api/* request. The module.exports
// at the bottom is required for that to work.
// ============================================================

// Load variables from backend/.env into process.env
// Must be called before anything else reads process.env
require('dotenv').config();

const express = require('express');
const cors    = require('cors');

// Route handlers — each file exports an Express Router
const runRoutes      = require('./routes/runs');
const locationRoutes = require('./routes/location');

// Create the Express application instance
const app = express();

// ── CORS (Cross-Origin Resource Sharing) ─────────────────────
// Browsers block requests from one domain to another by default.
// CORS headers tell the browser "this server allows requests
// from the frontend domain".
//
// FRONTEND_URL should be set to your Vercel deployment URL in
// production (e.g. https://delivery-v1.vercel.app).
// During local dev it defaults to '*' (allow all origins).
app.use(cors({
  origin:         process.env.FRONTEND_URL || '*',
  methods:        ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type'],
}));

// Parse incoming JSON request bodies automatically.
// Without this, req.body would be undefined.
app.use(express.json());

// ── Health check endpoint ─────────────────────────────────────
// GET /api/health
// Used to verify the server is running — useful during Vercel
// deployment debugging and uptime monitoring.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: 'v1', timestamp: new Date().toISOString() });
});

// ── Route groups ──────────────────────────────────────────────
// All delivery run logic (start run, get run, mark delivered)
app.use('/api/run', runRoutes);

// Driver GPS position + address autocomplete
app.use('/api/location', locationRoutes);

// ── Global error handler ──────────────────────────────────────
// Express calls this 4-argument middleware whenever a route
// calls next(err) or throws inside an async handler.
// It catches errors that weren't handled in the route itself
// and sends a clean JSON response instead of crashing.
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// ── Start server ──────────────────────────────────────────────
// process.env.PORT is set automatically by Vercel / Render / Heroku.
// Locally it falls back to 3001.
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Delivery V1 backend running on port ${PORT}`);
});

// Export the app so Vercel can import it as a serverless function
module.exports = app;
