// ============================================================
// frontend/src/pages/OrderEntry.jsx
// ============================================================
// Screen 1: The order entry form.
//
// This is the first thing the driver sees when they open the app.
// They fill in:
//   - Restaurant address (the starting point)
//   - Departure time (when they plan to leave)
//   - 1–8 delivery stops, each with:
//       - Customer name (optional, for display)
//       - Delivery address (with autocomplete)
//       - Time window: earliest + latest acceptable delivery time
//
// When the driver taps "Calculate Route":
//   1. Client-side validation runs first (no empty fields, valid windows)
//   2. If valid, POST /api/run/start is called
//   3. Backend geocodes addresses, fetches traffic matrix, runs TSPTW
//   4. Returns a run object → parent (App.jsx) decides which screen to show
// ============================================================

import React, { useState } from 'react';
import { AddressInput }    from '../components/AddressInput';
import { api }             from '../utils/api';

// Helper: get current time as "HH:MM" string, used as default departure time
const now = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Factory function for a blank stop object.
// We use a function (not a constant) so each call gives a fresh object.
const emptyStop = () => ({
  name:    '',     // customer name — optional
  address: '',     // delivery address text
  lat:     null,   // latitude — set when driver picks from autocomplete
  lng:     null,   // longitude — set when driver picks from autocomplete
  windowOpen:  '', // 'HH:MM' — earliest delivery time
  windowClose: '', // 'HH:MM' — latest delivery time
});

export function OrderEntry({ onRunStarted }) {
  // Restaurant state: text address + optional coordinates if picked from autocomplete
  const [restaurant, setRestaurant] = useState({ address: '', lat: null, lng: null });

  // Array of stop objects — start with 2 empty stops
  const [stops, setStops] = useState([emptyStop(), emptyStop()]);

  // Departure time string "HH:MM" — defaults to right now
  const [departureTime, setDepartureTime] = useState(now());

  // Loading state while waiting for the backend
  const [loading, setLoading] = useState(false);

  // Field-level validation errors: { restaurant: '...', stop_0_address: '...', etc. }
  const [errors, setErrors] = useState({});

  // Top-level error from the server (geocoding failure, timeout, etc.)
  const [globalError, setGlobalError] = useState('');

  // ── Stop management ───────────────────────────────────────

  /**
   * Update a single field on a single stop.
   * Uses functional update form so we always work from the latest state.
   */
  function updateStop(i, field, value) {
    setStops(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  }

  /** Add a new blank stop (max 8) */
  function addStop() {
    if (stops.length >= 8) return;
    setStops(prev => [...prev, emptyStop()]);
  }

  /** Remove a stop by index (min 1 stop must remain) */
  function removeStop(i) {
    if (stops.length <= 1) return;
    setStops(prev => prev.filter((_, idx) => idx !== i));
  }

  // ── Client-side validation ────────────────────────────────
  /**
   * Check all required fields and time window logic.
   * Returns an errors object — empty means everything is valid.
   * Keys match the UI so we can highlight the right fields.
   */
  function validate() {
    const errs = {};

    if (!restaurant.address.trim()) {
      errs.restaurant = 'Restaurant address required';
    }

    stops.forEach((s, i) => {
      if (!s.address.trim())  errs[`stop_${i}_address`] = 'Address required';
      if (!s.windowOpen)      errs[`stop_${i}_open`]    = 'Required';
      if (!s.windowClose)     errs[`stop_${i}_close`]   = 'Required';
      // windowClose must be strictly after windowOpen
      if (s.windowOpen && s.windowClose && s.windowClose <= s.windowOpen) {
        errs[`stop_${i}_close`] = 'Must be after open time';
      }
    });

    if (!departureTime) errs.departure = 'Departure time required';

    return errs;
  }

  // ── Form submission ───────────────────────────────────────
  async function handleSubmit() {
    const errs = validate();
    setErrors(errs);
    setGlobalError('');

    // Stop here if there are validation errors — show them to the driver
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      // Build the payload the backend expects
      const payload = {
        restaurant: {
          address: restaurant.address,
          lat:     restaurant.lat,  // null if not picked from autocomplete
          lng:     restaurant.lng,  // null if not picked from autocomplete
        },
        stops: stops.map(s => ({
          // Use first part of address as name if driver left name blank
          name:        s.name || s.address.split(',')[0],
          address:     s.address,
          lat:         s.lat,       // null if not from autocomplete
          lng:         s.lng,       // null if not from autocomplete
          windowOpen:  s.windowOpen,
          windowClose: s.windowClose,
        })),
        departureTime, // "HH:MM" string — backend parses as today at that time
      };

      const run = await api.startRun(payload);
      // Hand the run object to App.jsx which decides what screen to show
      onRunStarted(run);

    } catch (err) {
      // Show server-side errors (bad address, API timeout, etc.)
      setGlobalError(err.message || 'Failed to calculate route. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--gray-50)', paddingBottom: '2rem' }}>

      {/* App header */}
      <div style={{
        background: 'var(--blue)',
        color:      'var(--white)',
        padding:    '1.25rem 1.25rem 1.5rem',
      }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>
          🚴 Delivery
        </h1>
        <p style={{ fontSize: '0.85rem', opacity: 0.85 }}>Plan your delivery run</p>
      </div>

      <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Server-side error banner */}
        {globalError && (
          <div className="alert alert-red">
            <strong>Error:</strong> {globalError}
          </div>
        )}

        {/* ── Restaurant section ──────────────────────────── */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--navy)' }}>
            🏪 Restaurant (start point)
          </h2>
          {/* AddressInput handles autocomplete and updates restaurant state */}
          <AddressInput
            value={restaurant.address}
            onChange={(val) => setRestaurant(r => ({ ...r, address: val, lat: null, lng: null }))}
            onSelect={(s) => setRestaurant({ address: s.label, lat: s.lat, lng: s.lng })}
            placeholder="Restaurant address..."
            error={errors.restaurant}
          />
        </div>

        {/* ── Departure time ──────────────────────────────── */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--navy)' }}>
            🕐 Departure time
          </h2>
          {/* Native time picker — looks like the OS time picker on mobile */}
          <input
            type="time"
            value={departureTime}
            onChange={e => setDepartureTime(e.target.value)}
            className={errors.departure ? 'error' : ''}
          />
          {errors.departure && (
            <p style={{ color: 'var(--red)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
              {errors.departure}
            </p>
          )}
        </div>

        {/* ── Delivery stops ──────────────────────────────── */}
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--navy)' }}>
            📦 Delivery stops ({stops.length})
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {stops.map((stop, i) => (
              <div key={i} className="card" style={{ padding: '1.25rem' }}>

                {/* Stop header: number badge + remove button */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: 'var(--blue)', color: 'var(--white)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.85rem', fontWeight: 700, flexShrink: 0,
                    }}>
                      {i + 1}
                    </div>
                    <span style={{ fontWeight: 600, color: 'var(--navy)' }}>Stop {i + 1}</span>
                  </div>
                  {stops.length > 1 && (
                    <button
                      onClick={() => removeStop(i)}
                      className="btn-secondary"
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', color: 'var(--red)' }}
                    >
                      Remove
                    </button>
                  )}
                </div>

                {/* Stop fields */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

                  {/* Customer name — optional, used for display on the map and stop cards */}
                  <input
                    type="text"
                    placeholder="Customer name (optional)"
                    value={stop.name}
                    onChange={e => updateStop(i, 'name', e.target.value)}
                  />

                  {/* Address with autocomplete */}
                  <AddressInput
                    value={stop.address}
                    onChange={(val) => updateStop(i, 'address', val)}
                    onSelect={(s) => {
                      // When driver picks from autocomplete, capture all three values
                      updateStop(i, 'address', s.label);
                      updateStop(i, 'lat', s.lat);
                      updateStop(i, 'lng', s.lng);
                    }}
                    placeholder="Delivery address..."
                    error={errors[`stop_${i}_address`]}
                  />

                  {/* Time window — two time pickers side by side */}
                  <div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--gray-600)', marginBottom: '0.4rem', fontWeight: 600 }}>
                      ⏱ Delivery time window
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                      {/* Earliest acceptable time (windowOpen) */}
                      <div>
                        <input
                          type="time"
                          value={stop.windowOpen}
                          onChange={e => updateStop(i, 'windowOpen', e.target.value)}
                          className={errors[`stop_${i}_open`] ? 'error' : ''}
                        />
                        {errors[`stop_${i}_open`] && (
                          <p style={{ color: 'var(--red)', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                            {errors[`stop_${i}_open`]}
                          </p>
                        )}
                        <p style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: '0.25rem' }}>Earliest</p>
                      </div>
                      {/* Latest acceptable time (windowClose) */}
                      <div>
                        <input
                          type="time"
                          value={stop.windowClose}
                          onChange={e => updateStop(i, 'windowClose', e.target.value)}
                          className={errors[`stop_${i}_close`] ? 'error' : ''}
                        />
                        {errors[`stop_${i}_close`] && (
                          <p style={{ color: 'var(--red)', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                            {errors[`stop_${i}_close`]}
                          </p>
                        )}
                        <p style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: '0.25rem' }}>Latest</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add stop button — hidden when at maximum */}
          {stops.length < 8 && (
            <button
              onClick={addStop}
              className="btn-secondary"
              style={{ marginTop: '0.75rem', width: '100%', padding: '0.75rem' }}
            >
              + Add another stop
            </button>
          )}
        </div>

        {/* Submit button — triggers geocoding + algorithm */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="btn-primary"
          style={{ padding: '1.1rem', fontSize: '1.05rem' }}
        >
          {loading ? (
            // Loading state: spinner + message
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              <div className="spinner" style={{ width: 20, height: 20, borderTopColor: 'var(--white)' }} />
              Calculating best route...
            </span>
          ) : '🗺 Calculate optimal route'}
        </button>

      </div>
    </div>
  );
}
