// ============================================================
// frontend/src/pages/AlertScreen.jsx
// ============================================================
// Screen 2: Alert / status screen shown BEFORE the route.
//
// This screen is the TSPTW system's most important safety feature.
// It shows the driver and dispatcher what the algorithm found BEFORE
// the driver leaves the restaurant — so problems can be fixed in time.
//
// THREE POSSIBLE STATES:
//
//   🟢 GREEN (status === 'ok')
//      All time windows can be satisfied. No issues.
//      This screen is SKIPPED — App.jsx goes straight to RouteView.
//      (AlertScreen renders null and calls onProceed immediately)
//
//   🟡 YELLOW (status === 'warning')
//      A valid route exists, BUT the driver will have to wait
//      >10 minutes at one or more stops (arrived too early).
//      Shows the warning details + lets driver proceed anyway.
//
//   🔴 RED (status === 'infeasible')
//      NO valid route exists — at least one time window cannot
//      be satisfied by any stop ordering.
//      Shows exactly which stop is impossible and why.
//      Driver CANNOT proceed — must go back and adjust.
//
// The diagnosis data (for RED) comes from the TSPTW solver's
// infeasibility analysis, which finds the earliest possible
// arrival at each conflicting stop.
// ============================================================

import React from 'react';

export function AlertScreen({ run, onProceed, onBack }) {
  const isInfeasible = run.status === 'infeasible';
  const isWarning    = run.status === 'warning';

  // GREEN: skip this screen entirely
  // This handles the case where App.jsx sends us here even for 'ok' status
  if (!isInfeasible && !isWarning) {
    onProceed();
    return null; // render nothing while transitioning
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--gray-50)', display: 'flex', flexDirection: 'column' }}>

      {/* Coloured header — red for infeasible, amber for warning */}
      <div style={{
        background: isInfeasible ? 'var(--red)' : 'var(--amber)',
        color:      'var(--white)',
        padding:    '1.25rem',
      }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>
          {isInfeasible ? '🚨 Route not possible' : '⚠️ Route warning'}
        </h1>
        <p style={{ fontSize: '0.85rem', opacity: 0.9, marginTop: '0.25rem' }}>
          {isInfeasible
            ? 'No valid sequence satisfies all time windows'
            : 'Route is valid but has potential issues'
          }
        </p>
      </div>

      <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* Main alert messages from the algorithm */}
        {run.alerts?.map((alert, i) => (
          <div key={i} className={`alert alert-${alert.level === 'red' ? 'red' : 'yellow'}`}>
            <strong>{alert.message}</strong>
            {alert.detail && (
              <p style={{ marginTop: '0.4rem', opacity: 0.85 }}>{alert.detail}</p>
            )}
          </div>
        ))}

        {/* ── RED: Infeasibility diagnosis ─────────────────── */}
        {/* Shows exactly which stop is causing the conflict    */}
        {isInfeasible && run.diagnosis?.length > 0 && (
          <div className="card" style={{ padding: '1.25rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--navy)' }}>
              🔍 Conflict analysis
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {run.diagnosis.map((d, i) => (
                <div key={i} style={{
                  padding:    '0.875rem',
                  borderRadius: 'var(--radius-sm)',
                  // Red card for definite conflicts, amber for probable ones
                  background: d.isConflict ? 'var(--red-l)' : 'var(--amber-l)',
                  borderLeft: `4px solid ${d.isConflict ? 'var(--red)' : 'var(--amber)'}`,
                }}>
                  <p style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: '0.25rem' }}>
                    {d.isConflict ? '🔴' : '🟡'} {d.stopName}
                  </p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--gray-800)', lineHeight: 1.5 }}>
                    {d.address}
                  </p>
                  <p style={{ fontSize: '0.85rem', marginTop: '0.35rem', color: d.isConflict ? '#7f1d1d' : '#78350f' }}>
                    {/* Show the time window and earliest possible arrival */}
                    Window: {d.windowOpen} – {d.windowClose}<br />
                    Earliest possible arrival: <strong>{d.earliestPossibleArrival}</strong><br />
                    {d.isConflict && (
                      <span style={{ color: 'var(--red)', fontWeight: 600 }}>
                        {d.conflictDetail}
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>

            {/* Action instruction for dispatcher */}
            <div className="alert alert-red" style={{ marginTop: '1rem', marginBottom: 0 }}>
              <strong>Action needed:</strong> Call the customer(s) marked above and adjust
              their delivery window before the driver departs.
            </div>
          </div>
        )}

        {/* ── YELLOW: Show route stats alongside the warning ── */}
        {isWarning && (
          <div className="card" style={{ padding: '1.25rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--navy)' }}>
              Route details
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--gray-600)' }}>
              Total trip time: <strong>{run.totalMinutes} min</strong><br />
              Stops: <strong>{run.route?.length}</strong><br />
              Valid routes found: <strong>{run.validRoutesFound}</strong>
            </p>
          </div>
        )}

        {/* ── Action buttons ─────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: 'auto' }}>
          {/* Only YELLOW gets a "proceed anyway" option — RED requires going back */}
          {isWarning && (
            <button className="btn-primary" onClick={onProceed}>
              Proceed with this route →
            </button>
          )}
          <button className="btn-secondary" onClick={onBack}>
            ← Go back and adjust
          </button>
        </div>

      </div>
    </div>
  );
}
