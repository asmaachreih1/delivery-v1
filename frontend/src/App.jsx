// ============================================================
// frontend/src/App.jsx
// ============================================================
// Root component — manages which screen is currently visible.
//
// The app is a single-page application (SPA) with 4 screens.
// Instead of a URL router (like React Router), we use a simple
// state variable called 'screen' to decide what to render.
// This keeps the code simple and works well on mobile where
// the driver shouldn't be using the browser back button.
//
// SCREEN FLOW:
//
//   ┌──────────────┐
//   │   'entry'    │  Driver enters restaurant, stops, time windows
//   └──────┬───────┘
//          │ Driver taps "Calculate Route"
//          │ Backend runs algorithm
//          ▼
//   ┌──────────────┐   status = 'ok' ────────────────┐
//   │   'alert'    │                                  │
//   │ (RED/YELLOW) │   status = 'warning'             │
//   └──────┬───────┘   Driver taps "Proceed" ─────────┤
//          │                                          │
//          │ Driver taps "Go back"                    ▼
//          │                               ┌──────────────────┐
//          └──────────────────────────────▶│    'route'       │
//                  back to 'entry'         │  Live map + stops │
//                                          └────────┬─────────┘
//                                                   │
//                                          All stops delivered
//                                                   │
//                                                   ▼
//                                          ┌──────────────────┐
//                                          │   'complete'     │
//                                          │  Run summary     │
//                                          └──────────────────┘
//                                                   │
//                                          Driver taps "New run"
//                                                   │
//                                                   └──▶ back to 'entry'
// ============================================================

import React, { useState } from 'react';
import { OrderEntry }  from './pages/OrderEntry';
import { AlertScreen } from './pages/AlertScreen';
import { RouteView }   from './pages/RouteView';
import { RunComplete } from './pages/RunComplete';

export default function App() {
  // Which screen to show. Starts on the order entry form.
  const [screen, setScreen] = useState('entry');

  // The current delivery run object returned from the backend.
  // Contains: id, status, route, alerts, diagnosis, totalMinutes, etc.
  // null when no run has been started yet.
  const [run, setRun] = useState(null);

  // ── Screen transition handlers ────────────────────────────

  /**
   * Called by OrderEntry when the backend returns a new run.
   * Saves the run and decides which screen to show based on status.
   */
  function handleRunStarted(newRun) {
    setRun(newRun);
    if (newRun.status === 'infeasible' || newRun.status === 'warning') {
      // RED or YELLOW — show the alert screen first
      setScreen('alert');
    } else {
      // GREEN — skip alert screen and go straight to the map
      setScreen('route');
    }
  }

  /**
   * Called by AlertScreen when the driver chooses to proceed anyway.
   * Only reachable from a YELLOW warning (not RED — RED has no proceed option).
   */
  function handleAlertProceed() {
    setScreen('route');
  }

  /**
   * Called by AlertScreen when the driver goes back to adjust the order.
   * Clears the run so they start fresh.
   */
  function handleAlertBack() {
    setScreen('entry');
    setRun(null);
  }

  /**
   * Called by RouteView when the last stop is marked as delivered.
   * A small delay in RouteView gives visual feedback before transitioning.
   */
  function handleRunComplete() {
    setScreen('complete');
  }

  /**
   * Called by RunComplete when the driver starts a new delivery run.
   * Resets all state back to the beginning.
   */
  function handleNewRun() {
    setRun(null);
    setScreen('entry');
  }

  // ── Render the active screen ──────────────────────────────
  switch (screen) {

    case 'entry':
      // Screen 1: order form
      return <OrderEntry onRunStarted={handleRunStarted} />;

    case 'alert':
      // Screen 2: RED/YELLOW/GREEN check
      // AlertScreen automatically skips to route if status is 'ok'
      return (
        <AlertScreen
          run={run}
          onProceed={handleAlertProceed}
          onBack={handleAlertBack}
        />
      );

    case 'route':
      // Screen 3: live map + stop cards
      return (
        <RouteView
          run={run}
          onComplete={handleRunComplete}
        />
      );

    case 'complete':
      // Screen 4: summary
      return (
        <RunComplete
          run={run}
          onNewRun={handleNewRun}
        />
      );

    default:
      return <OrderEntry onRunStarted={handleRunStarted} />;
  }
}
