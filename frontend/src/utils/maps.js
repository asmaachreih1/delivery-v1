// frontend/src/utils/maps.js
// Centralized loader and helpers for Google Maps JS API

export const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || 'AIzaSyD2Xja_jxqsW3KI06HyoqAoqXsT78o829E';
export const DEFAULT_CENTER = { lat: 38.6191, lng: 27.4289 }; // Manisa, Turkey

export function loadGoogleMaps() {
  if (typeof window !== 'undefined' && window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }
  if (typeof window !== 'undefined' && window._googleMapsPromise) {
    return window._googleMapsPromise;
  }

  window._googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) {
      if (window.google?.maps) return resolve(window.google.maps);
      existing.addEventListener('load', () => resolve(window.google.maps));
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}`;
    script.async = true;
    script.onload = () => resolve(window.google.maps);
    script.onerror = (e) => reject(new Error('Failed to load Google Maps SDK'));
    document.head.appendChild(script);
  });

  return window._googleMapsPromise;
}
