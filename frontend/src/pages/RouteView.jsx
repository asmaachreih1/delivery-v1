// frontend/src/pages/RouteView.jsx
// Live route view: Google Maps JS API with route polylines, directional arrows,
// driver GPS dot, stop markers, and live "time to reach" display.

import { useEffect, useRef, useState, useMemo } from 'react';
import api from '../utils/api';
import { loadGoogleMaps, DEFAULT_CENTER } from '../utils/maps';

export default function RouteView({ run, onComplete }) {
  const mapDiv = useRef(null);
  const mapRef = useRef(null);
  const driverMarkerRef = useRef(null);
  const stopMarkersRef = useRef([]);
  const polylinesRef = useRef([]);
  const watchRef = useRef(null);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [driverPos, setDriverPos] = useState(null);
  const [gpsError, setGpsError] = useState(null);
  const [delivering, setDelivering] = useState(false);
  const [mapsLoaded, setMapsLoaded] = useState(false);

  const stops = run?.route || [];
  const currentStop = stops[currentIdx];

  // Calculate travel time and ETA to current stop
  const timeToReachInfo = useMemo(() => {
    if (!currentStop) return { minutes: 0, eta: '--:--' };

    // If backend matrix is available, get exact minutes from previous location
    let travelMins = 0;
    if (run?.matrix) {
      if (currentIdx === 0) {
        // From restaurant (index 0) to stop 1 (stopIndex + 1)
        travelMins = run.matrix[0]?.[currentStop.stopIndex + 1] || 10;
      } else {
        const prevStop = stops[currentIdx - 1];
        travelMins = run.matrix[prevStop.stopIndex + 1]?.[currentStop.stopIndex + 1] || 10;
      }
    } else {
      travelMins = 12; // fallback default
    }

    const eta = currentStop.arrivalTime || '--:--';
    return { minutes: travelMins, eta };
  }, [run, currentIdx, currentStop, stops]);

  // ── Initialise Google Map & Markers
  useEffect(() => {
    let isMounted = true;

    loadGoogleMaps()
      .then((maps) => {
        if (!isMounted || !mapDiv.current) return;

        const initialCenter = run?.restaurant?.lat
          ? { lat: run.restaurant.lat, lng: run.restaurant.lng }
          : stops[0]?.lat
          ? { lat: stops[0].lat, lng: stops[0].lng }
          : DEFAULT_CENTER;

        const map = new maps.Map(mapDiv.current, {
          center: initialCenter,
          zoom: 14,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          styles: [
            { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
          ],
        });
        mapRef.current = map;
        setMapsLoaded(true);
      })
      .catch((err) => {
        console.error('Map loading error:', err);
      });

    return () => {
      isMounted = false;
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  // ── Render Map Elements (Markers & Route Lines)
  useEffect(() => {
    if (!mapsLoaded || !mapRef.current || !window.google?.maps) return;
    const maps = window.google.maps;
    const map = mapRef.current;

    // Clear previous stop markers & polylines
    stopMarkersRef.current.forEach((m) => m.setMap(null));
    stopMarkersRef.current = [];
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    const bounds = new maps.LatLngBounds();

    // 1. Restaurant Marker (Start Point)
    if (run?.restaurant?.lat && run?.restaurant?.lng) {
      const restPos = { lat: run.restaurant.lat, lng: run.restaurant.lng };
      bounds.extend(restPos);

      const restMarker = new maps.Marker({
        position: restPos,
        map,
        title: `Restaurant: ${run.restaurant.address || run.restaurant.display || ''}`,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: '#10b981', // green
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        },
        label: {
          text: '🏪',
          fontSize: '14px',
        },
      });
      stopMarkersRef.current.push(restMarker);
    }

    // 2. Delivery Stops Markers
    stops.forEach((stop, i) => {
      if (!stop.lat || !stop.lng) return;
      const pos = { lat: stop.lat, lng: stop.lng };
      bounds.extend(pos);

      const isDelivered = i < currentIdx;
      const isCurrent = i === currentIdx;

      const marker = new maps.Marker({
        position: pos,
        map,
        title: `${stop.name || `Stop ${i + 1}`}: ${stop.address}`,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: isCurrent ? 16 : 13,
          fillColor: isDelivered ? '#94a3b8' : isCurrent ? '#2563eb' : '#64748b',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: isCurrent ? 4 : 2,
        },
        label: {
          text: isDelivered ? '✓' : String(i + 1),
          color: '#ffffff',
          fontWeight: 'bold',
          fontSize: isDelivered ? '14px' : '12px',
        },
        zIndex: isCurrent ? 900 : 100 + i,
      });

      // InfoWindow with Time to Reach
      const infoWindow = new maps.InfoWindow({
        content: `
          <div style="font-family: sans-serif; padding: 4px 6px; font-size: 13px;">
            <strong style="color: #0f172a;">Stop ${i + 1}: ${stop.name || stop.address.split(',')[0]}</strong><br/>
            <span style="color: #64748b; font-size: 11px;">${stop.address}</span><br/>
            <div style="margin-top: 4px; display: inline-block; background: #dbeafe; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px;">
              ⏱ ETA: ${stop.arrivalTime || '--:--'}
            </div>
            ${stop.windowOpen ? `<div style="font-size: 11px; color: #475569; margin-top: 2px;">Window: ${stop.windowOpen} – ${stop.windowClose}</div>` : ''}
          </div>
        `,
      });

      marker.addListener('click', () => {
        infoWindow.open(map, marker);
      });

      stopMarkersRef.current.push(marker);
    });

    // 3. Draw Route Polyline with Directional Arrows
    // Build path points in order: Restaurant -> Stop 1 -> Stop 2 -> ...
    const fullPath = [];
    if (run?.restaurant?.lat && run?.restaurant?.lng) {
      fullPath.push({ lat: run.restaurant.lat, lng: run.restaurant.lng });
    }
    stops.forEach((s) => {
      if (s.lat && s.lng) fullPath.push({ lat: s.lat, lng: s.lng });
    });

    if (fullPath.length >= 2) {
      // Completed legs (if any) in lighter gray/muted color
      if (currentIdx > 0) {
        const completedPath = fullPath.slice(0, currentIdx + 1);
        const completedLine = new maps.Polyline({
          path: completedPath,
          geodesic: true,
          strokeColor: '#94a3b8',
          strokeOpacity: 0.6,
          strokeWeight: 4,
          map,
        });
        polylinesRef.current.push(completedLine);
      }

      // Active & upcoming legs in vibrant delivery blue with directional arrows
      const activePath = fullPath.slice(Math.max(0, currentIdx));
      if (activePath.length >= 2) {
        // Line shadow/casing
        const lineShadow = new maps.Polyline({
          path: activePath,
          geodesic: true,
          strokeColor: '#1e3a8a',
          strokeOpacity: 0.3,
          strokeWeight: 8,
          map,
        });
        polylinesRef.current.push(lineShadow);

        // Vibrant main line with arrow icons
        const mainLine = new maps.Polyline({
          path: activePath,
          geodesic: true,
          strokeColor: '#2563eb', // delivery blue
          strokeOpacity: 0.95,
          strokeWeight: 5,
          icons: [
            {
              icon: {
                path: maps.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 2.8,
                fillColor: '#ffffff',
                fillOpacity: 1,
                strokeColor: '#1d4ed8',
                strokeWeight: 1.5,
              },
              offset: '30%',
              repeat: '80px',
            },
          ],
          map,
        });
        polylinesRef.current.push(mainLine);
      }
    }

    // Fit map bounds to view all stops nicely
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { top: 70, right: 30, bottom: 200, left: 30 });
    }
  }, [mapsLoaded, run, currentIdx, stops]);

  // ── Watch driver's live GPS position & connect live line to destination
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation not supported on this device');
      return;
    }

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        const driverLatLng = { lat, lng };
        setDriverPos(driverLatLng);
        setGpsError(null);
        api.pushLocation({ lat, lng, accuracy }).catch(() => {});

        if (!mapRef.current || !window.google?.maps) return;
        const maps = window.google.maps;

        // Create or update blue live driver GPS marker
        if (driverMarkerRef.current) {
          driverMarkerRef.current.setPosition(driverLatLng);
        } else {
          driverMarkerRef.current = new maps.Marker({
            position: driverLatLng,
            map: mapRef.current,
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 9,
              fillColor: '#3b82f6',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 3,
            },
            title: 'Your live position',
            zIndex: 999,
          });
        }
      },
      (err) => setGpsError(err.message),
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 8000 }
    );

    return () => {
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  // ── Mark current stop as delivered
  const handleDeliver = async () => {
    setDelivering(true);
    try {
      await api.markDelivered(run.id, currentIdx);
      if (currentIdx + 1 >= stops.length) {
        onComplete();
      } else {
        const next = currentIdx + 1;
        setCurrentIdx(next);
        if (mapRef.current && stops[next]?.lat) {
          mapRef.current.panTo({ lat: stops[next].lat, lng: stops[next].lng });
        }
      }
    } catch (e) {
      alert('Error updating stop: ' + e.message);
    } finally {
      setDelivering(false);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

      {/* ── TOP HUD: Live Route Navigation & Time to Reach ──────────────── */}
      <div style={{
        position: 'absolute',
        top: '12px',
        left: '12px',
        right: '12px',
        zIndex: 10,
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(8px)',
        borderRadius: '16px',
        color: '#ffffff',
        padding: '14px 16px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              background: '#2563eb',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: '999px',
            }}>
              STOP {currentIdx + 1} OF {stops.length}
            </span>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>
              {currentStop?.name ? currentStop.name : 'Next Destination'}
            </span>
          </div>

          {/* Time to reach badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(37, 99, 235, 0.25)',
            border: '1px solid #3b82f6',
            padding: '4px 10px',
            borderRadius: '12px',
          }}>
            <span style={{ fontSize: '14px' }}>⏱</span>
            <span style={{ fontSize: '14px', fontWeight: 800, color: '#60a5fa' }}>
              ~{timeToReachInfo.minutes} min to reach
            </span>
          </div>
        </div>

        {/* Destination Address */}
        <div style={{
          marginTop: '8px',
          fontSize: '15px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {currentStop?.address || 'Loading destination…'}
        </div>

        {/* ETA & Window detail */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          fontSize: '12px',
        }}>
          <div>
            <span style={{ color: '#94a3b8' }}>Arrival ETA: </span>
            <strong style={{ color: '#34d399', fontSize: '13px' }}>{timeToReachInfo.eta}</strong>
          </div>
          {currentStop?.windowOpen && (
            <div style={{ color: '#cbd5e1' }}>
              Window: <strong>{currentStop.windowOpen}</strong> – <strong>{currentStop.windowClose}</strong>
            </div>
          )}
        </div>

        {gpsError && (
          <div style={{ fontSize: '11px', color: '#f87171', marginTop: '6px' }}>
            ⚠️ GPS: {gpsError}
          </div>
        )}
      </div>

      {/* ── MAP CONTAINER ────────────────────────────────────────────── */}
      <div ref={mapDiv} style={{ flex: 1, width: '100%', height: '100%' }} />

      {/* ── BOTTOM SHEET: Action & Stops Drawer ───────────────────────── */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        background: '#ffffff',
        borderTopLeftRadius: '20px',
        borderTopRightRadius: '20px',
        boxShadow: '0 -10px 25px rgba(0, 0, 0, 0.15)',
        padding: '16px',
        maxHeight: '40dvh',
        overflowY: 'auto',
      }}>
        {/* Main Action Button */}
        <button
          onClick={handleDeliver}
          disabled={delivering}
          className="btn-primary"
          style={{
            width: '100%',
            padding: '16px',
            fontSize: '1.1rem',
            fontWeight: 800,
            borderRadius: '14px',
            background: delivering ? '#94a3b8' : '#16a34a',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            boxShadow: '0 4px 14px rgba(22, 163, 74, 0.35)',
            marginBottom: '12px',
          }}
        >
          {delivering ? (
            'Saving delivery…'
          ) : (
            <>
              <span>✅</span>
              <span>Mark Stop {currentIdx + 1} as Delivered</span>
            </>
          )}
        </button>

        {/* Route Stops Overview List */}
        <div style={{ fontSize: '13px', color: '#64748b' }}>
          <div style={{ fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', marginBottom: '6px' }}>
            Remaining Route ({stops.length - currentIdx} stops left)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {stops.map((s, i) => {
              const isDelivered = i < currentIdx;
              const isCurrent = i === currentIdx;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: isCurrent ? '#eff6ff' : isDelivered ? '#f8fafc' : '#ffffff',
                    border: isCurrent ? '1.5px solid #3b82f6' : '1px solid #e2e8f0',
                    opacity: isDelivered ? 0.6 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                    <span style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      background: isDelivered ? '#10b981' : isCurrent ? '#2563eb' : '#64748b',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}>
                      {isDelivered ? '✓' : i + 1}
                    </span>
                    <span style={{
                      fontSize: '13px',
                      fontWeight: isCurrent ? 700 : 500,
                      color: isCurrent ? '#1e3a8a' : '#334155',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {s.address}
                    </span>
                  </div>

                  <div style={{ fontSize: '12px', fontWeight: 600, color: isCurrent ? '#2563eb' : '#64748b', flexShrink: 0, marginLeft: '8px' }}>
                    {isDelivered ? 'Delivered' : s.arrivalTime ? `ETA ${s.arrivalTime}` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
