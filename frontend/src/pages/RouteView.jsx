// ============================================================
// frontend/src/pages/RouteView.jsx
// ============================================================
// Screen 3: The main delivery screen — live map + stop cards.
//
// This is what the driver looks at while driving.
// It shows:
//   - A live map (Leaflet.js) with:
//       • The driver's moving position dot (blue, from phone GPS)
//       • The restaurant pin (emoji 🏪)
//       • Numbered stop pins (blue = pending, teal = current, grey = done)
//       • A dashed route line connecting pending stops in order
//   - Below the map: a scrollable list of stop cards, each showing:
//       • Stop number, customer name, address
//       • Time window and ETA
//       • "Navigate" button → opens Google Maps with that address
//       • "Mark Delivered" button → marks stop complete, advances route
//   - A sticky header with run stats
//   - Late warnings that appear in real time as windows approach closing
//
// REACT-LEAFLET NOTES:
//   We use react-leaflet which wraps Leaflet.js in React components.
//   MapContainer creates the map once. Markers and Polyline update
//   reactively when their props change (React handles diffing).
//   MapController is a child component that accesses the Leaflet map
//   instance directly via useMap() to re-centre programmatically.
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L       from 'leaflet';
import { api } from '../utils/api';
import { useGPS } from '../hooks/useGPS';

// ── Custom map marker icons ───────────────────────────────────
// Leaflet's default marker needs image files we don't want to host.
// Instead we create HTML/CSS div markers using L.divIcon().

/**
 * Create a teardrop-shaped numbered stop pin.
 *
 * @param {number|string} number - Display number (1, 2, 3...)
 * @param {string}  color  - CSS colour for the pin background
 * @param {boolean} done   - If true, show a checkmark instead of the number
 */
function makeStopIcon(number, color = '#2563eb', done = false) {
  return L.divIcon({
    className: '', // prevent Leaflet adding default styles
    html: `
      <div style="
        width:32px; height:32px;
        border-radius: 50% 50% 50% 0; /* teardrop pointing bottom-left */
        background: ${done ? '#94a3b8' : color};
        border: 2.5px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        display: flex; align-items: center; justify-content: center;
        transform: rotate(-45deg); /* rotate so the point is at bottom */
      ">
        <span style="transform:rotate(45deg); color:white; font-size:12px; font-weight:700;">
          ${done ? '✓' : number}
        </span>
      </div>`,
    iconSize:    [32, 32],
    iconAnchor:  [16, 32], // anchor at the bottom point of the teardrop
    popupAnchor: [0, -32],
  });
}

// Blue pulsing dot for the driver's live position
const driverIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:20px; height:20px; border-radius:50%;
    background:#2563eb;
    border:3px solid white;
    /* Two box-shadows: a white ring and a transparent blue glow */
    box-shadow:0 0 0 3px rgba(37,99,235,0.3), 0 2px 8px rgba(0,0,0,0.2);
  "></div>`,
  iconSize:   [20, 20],
  iconAnchor: [10, 10], // centred on the dot
});

// Restaurant emoji marker
const restaurantIcon = L.divIcon({
  className: '',
  html: `<div style="font-size:24px; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));">🏪</div>`,
  iconSize:   [28, 28],
  iconAnchor: [14, 14],
});

// ── MapController ─────────────────────────────────────────────
/**
 * Helper component that lives inside MapContainer and can access
 * the Leaflet map instance via useMap().
 *
 * This centres the map on the driver's position the FIRST time
 * we get a GPS fix. After that, the driver can pan freely.
 * We use a ref (initialRef) to track whether the first centre has happened.
 */
function MapController({ position }) {
  const map        = useMap();
  const initialRef = useRef(false);

  useEffect(() => {
    // Only re-centre on the very first GPS position update
    if (position && !initialRef.current) {
      map.setView([position.lat, position.lng], 13);
      initialRef.current = true;
    }
  }, [position, map]);

  return null; // renders nothing — this component is only for side effects
}

// ── RouteView ─────────────────────────────────────────────────

export function RouteView({ run: initialRun, onComplete }) {
  // Keep a local copy of the run so we can update it (mark delivered, etc.)
  // without waiting for a server round-trip to re-render
  const [run, setRun]         = useState(initialRun);
  // Which stop is currently being marked as delivered (for loading state)
  const [delivering, setDelivering] = useState(null);

  // Start the GPS hook — begins watchPosition() immediately
  const { position } = useGPS(true);

  // Derived data from the run
  const route    = run.route || [];
  const pending  = route.filter(s => s.status !== 'delivered');  // stops not yet done
  const delivered = route.filter(s => s.status === 'delivered'); // completed stops
  const currentStop = pending[0]; // the NEXT stop to deliver (first pending in order)
  const allDone  = pending.length === 0;

  // ── Late warning detection ───────────────────────────────
  /**
   * Find pending stops whose window closes within 10 minutes from now.
   * These trigger a yellow banner at the top of the screen.
   * Runs on every render so it stays current as time passes.
   */
  function getLateWarnings() {
    const now     = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    return pending.filter(s => {
      const [closeH, closeM] = s.windowClose.split(':').map(Number);
      const closeMins = closeH * 60 + closeM;
      // Flag if we're within 10 minutes of the window closing
      return nowMins > closeMins - 10;
    });
  }

  // ── Mark delivered ────────────────────────────────────────
  /**
   * Called when driver taps "Mark Delivered" on a stop card.
   * PATCHes the backend, then updates local state to re-render.
   */
  async function markDelivered(stop) {
    setDelivering(stop.stopIndex); // show loading state on this stop's button
    try {
      const updated = await api.markDelivered(run.id, stop.stopIndex);
      setRun(updated); // replace local run with the fully updated one from server

      // If all stops are now delivered, transition to the complete screen
      // (small delay so the driver sees the checkmark before screen changes)
      if (updated.runStatus === 'complete') {
        setTimeout(onComplete, 600);
      }
    } catch (err) {
      alert('Failed to mark stop as delivered. Please try again.');
    } finally {
      setDelivering(null);
    }
  }

  /**
   * Open Google Maps navigation to this stop's address.
   * Uses the daddr (destination address) deep link format.
   * On mobile, this opens the Google Maps app if installed.
   */
  function openNavigation(stop) {
    const url = `https://maps.google.com/maps?daddr=${encodeURIComponent(stop.address)}&dirflg=d`;
    window.open(url, '_blank');
  }

  // ── Map configuration ─────────────────────────────────────

  // Default map centre: driver's GPS position, or first pending stop, or London fallback
  const mapCenter = position
    ? [position.lat, position.lng]
    : currentStop?.lat
    ? [currentStop.lat, currentStop.lng]
    : [51.5, -0.1]; // London fallback — not ideal but safe

  // The dashed blue route line: starts at driver's position,
  // runs through pending stops in their optimised order
  const polylinePoints = [
    ...(position ? [[position.lat, position.lng]] : []),
    ...pending.filter(s => s.lat && s.lng).map(s => [s.lat, s.lng]),
  ];

  const lateWarnings = getLateWarnings();

  // ── Render ────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--gray-50)', display: 'flex', flexDirection: 'column' }}>

      {/* Run stats header */}
      <div style={{ background: 'var(--navy)', color: 'var(--white)', padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '1rem', fontWeight: 700 }}>Active delivery run</h1>
            <p style={{ fontSize: '0.8rem', opacity: 0.75, marginTop: '0.15rem' }}>
              {delivered.length}/{route.length} delivered · {run.totalMinutes} min total
            </p>
          </div>
          {/* Large remaining stops count — easy to read at a glance while driving */}
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '0.75rem', opacity: 0.75 }}>Stops left</p>
            <p style={{ fontSize: '1.5rem', fontWeight: 800, lineHeight: 1 }}>{pending.length}</p>
          </div>
        </div>
      </div>

      {/* ── Real-time late warnings ──────────────────────── */}
      {/* These appear when a pending stop's window is about to close */}
      {lateWarnings.length > 0 && (
        <div style={{ padding: '0.75rem 1.25rem 0' }}>
          {lateWarnings.map(s => (
            <div key={s.stopIndex} className="alert alert-yellow" style={{ marginBottom: '0.5rem' }}>
              ⚠️ <strong>{s.name}</strong> — window closes at {s.windowClose}. You may be running late.
            </div>
          ))}
        </div>
      )}

      {/* ── Algorithm warnings (shown at run start) ─────── */}
      {/* Only show these before the driver has delivered anything */}
      {run.alerts?.length > 0 && delivered.length === 0 && (
        <div style={{ padding: '0.75rem 1.25rem 0' }}>
          {run.alerts.map((a, i) => (
            <div key={i} className="alert alert-yellow">⚠️ {a.message}</div>
          ))}
        </div>
      )}

      {/* ── Live map ─────────────────────────────────────── */}
      <div style={{
        height:       280,
        margin:       '0.75rem 1.25rem',
        borderRadius: 'var(--radius)',
        overflow:     'hidden',
        boxShadow:    'var(--shadow)',
      }}>
        <MapContainer
          center={mapCenter}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false} // hide zoom buttons on mobile (pinch to zoom instead)
        >
          {/* OpenStreetMap tiles — free, no API key needed for basic usage */}
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='© OpenStreetMap'
          />

          {/* Re-centres map on first GPS fix */}
          <MapController position={position} />

          {/* Dashed route line from driver to remaining stops */}
          {polylinePoints.length >= 2 && (
            <Polyline
              positions={polylinePoints}
              color="#2563eb"
              weight={3}
              opacity={0.7}
              dashArray="8 4" // dashed pattern: 8px dash, 4px gap
            />
          )}

          {/* Restaurant marker (starting point) */}
          {run.restaurant?.lat && (
            <Marker
              position={[run.restaurant.lat, run.restaurant.lng]}
              icon={restaurantIcon}
            >
              <Popup>🏪 Restaurant</Popup>
            </Marker>
          )}

          {/* Stop markers — colour depends on status */}
          {route.map(stop => stop.lat && stop.lng && (
            <Marker
              key={stop.stopIndex}
              position={[stop.lat, stop.lng]}
              icon={makeStopIcon(
                stop.position,
                // Teal = current stop, blue = pending, grey = delivered
                stop.stopIndex === currentStop?.stopIndex ? '#0d9488' : '#2563eb',
                stop.status === 'delivered'
              )}
            >
              <Popup>
                <strong>{stop.name}</strong><br />
                {stop.address}<br />
                Window: {stop.windowOpen} – {stop.windowClose}<br />
                ETA: {stop.arrivalTime}
              </Popup>
            </Marker>
          ))}

          {/* Driver position dot — updates every 5s as GPS changes */}
          {position && (
            <Marker position={[position.lat, position.lng]} icon={driverIcon}>
              <Popup>📍 Your location</Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      {/* ── Stop cards list ───────────────────────────────── */}
      <div style={{ padding: '0 1.25rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {route.map((stop) => {
          const isCurrent = stop.stopIndex === currentStop?.stopIndex;
          const isDone    = stop.status === 'delivered';

          return (
            <div
              key={stop.stopIndex}
              className="card"
              style={{
                padding:    '1rem 1.25rem',
                opacity:    isDone ? 0.6 : 1, // fade delivered stops
                // Left border colour indicates stop status at a glance
                borderLeft: isCurrent
                  ? '4px solid var(--teal)'   // current stop = teal
                  : isDone
                  ? '4px solid var(--green)'  // delivered = green
                  : '4px solid var(--gray-200)', // upcoming = grey
              }}
            >
              {/* Stop header: number badge + name + status badge */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  {/* Circular number/check badge */}
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: isDone ? 'var(--gray-200)' : isCurrent ? 'var(--teal)' : 'var(--blue)',
                    color:      'var(--white)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.8rem', fontWeight: 700,
                  }}>
                    {isDone ? '✓' : stop.position}
                  </div>
                  <div>
                    <p style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.95rem' }}>
                      {stop.name}
                    </p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--gray-600)', marginTop: '0.1rem' }}>
                      {stop.address}
                    </p>
                  </div>
                </div>
                {/* Status badge: Done / Next / Stop N */}
                <span className={`badge ${isDone ? 'badge-green' : isCurrent ? 'badge-blue' : 'badge-gray'}`}>
                  {isDone ? 'Done' : isCurrent ? 'Next' : `Stop ${stop.position}`}
                </span>
              </div>

              {/* Time details: window + ETA + wait time */}
              <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--gray-600)', marginBottom: isDone ? 0 : '0.75rem' }}>
                <span>⏰ {stop.windowOpen} – {stop.windowClose}</span>
                <span>🕐 ETA {stop.arrivalTime}</span>
                {/* Show wait time if the driver arrives early at this stop */}
                {stop.waitMinutes > 0 && (
                  <span style={{ color: 'var(--amber)' }}>
                    ⏳ +{stop.waitMinutes}min wait
                  </span>
                )}
              </div>

              {/* Action buttons — only shown for pending stops */}
              {!isDone && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {/* Navigate: opens Google Maps app with this address */}
                  <button
                    onClick={() => openNavigation(stop)}
                    className="btn-teal"
                    style={{ flex: 1, padding: '0.65rem', fontSize: '0.85rem' }}
                  >
                    🗺 Navigate
                  </button>

                  {/* Mark Delivered: only on the CURRENT (next) stop */}
                  {/* We don't allow skipping ahead — must deliver in order */}
                  {isCurrent && (
                    <button
                      onClick={() => markDelivered(stop)}
                      disabled={delivering === stop.stopIndex}
                      className="btn-green"
                      style={{ flex: 1, padding: '0.65rem', fontSize: '0.85rem' }}
                    >
                      {delivering === stop.stopIndex ? '...' : '✓ Delivered'}
                    </button>
                  )}
                </div>
              )}

              {/* Delivered: show the actual time delivery happened */}
              {isDone && stop.actualDeliveryTime && (
                <p style={{ fontSize: '0.8rem', color: 'var(--green)', fontWeight: 600 }}>
                  ✓ Delivered at {stop.actualDeliveryTime}
                </p>
              )}
            </div>
          );
        })}

        <div style={{ height: '1rem' }} /> {/* bottom padding for scroll */}
      </div>
    </div>
  );
}
