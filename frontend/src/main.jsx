// ============================================================
// frontend/src/main.jsx
// ============================================================
// React application entry point.
//
// This is the first JavaScript file the browser executes.
// It mounts the React application into the <div id="root">
// element defined in index.html.
//
// React.StrictMode:
//   Wrapping the app in StrictMode causes React to intentionally
//   double-invoke certain functions in development mode (like
//   useEffect cleanup) to help catch bugs early. It has zero
//   effect in production builds.
//
// Why "createRoot" instead of "render"?
//   React 18 introduced the new root API (createRoot) which
//   enables concurrent features. It's the standard way to mount
//   React apps as of v18.
// ============================================================

import React    from 'react';
import ReactDOM from 'react-dom/client';
import App      from './App';
import './index.css'; // global styles — design tokens, base resets, utility classes

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
