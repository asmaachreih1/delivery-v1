// ============================================================
// frontend/src/components/AddressInput.jsx
// ============================================================
// Address input field with live autocomplete dropdown.
//
// HOW AUTOCOMPLETE WORKS:
//   1. Driver types characters into the input
//   2. Component waits 350ms after the last keystroke (debounce)
//      — this prevents calling the API on every single keypress
//   3. After the delay, calls GET /api/location/autocomplete?q=...
//   4. Backend calls OpenRouteService, returns up to 5 suggestions
//   5. Component shows them in a dropdown below the input
//   6. Driver taps a suggestion → address + coordinates fill in
//
// WHY WE CAPTURE COORDINATES HERE:
//   When the driver picks from the dropdown, we have the exact
//   lat/lng from ORS. We pass these up to the parent via onSelect().
//   This means the backend doesn't need to geocode those addresses
//   again — saving an API call and making the run start faster.
//   If the driver types a free-form address without selecting from
//   the dropdown, the backend will geocode it as a fallback.
//
// PROPS:
//   value     - Current text value of the input (controlled)
//   onChange  - Called with new string value on each keystroke
//   onSelect  - Called with { label, lat, lng } when suggestion picked
//   placeholder - Input placeholder text
//   error     - Error message string to show below input (or null)
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { api } from '../utils/api';

export function AddressInput({ value, onChange, onSelect, placeholder, error }) {
  // The list of address suggestions from the API
  const [suggestions, setSuggestions]   = useState([]);
  // Whether the dropdown is currently visible
  const [open, setOpen]                 = useState(false);
  // Whether we're waiting for an API response
  const [loading, setLoading]           = useState(false);

  // Stores the setTimeout ID so we can cancel it if the user keeps typing
  const debounceRef = useRef(null);
  // Reference to the wrapper div — used to detect clicks outside the dropdown
  const wrapRef     = useRef(null);

  // ── Close dropdown on outside click ──────────────────────
  // If the driver taps anywhere outside this component, close the
  // suggestion dropdown. We use mousedown (not click) because it
  // fires before the input loses focus.
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    // Remove listener when component unmounts to prevent memory leaks
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Handle text input ─────────────────────────────────────
  function handleChange(e) {
    const val = e.target.value;
    onChange(val); // notify parent of new text value

    // Cancel any pending debounce timer
    clearTimeout(debounceRef.current);

    // Don't call API for very short strings — not useful
    if (val.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    // Set a new timer — only calls the API if the driver stops
    // typing for 350ms. This prevents spamming the API.
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await api.autocomplete(val);
        setSuggestions(results || []);
        setOpen(results?.length > 0); // only open dropdown if there are results
      } catch {
        // Autocomplete failure is non-critical — just hide suggestions
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  }

  // ── Handle suggestion selection ───────────────────────────
  function handleSelect(suggestion) {
    onChange(suggestion.label);   // update the visible text in the input
    onSelect(suggestion);         // pass lat/lng/label up to parent
    setOpen(false);               // close the dropdown
    setSuggestions([]);           // clear suggestions
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>

      {/* The text input itself */}
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={value}
          onChange={handleChange}
          // If the driver focuses the input and there are already suggestions,
          // re-open the dropdown (they may have closed it accidentally)
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder || 'Enter address...'}
          className={error ? 'error' : ''}
          autoComplete="off" // disable browser's own autocomplete — we have our own
        />

        {/* Spinner shown while waiting for API response */}
        {loading && (
          <div style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)' }}>
            <div className="spinner" style={{ width: 16, height: 16 }} />
          </div>
        )}
      </div>

      {/* Suggestions dropdown */}
      {open && suggestions.length > 0 && (
        <div style={{
          position:   'absolute',
          top:        'calc(100% + 4px)', // just below the input
          left:       0,
          right:      0,
          background: 'var(--white)',
          border:     '1.5px solid var(--blue)',
          borderRadius: 'var(--radius-sm)',
          boxShadow:  'var(--shadow)',
          zIndex:     1000,  // appear above other elements
          overflow:   'hidden',
        }}>
          {suggestions.map((s, i) => (
            <div
              key={i}
              // onMouseDown fires before onBlur on the input
              // so we can read the suggestion before the dropdown closes
              onMouseDown={() => handleSelect(s)}
              style={{
                padding:      '0.75rem 1rem',
                cursor:       'pointer',
                fontSize:     '0.9rem',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--gray-100)' : 'none',
                lineHeight:   1.4,
              }}
              // Hover highlight effect
              onMouseEnter={e => e.currentTarget.style.background = 'var(--blue-l)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--white)'}
            >
              <span style={{ color: 'var(--gray-800)' }}>📍 </span>
              {s.label}
            </div>
          ))}
        </div>
      )}

      {/* Validation error message below the input */}
      {error && (
        <p style={{ color: 'var(--red)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
          {error}
        </p>
      )}
    </div>
  );
}
