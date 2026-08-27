// ============================================================
// frontend/src/hooks/useGPS.js
// ============================================================
// Custom React hook for live driver GPS tracking via the browser.
//
// HOW BROWSER GPS WORKS:
//   navigator.geolocation is a built-in browser API that accesses
//   the device's GPS, WiFi positioning, and cell tower triangulation.
//   On phones it's very accurate (3–10 metres with clear sky).
//
//   watchPosition() is the continuous version — unlike getCurrentPosition()
//   which fires once, watchPosition() calls the callback every time
//   the device detects meaningful movement. This is what we use.
//
// WHAT THIS HOOK DOES:
//   1. Starts watching the phone's GPS when the hook mounts
//   2. On each position update, saves it in React state (for the map)
//   3. Also sends the position to the backend server (throttled to
//      once every 5 seconds to avoid hammering the API)
//   4. Handles all error cases (permission denied, GPS unavailable, etc.)
//   5. Cleans up (stops watching) when the component unmounts
//
// USAGE:
//   const { position, error, permissionDenied } = useGPS(true);
//   // position = { lat, lng, accuracy } or null
//   // error    = string error message or null
//
// V2 NOTE:
//   In V2, GPS comes from the FMC920 IoT device via 4G, not the phone.
//   This hook can be disabled or removed entirely in V2.
// ============================================================

import { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';

// Minimum time between server updates (milliseconds).
// Even if the phone fires GPS updates more frequently, we throttle
// server calls to this interval to save API quota and bandwidth.
const UPDATE_INTERVAL_MS = 5000; // 5 seconds

/**
 * @param {boolean} enabled - Set to false to stop tracking (e.g. on non-route screens)
 * @returns {{ position, error, permissionDenied }}
 */
export function useGPS(enabled = true) {
  // Current GPS position — null until first fix is obtained
  const [position, setPosition]               = useState(null);
  // Error message string — null when everything is working
  const [error, setError]                     = useState(null);
  // True specifically when the user denied location permission
  // (used to show a more specific message to the driver)
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Track when we last sent a position update to the server.
  // useRef instead of useState because changing it should NOT
  // trigger a re-render — it's just bookkeeping.
  const lastSentRef  = useRef(0);

  // Store the watchPosition ID so we can cancel it on cleanup.
  const watchIdRef   = useRef(null);

  useEffect(() => {
    // Don't start watching if the hook is disabled
    if (!enabled) return;

    // Check if the browser supports geolocation at all
    // (very old browsers or certain non-HTTPS environments don't)
    if (!navigator.geolocation) {
      setError('GPS not available in this browser');
      return;
    }

    // Start continuously watching the GPS position.
    // watchPosition() returns a numeric ID used to stop watching later.
    watchIdRef.current = navigator.geolocation.watchPosition(
      // ── Success callback ────────────────────────────────────
      // Called every time the device gets a new GPS fix
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;

        // Update React state → triggers map re-render with new position
        setPosition({ lat, lng, accuracy });
        setError(null);
        setPermissionDenied(false);

        // Throttle: only send to server if enough time has passed
        const now = Date.now();
        if (now - lastSentRef.current >= UPDATE_INTERVAL_MS) {
          lastSentRef.current = now;
          // Fire-and-forget — we don't await or show errors for this
          // (a failed location update is not critical)
          api.postLocation(lat, lng, accuracy).catch(() => {});
        }
      },

      // ── Error callback ──────────────────────────────────────
      // Called when GPS fails. err.code tells us why.
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          // User tapped "Block" on the location permission prompt
          setPermissionDenied(true);
          setError('Location permission denied. Enable in browser settings.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          // GPS signal lost (underground, indoors, etc.)
          setError('GPS signal unavailable. Move to an open area.');
        } else {
          // Timeout or other error
          setError('Could not get location: ' + err.message);
        }
      },

      // ── Options ─────────────────────────────────────────────
      {
        enableHighAccuracy: true,   // use GPS chip, not just WiFi/cell (slower but more accurate)
        maximumAge:         5000,   // accept cached position if it's less than 5s old
        timeout:            10000,  // give up and call error callback after 10s
      }
    );

    // Cleanup function — React calls this when:
    //   - The component using this hook unmounts (e.g. driver leaves route screen)
    //   - The 'enabled' prop changes from true to false
    // Stopping the watch saves battery and stops sending location to server.
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [enabled]); // re-run this effect if 'enabled' changes

  return { position, error, permissionDenied };
}
