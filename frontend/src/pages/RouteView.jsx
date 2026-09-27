// frontend/src/pages/RouteView.jsx
// Live route view: Google Maps JS API, driver GPS dot, stop markers

import { useEffect, useRef, useState } from 'react';
import api from '../utils/api';

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
// Default map center: Manisa, Turkey
const DEFAULT_CENTER = { lat: 38.6191, lng: 27.4289 };

// Load Google Maps JS SDK once
function loadGoogleMaps() {
  if (window.google?.maps) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}`;
    script.async = true;
    script.onload  = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export default function RouteView({ run, onComplete }) {
  const mapDiv    = useRef(null);
  const mapRef    = useRef(null);
  const markerRef = useRef(null);   // driver's live position marker
  const stopMarkersRef = useRef([]); // stop markers
  const watchRef  = useRef(null);

  const [currentIdx, setCurrentIdx]   = useState(0);
  const [driverPos,  setDriverPos]    = useState(null);
  const [gpsError,   setGpsError]     = useState(null);
  const [delivering, setDelivering]   = useState(false);

  const stops = run?.route || [];

  // ── Initialise Google Map
  useEffect(() => {
    loadGoogleMaps().then(() => {
      const map = new window.google.maps.Map(mapDiv.current, {
        center: DEFAULT_CENTER,
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      mapRef.current = map;

      // Place numbered markers for each stop
      stops.forEach((stop, i) => {
        if (!stop.lat || !stop.lng) return;
        const marker = new window.google.maps.Marker({
          position: { lat: stop.lat, lng: stop.lng },
          map,
          label: { text: String(i + 1), color: '#fff', fontWeight: 'bold' },
          title: stop.address,
        });
        stopMarkersRef.current.push(marker);
      });

      // Centre map on first stop if it has coords
      if (stops[0]?.lat) {
        map.setCenter({ lat: stops[0].lat, lng: stops[0].lng });
      }
    });

    return () => {
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  // ── Watch driver's GPS position
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation not supported');
      return;
    }
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        setDriverPos({ lat, lng });
        api.pushLocation({ lat, lng, accuracy }).catch(() => {});

        if (!mapRef.current) return;

        // Move or create the blue driver marker
        const pos2d = { lat, lng };
        if (markerRef.current) {
          markerRef.current.setPosition(pos2d);
        } else {
          markerRef.current = new window.google.maps.Marker({
            position: pos2d,
            map: mapRef.current,
            icon: {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: '#4285F4',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2,
            },
            title: 'You are here',
            zIndex: 999,
          });
        }
      },
      (err) => setGpsError(err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
    return () => {
      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  // ── Mark current stop delivered
  const handleDeliver = async () => {
    setDelivering(true);
    try {
      await api.markDelivered(run.id, currentIdx);
      if (currentIdx + 1 >= stops.length) {
        onComplete();
      } else {
        const next = currentIdx + 1;
        setCurrentIdx(next);
        // Pan to next stop
        if (mapRef.current && stops[next]?.lat) {
          mapRef.current.panTo({ lat: stops[next].lat, lng: stops[next].lng });
        }
      }
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setDelivering(false);
    }
  };

  const currentStop = stops[currentIdx];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>

      {/* Top bar */}
      <div style={{ padding: '12px 16px', background: '#1a1a2e', color: '#fff' }}>
        <div style={{ fontWeight: 'bold', fontSize: '16px' }}>
          Stop {currentIdx + 1} / {stops.length}
        </div>
        <div style={{ fontSize: '14px', marginTop: '4px', opacity: 0.85 }}>
          {currentStop?.address}
        </div>
        {currentStop?.windowOpen != null && (
          <div style={{ fontSize: '12px', marginTop: '2px', opacity: 0.7 }}>
            Window: {currentStop.windowOpen}:00 – {currentStop.windowClose}:00
          </div>
        )}
        {gpsError && (
          <div style={{ fontSize: '12px', color: '#ff6b6b', marginTop: '4px' }}>
            ⚠ GPS: {gpsError}
          </div>
        )}
      </div>

      {/* Map */}
      <div ref={mapDiv} style={{ flex: 1 }} />

      {/* Bottom: deliver button + stop list */}
      <div style={{ padding: '16px', background: '#fff', borderTop: '1px solid #eee' }}>
        <button
          onClick={handleDeliver}
          disabled={delivering}
          style={{
            width: '100%',
            padding: '14px',
            background: delivering ? '#ccc' : '#27ae60',
            color: '#fff',
            border: 'none',
            borderRadius: '10px',
            fontSize: '17px',
            fontWeight: 'bold',
            cursor: delivering ? 'default' : 'pointer',
            marginBottom: '14px',
          }}
        >
          {delivering ? 'Saving…' : '✅ Mark as Delivered'}
        </button>

        {/* Remaining stops */}
        <div style={{ fontSize: '13px', color: '#555' }}>
          {stops.map((s, i) => (
            <div
              key={i}
              style={{
                padding: '5px 0',
                opacity: i < currentIdx ? 0.4 : 1,
                textDecoration: i < currentIdx ? 'line-through' : 'none',
                fontWeight: i === currentIdx ? 'bold' : 'normal',
              }}
            >
              {i + 1}. {s.address}
              {i < currentIdx ? ' ✓' : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
