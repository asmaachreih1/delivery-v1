// frontend/src/components/AddressInput.jsx
// Address autocomplete using Google Places (via backend proxy)
// When a suggestion is picked, resolves place_id → lat/lng and calls onSelect({ address, lat, lng })

import { useState, useRef, useCallback } from 'react';
import api from '../utils/api';

// Generate a random session token (groups autocomplete + place detail = 1 billing event)
function newToken() {
  return Math.random().toString(36).slice(2);
}

export default function AddressInput({ value, onChange, onSelect, placeholder }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading]         = useState(false);
  const sessiontoken                  = useRef(newToken());
  const debounceTimer                 = useRef(null);

  // Debounced autocomplete fetch
  const fetchSuggestions = useCallback((text) => {
    clearTimeout(debounceTimer.current);
    if (!text || text.length < 3) { setSuggestions([]); return; }

    debounceTimer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await api.getAutocomplete(text, sessiontoken.current);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  const handleChange = (e) => {
    onChange(e.target.value);
    fetchSuggestions(e.target.value);
  };

  const handleSelect = async (suggestion) => {
    onChange(suggestion.label);
    setSuggestions([]);

    // Resolve place_id → coordinates
    try {
      const coords = await api.getPlaceCoords(suggestion.place_id, sessiontoken.current);
      onSelect({ address: suggestion.label, lat: coords.lat, lng: coords.lng });
    } catch {
      // If coords fail, still set address text (user can retry)
      onSelect({ address: suggestion.label, lat: null, lng: null });
    }

    // Start fresh session token after a complete autocomplete+detail cycle
    sessiontoken.current = newToken();
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={placeholder || 'Enter address…'}
        style={{
          width: '100%',
          padding: '10px 12px',
          fontSize: '16px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          boxSizing: 'border-box',
        }}
      />

      {loading && (
        <div style={{ fontSize: '12px', color: '#888', padding: '4px 12px' }}>
          Searching…
        </div>
      )}

      {suggestions.length > 0 && (
        <ul style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: '#fff',
          border: '1px solid #ccc',
          borderRadius: '0 0 8px 8px',
          listStyle: 'none',
          margin: 0,
          padding: 0,
          zIndex: 1000,
          maxHeight: '220px',
          overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {suggestions.map((s) => (
            <li
              key={s.place_id}
              onMouseDown={() => handleSelect(s)}   // mouseDown fires before blur
              style={{
                padding: '10px 14px',
                cursor: 'pointer',
                fontSize: '14px',
                borderBottom: '1px solid #f0f0f0',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
