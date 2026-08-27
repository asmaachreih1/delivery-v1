// ============================================================
// frontend/src/pages/RunComplete.jsx
// ============================================================
// Screen 4: Run summary — shown when all stops are delivered.
//
// Displayed automatically after the last stop is marked delivered
// in RouteView.jsx (with a short 600ms delay for visual feedback).
//
// SHOWS:
//   - Celebration header (the driver earned it)
//   - 4 stat cards: total time, deliveries, on time, late
//   - Full delivery log: each stop with window, actual time, on-time/late badge
//   - "Start new run" button to reset and return to order entry
//
// LATE DELIVERY DETECTION:
//   We compare stop.actualDeliveryTime (when driver tapped "Delivered")
//   against stop.windowClose (the customer's latest acceptable time).
//   Both are "HH:MM" strings so string comparison works correctly
//   (e.g. "13:47" > "13:30" → late).
// ============================================================

import React from 'react';

export function RunComplete({ run, onNewRun }) {
  const route = run.route || [];

  // Identify late deliveries: actual delivery time was after the window closed
  const lateDeliveries = route.filter(s => {
    // Guard: both fields must exist to compare
    if (!s.actualDeliveryTime || !s.windowClose) return false;
    // String comparison works correctly for "HH:MM" format
    return s.actualDeliveryTime > s.windowClose;
  });

  // Format total minutes into "Xh Ym" or just "Y min" if under an hour
  const totalMinutes = run.totalMinutes || 0;
  const hours        = Math.floor(totalMinutes / 60);
  const mins         = totalMinutes % 60;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--gray-50)', display: 'flex', flexDirection: 'column' }}>

      {/* Green celebration header */}
      <div style={{
        background:  'var(--green)',
        color:       'var(--white)',
        padding:     '2rem 1.25rem',
        textAlign:   'center',
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎉</div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Run complete!</h1>
        <p style={{ opacity: 0.9, marginTop: '0.35rem' }}>
          All {route.length} deliveries done
        </p>
      </div>

      <div style={{ padding: '1.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* ── 4 stat cards in a 2×2 grid ───────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          {[
            {
              label: 'Total time',
              // Show "1h 23m" format if over an hour, otherwise just "23 min"
              value: hours > 0 ? `${hours}h ${mins}m` : `${mins} min`,
            },
            {
              label: 'Deliveries',
              value: route.length,
            },
            {
              label: 'On time',
              value: route.length - lateDeliveries.length,
            },
            {
              label: 'Late',
              value: lateDeliveries.length,
              // Highlight the late count in red if any deliveries were late
              warn:  lateDeliveries.length > 0,
            },
          ].map(({ label, value, warn }) => (
            <div key={label} className="card" style={{ padding: '1rem', textAlign: 'center' }}>
              <p style={{
                fontSize:   '1.75rem',
                fontWeight: 800,
                // Red if this is a "bad" stat, blue otherwise
                color:      warn ? 'var(--red)' : 'var(--blue)',
              }}>
                {value}
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--gray-600)', marginTop: '0.25rem' }}>
                {label}
              </p>
            </div>
          ))}
        </div>

        {/* ── Delivery log ─────────────────────────────────── */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--navy)' }}>
            Delivery log
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {route.map(stop => {
              // Determine if this delivery was late
              const isLate = stop.actualDeliveryTime
                && stop.windowClose
                && stop.actualDeliveryTime > stop.windowClose;

              return (
                <div
                  key={stop.stopIndex}
                  style={{
                    display:        'flex',
                    justifyContent: 'space-between',
                    alignItems:     'center',
                    padding:        '0.6rem 0',
                    borderBottom:   '1px solid var(--gray-100)',
                  }}
                >
                  {/* Left: stop name and time window */}
                  <div>
                    <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{stop.name}</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>
                      Window: {stop.windowOpen} – {stop.windowClose}
                    </p>
                  </div>

                  {/* Right: on-time/late badge + actual delivery time */}
                  <div style={{ textAlign: 'right' }}>
                    <span className={`badge ${isLate ? 'badge-red' : 'badge-green'}`}>
                      {isLate ? 'Late' : 'On time'}
                    </span>
                    {stop.actualDeliveryTime && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--gray-600)', marginTop: '0.2rem' }}>
                        {stop.actualDeliveryTime}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Start a new run — resets everything back to Screen 1 */}
        <button className="btn-primary" onClick={onNewRun} style={{ padding: '1rem' }}>
          + Start a new delivery run
        </button>

      </div>
    </div>
  );
}
