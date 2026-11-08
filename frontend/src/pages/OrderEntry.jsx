// frontend/src/pages/OrderEntry.jsx
// Map-centric order entry: Driver taps on Google Map or searches to place
// the restaurant and delivery stops, with user-friendly quick time presets.

import { useState, useEffect, useRef } from 'react';
import AddressInput from '../components/AddressInput';
import api from '../utils/api';
import { loadGoogleMaps, DEFAULT_CENTER } from '../utils/maps';

// Helper: current time as "HH:MM"
const now = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Helper: add minutes to a base time string "HH:MM" (or now)
const addMinutesToTime = (timeStr, mins) => {
  const d = new Date();
  if (timeStr && timeStr.includes(':')) {
    const [h, m] = timeStr.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  const target = new Date(d.getTime() + mins * 60 * 1000);
  return `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
};

// Blank stop factory with prefilled friendly time window
const createStop = (depTime, index = 0) => {
  const openMins = 15 + index * 15;
  const closeMins = openMins + 30;
  return {
    name: '',
    address: '',
    lat: null,
    lng: null,
    windowOpen: addMinutesToTime(depTime, openMins),
    windowClose: addMinutesToTime(depTime, closeMins),
  };
};

export default function OrderEntry({ onRunStarted }) {
  const [departureTime, setDepartureTime] = useState(now());
  const [restaurant, setRestaurant] = useState({ address: '', lat: null, lng: null });
  const [stops, setStops] = useState([createStop(now(), 0)]);

  // Which pin is currently being placed on the map: 'restaurant' or stop index (0, 1, 2...)
  const [activeTarget, setActiveTarget] = useState('restaurant');
  const activeTargetRef = useRef(activeTarget);
  activeTargetRef.current = activeTarget;

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [globalError, setGlobalError] = useState('');
  const [geocodingMap, setGeocodingMap] = useState(false);

  // Map references
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const geocoderRef = useRef(null);
  const restMarkerRef = useRef(null);
  const stopMarkersRef = useRef([]);
  const previewLineRef = useRef(null);

  // ── 1. Initialize Google Map
  useEffect(() => {
    let isMounted = true;

    loadGoogleMaps()
      .then((maps) => {
        if (!isMounted || !mapDivRef.current) return;

        geocoderRef.current = new maps.Geocoder();

        const map = new maps.Map(mapDivRef.current, {
          center: DEFAULT_CENTER,
          zoom: 13,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          styles: [
            { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
          ],
        });
        mapRef.current = map;

        // Try getting driver's current location to center map
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (!isMounted) return;
              map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            },
            () => {} // fallback to default center
          );
        }

        // Tap/Click on Map to place location for active target
        map.addListener('click', (e) => {
          const lat = e.latLng.lat();
          const lng = e.latLng.lng();
          handleMapClickCoords(lat, lng);
        });
      })
      .catch((err) => {
        console.error('Failed to load Google Maps:', err);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // ── 2. Handle map click / reverse geocoding
  const handleMapClickCoords = (lat, lng, explicitTarget) => {
    setGeocodingMap(true);
    setErrors({});

    const currentTarget = explicitTarget !== undefined ? explicitTarget : activeTargetRef.current;
    const currentStops = stopsRef.current;

    const geocoder = geocoderRef.current || (window.google?.maps && new window.google.maps.Geocoder());
    if (!geocoder) {
      applyCoordsToTarget(`Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`, lat, lng, currentTarget, currentStops);
      setGeocodingMap(false);
      return;
    }

    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      setGeocodingMap(false);
      const addressText = (status === 'OK' && results?.[0]?.formatted_address)
        ? results[0].formatted_address
        : `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

      applyCoordsToTarget(addressText, lat, lng, currentTarget, currentStops);
    });
  };

  const applyCoordsToTarget = (address, lat, lng, target, currentStops) => {
    if (target === 'restaurant') {
      setRestaurant({ address, lat, lng });
      // If stop 0 has no location yet, automatically switch focus to stop 0 for next tap
      if (!currentStops[0]?.lat) {
        setActiveTarget(0);
      }
    } else {
      const idx = typeof target === 'number' ? target : 0;
      setStops((prev) =>
        prev.map((s, i) => (i === idx ? { ...s, address, lat, lng } : s))
      );
    }
  };

  // ── 3. Synchronize Map Markers & Preview Route Line
  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return;
    const maps = window.google.maps;
    const map = mapRef.current;

    // Restaurant marker
    if (restaurant.lat && restaurant.lng) {
      const pos = { lat: restaurant.lat, lng: restaurant.lng };
      if (!restMarkerRef.current) {
        restMarkerRef.current = new maps.Marker({
          position: pos,
          map,
          draggable: true,
          title: 'Restaurant (Start point)',
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 13,
            fillColor: '#10b981',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 3,
          },
          label: { text: '🏪', fontSize: '13px' },
        });

        restMarkerRef.current.addListener('dragend', (e) => {
          handleMapClickCoords(e.latLng.lat(), e.latLng.lng(), 'restaurant');
        });
      } else {
        restMarkerRef.current.setPosition(pos);
      }
    } else if (restMarkerRef.current) {
      restMarkerRef.current.setMap(null);
      restMarkerRef.current = null;
    }

    // Stop markers
    stopMarkersRef.current.forEach((m) => m?.setMap(null));
    stopMarkersRef.current = [];

    stops.forEach((stop, i) => {
      if (!stop.lat || !stop.lng) return;
      const pos = { lat: stop.lat, lng: stop.lng };
      const isSelected = activeTarget === i;

      const marker = new maps.Marker({
        position: pos,
        map,
        draggable: true,
        title: `Stop ${i + 1}: ${stop.address}`,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: isSelected ? 15 : 12,
          fillColor: isSelected ? '#2563eb' : '#64748b',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: isSelected ? 4 : 2,
        },
        label: {
          text: String(i + 1),
          color: '#ffffff',
          fontWeight: 'bold',
          fontSize: '12px',
        },
        zIndex: isSelected ? 999 : 100 + i,
      });

      marker.addListener('click', () => {
        setActiveTarget(i);
      });

      marker.addListener('dragend', (e) => {
        setActiveTarget(i);
        handleMapClickCoords(e.latLng.lat(), e.latLng.lng(), i);
      });

      stopMarkersRef.current.push(marker);
    });

    // Preview Line
    const linePath = [];
    if (restaurant.lat && restaurant.lng) {
      linePath.push({ lat: restaurant.lat, lng: restaurant.lng });
    }
    stops.forEach((s) => {
      if (s.lat && s.lng) linePath.push({ lat: s.lat, lng: s.lng });
    });

    if (previewLineRef.current) {
      previewLineRef.current.setMap(null);
      previewLineRef.current = null;
    }

    if (linePath.length >= 2) {
      previewLineRef.current = new maps.Polyline({
        path: linePath,
        geodesic: true,
        strokeColor: '#2563eb',
        strokeOpacity: 0.6,
        strokeWeight: 4,
        icons: [
          {
            icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
            offset: '0',
            repeat: '15px',
          },
        ],
        map,
      });
    }
  }, [restaurant, stops, activeTarget]);

  // ── 4. Helper actions
  const addStop = () => {
    if (stops.length >= 8) return;
    const newIdx = stops.length;
    setStops((prev) => [...prev, createStop(departureTime, newIdx)]);
    setActiveTarget(newIdx);
  };

  const removeStop = (idx) => {
    if (stops.length <= 1) return;
    setStops((prev) => prev.filter((_, i) => i !== idx));
    setActiveTarget('restaurant');
  };

  const updateStopField = (i, field, value) => {
    setStops((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s))
    );
  };

  // Quick friendly preset button handler for time window
  const applyQuickWindow = (i, durationMins) => {
    const openTime = addMinutesToTime(departureTime, 10);
    const closeTime = addMinutesToTime(departureTime, durationMins);
    setStops((prev) =>
      prev.map((s, idx) =>
        idx === i ? { ...s, windowOpen: openTime, windowClose: closeTime } : s
      )
    );
  };

  // ── 5. Form Validation & Submission
  const validate = () => {
    const errs = {};
    if (!(restaurant.address || '').trim()) {
      errs.restaurant = 'Restaurant start location required';
    }

    stops.forEach((s, i) => {
      if (!(s.address || '').trim()) errs[`stop_${i}_address`] = 'Delivery address required';
      if (!s.windowOpen) errs[`stop_${i}_open`] = 'Required';
      if (!s.windowClose) errs[`stop_${i}_close`] = 'Required';
      if (s.windowOpen && s.windowClose && s.windowClose <= s.windowOpen) {
        errs[`stop_${i}_close`] = 'Must be after open time';
      }
    });

    if (!departureTime) errs.departure = 'Departure time required';
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    setErrors(errs);
    setGlobalError('');

    if (Object.keys(errs).length > 0) {
      // If restaurant error, select restaurant tab
      if (errs.restaurant) {
        setActiveTarget('restaurant');
      } else {
        // Find first stop with error
        for (let i = 0; i < stops.length; i++) {
          if (errs[`stop_${i}_address`] || errs[`stop_${i}_open`] || errs[`stop_${i}_close`]) {
            setActiveTarget(i);
            break;
          }
        }
      }
      return;
    }

    setLoading(true);
    try {
      const payload = {
        restaurant: {
          address: restaurant.address,
          lat: restaurant.lat,
          lng: restaurant.lng,
        },
        stops: stops.map((s) => ({
          name: s.name || s.address.split(',')[0],
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          windowOpen: s.windowOpen,
          windowClose: s.windowClose,
        })),
        departureTime,
      };

      const run = await api.startRun(payload);
      onRunStarted(run);
    } catch (err) {
      setGlobalError(err.message || 'Failed to calculate route. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const currentActiveStop = typeof activeTarget === 'number' ? stops[activeTarget] : null;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

      {/* ── TOP FLOATING CONTROL BAR ──────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        top: '12px',
        left: '12px',
        right: '12px',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}>
        {/* Top Header & Departure Bar */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(8px)',
          borderRadius: '16px',
          padding: '10px 14px',
          boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '18px' }}>🚴</span>
            <strong style={{ fontSize: '14px', color: '#0f172a' }}>Delivery Planner</strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: '#64748b' }}>Depart:</span>
            <input
              type="time"
              value={departureTime}
              onChange={(e) => setDepartureTime(e.target.value)}
              onInput={(e) => setDepartureTime(e.target.value)}
              onBlur={(e) => setDepartureTime(e.target.value)}
              style={{
                padding: '4px 8px',
                fontSize: '13px',
                fontWeight: 700,
                width: 'auto',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
              }}
            />
          </div>
        </div>

        {/* Target Switcher Tabs: [🏪 Restaurant] [📦 Stop 1] [+ Add Stop] */}
        <div style={{
          display: 'flex',
          gap: '6px',
          overflowX: 'auto',
          paddingBottom: '2px',
          scrollbarWidth: 'none',
        }}>
          {/* Restaurant Tab */}
          <button
            onClick={() => setActiveTarget('restaurant')}
            style={{
              padding: '8px 12px',
              borderRadius: '12px',
              fontSize: '13px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              background: activeTarget === 'restaurant' ? '#10b981' : 'rgba(255, 255, 255, 0.95)',
              color: activeTarget === 'restaurant' ? '#ffffff' : '#334155',
              border: activeTarget === 'restaurant' ? 'none' : '1px solid #cbd5e1',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
          >
            <span>🏪</span>
            <span>Restaurant</span>
            {restaurant.lat && <span style={{ color: activeTarget === 'restaurant' ? '#fff' : '#10b981' }}>✓</span>}
          </button>

          {/* Stops Tabs */}
          {stops.map((s, i) => {
            const isSelected = activeTarget === i;
            const hasLocation = Boolean(s.lat && s.lng);
            return (
              <button
                key={i}
                onClick={() => setActiveTarget(i)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '12px',
                  fontSize: '13px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap',
                  background: isSelected ? '#2563eb' : 'rgba(255, 255, 255, 0.95)',
                  color: isSelected ? '#ffffff' : '#334155',
                  border: isSelected ? 'none' : '1px solid #cbd5e1',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                }}
              >
                <span>📦</span>
                <span>Stop {i + 1}</span>
                {hasLocation && <span style={{ color: isSelected ? '#fff' : '#2563eb' }}>✓</span>}
              </button>
            );
          })}

          {/* + Add Stop Tab */}
          {stops.length < 8 && (
            <button
              onClick={addStop}
              style={{
                padding: '8px 12px',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 700,
                background: 'rgba(255, 255, 255, 0.9)',
                color: '#2563eb',
                border: '1.5px dashed #2563eb',
                whiteSpace: 'nowrap',
              }}
            >
              + Add Stop
            </button>
          )}
        </div>

        {/* Global Error Notice if any */}
        {globalError && (
          <div className="alert alert-red" style={{ margin: 0, padding: '8px 12px', fontSize: '13px' }}>
            ⚠️ {globalError}
          </div>
        )}
      </div>

      {/* ── INTERACTIVE GOOGLE MAP ────────────────────────────────────── */}
      <div ref={mapDivRef} style={{ flex: 1, width: '100%', height: '100%' }} />

      {/* Map Tap Guide Banner */}
      <div style={{
        position: 'absolute',
        top: '120px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 5,
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        color: '#ffffff',
        padding: '5px 12px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 600,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}>
        <span>📍</span>
        <span>
          {geocodingMap
            ? 'Resolving address…'
            : activeTarget === 'restaurant'
            ? 'Tap map to place Restaurant (Start)'
            : `Tap map to place Stop ${activeTarget + 1}`}
        </span>
      </div>

      {/* ── BOTTOM DRAWER: Address Search, Time Window & Submit ──────── */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        background: '#ffffff',
        borderTopLeftRadius: '22px',
        borderTopRightRadius: '22px',
        boxShadow: '0 -8px 30px rgba(0, 0, 0, 0.15)',
        padding: '16px 18px 20px',
        maxHeight: '48dvh',
        overflowY: 'auto',
      }}>

        {/* Active Target Header & Address Input */}
        {activeTarget === 'restaurant' ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>🏪</span> Restaurant Starting Location
              </div>
              <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>Start Point</span>
            </div>

            <AddressInput
              value={restaurant.address}
              onChange={(val) => setRestaurant((r) => ({ ...r, address: val, lat: null, lng: null }))}
              onSelect={(s) => {
                const addr = s.address || s.label || '';
                setRestaurant({ address: addr, lat: s.lat, lng: s.lng });
                if (mapRef.current && s.lat && s.lng) {
                  mapRef.current.panTo({ lat: s.lat, lng: s.lng });
                  mapRef.current.setZoom(15);
                }
              }}
              placeholder="Search restaurant or tap map above…"
              error={errors.restaurant}
            />
          </div>
        ) : (
          currentActiveStop && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>📦</span> Stop {activeTarget + 1}
                </div>
                {stops.length > 1 && (
                  <button
                    onClick={() => removeStop(activeTarget)}
                    style={{
                      background: 'none',
                      color: '#ef4444',
                      fontSize: '13px',
                      fontWeight: 700,
                      padding: 0,
                    }}
                  >
                    Delete Stop
                  </button>
                )}
              </div>

              {/* Customer Name (Optional) */}
              <input
                type="text"
                placeholder="Customer name (optional)"
                value={currentActiveStop.name}
                onChange={(e) => updateStopField(activeTarget, 'name', e.target.value)}
                style={{
                  padding: '8px 12px',
                  fontSize: '14px',
                  marginBottom: '8px',
                  borderRadius: '8px',
                }}
              />

              {/* Delivery Address */}
              <AddressInput
                value={currentActiveStop.address}
                onChange={(val) => updateStopField(activeTarget, 'address', val)}
                onSelect={(s) => {
                  const addr = s.address || s.label || '';
                  setStops((prev) =>
                    prev.map((st, idx) =>
                      idx === activeTarget ? { ...st, address: addr, lat: s.lat, lng: s.lng } : st
                    )
                  );
                  if (mapRef.current && s.lat && s.lng) {
                    mapRef.current.panTo({ lat: s.lat, lng: s.lng });
                    mapRef.current.setZoom(15);
                  }
                }}
                placeholder="Search delivery address or tap map…"
                error={errors[`stop_${activeTarget}_address`]}
              />

              {/* ── Simple & Friendly Time Window Selection ── */}
              <div style={{ marginTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                    ⏱ Delivery Time Window
                  </span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Quick presets:</span>
                </div>

                {/* Quick Presets Chips */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  {[
                    { label: '⚡ 20m', mins: 20 },
                    { label: '🕐 35m', mins: 35 },
                    { label: '📦 50m', mins: 50 },
                    { label: '⏱ 1 hr', mins: 60 },
                  ].map((preset, pIdx) => (
                    <button
                      key={pIdx}
                      type="button"
                      onClick={() => applyQuickWindow(activeTarget, preset.mins)}
                      style={{
                        flex: 1,
                        padding: '6px 4px',
                        fontSize: '12px',
                        fontWeight: 700,
                        background: '#f1f5f9',
                        color: '#1e293b',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Manual Time Input Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
                      Earliest (Open)
                    </label>
                    <input
                      type="time"
                      value={currentActiveStop.windowOpen}
                      onChange={(e) => updateStopField(activeTarget, 'windowOpen', e.target.value)}
                      onInput={(e) => updateStopField(activeTarget, 'windowOpen', e.target.value)}
                      onBlur={(e) => updateStopField(activeTarget, 'windowOpen', e.target.value)}
                      className={errors[`stop_${activeTarget}_open`] ? 'error' : ''}
                      style={{ padding: '6px 8px', fontSize: '13px' }}
                    />
                    {errors[`stop_${activeTarget}_open`] && (
                      <p style={{ color: '#ef4444', fontSize: '11px', marginTop: '2px' }}>
                        {errors[`stop_${activeTarget}_open`]}
                      </p>
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
                      Latest (Deadline)
                    </label>
                    <input
                      type="time"
                      value={currentActiveStop.windowClose}
                      onChange={(e) => updateStopField(activeTarget, 'windowClose', e.target.value)}
                      onInput={(e) => updateStopField(activeTarget, 'windowClose', e.target.value)}
                      onBlur={(e) => updateStopField(activeTarget, 'windowClose', e.target.value)}
                      className={errors[`stop_${activeTarget}_close`] ? 'error' : ''}
                      style={{ padding: '6px 8px', fontSize: '13px' }}
                    />
                    {errors[`stop_${activeTarget}_close`] && (
                      <p style={{ color: '#ef4444', fontSize: '11px', marginTop: '2px' }}>
                        {errors[`stop_${activeTarget}_close`]}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        )}

        {/* ── Main Submission Button ── */}
        <div style={{ marginTop: '14px' }}>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="btn-primary"
            style={{
              padding: '14px',
              fontSize: '1.05rem',
              fontWeight: 800,
              borderRadius: '14px',
              background: '#2563eb',
              boxShadow: '0 4px 15px rgba(37, 99, 235, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            {loading ? (
              <>
                <div className="spinner" style={{ width: 18, height: 18, borderTopColor: '#ffffff' }} />
                <span>Optimizing Route…</span>
              </>
            ) : (
              <span>🗺 Calculate Optimal Route ({stops.length} {stops.length === 1 ? 'stop' : 'stops'})</span>
            )}
          </button>
        </div>

      </div>

    </div>
  );
}
