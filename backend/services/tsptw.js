// ============================================================
// backend/services/tsptw.js
// ============================================================
// The TSPTW (Travelling Salesman Problem with Time Windows)
// brute force solver — the core algorithm of V1.
//
// WHAT THIS FILE SOLVES:
//   A food delivery driver leaves a restaurant with N orders.
//   Each order must be delivered to a specific address within
//   a customer-specified time window [windowOpen, windowClose].
//   We need to find the BEST ORDER to visit all stops so that:
//     1. Every customer receives their order within their window
//     2. The total trip time is minimised
//
// WHY BRUTE FORCE?
//   With ≤8 stops, there are at most 8! = 40,320 possible orderings.
//   A computer checks all of them in under 5ms — giving the
//   mathematically perfect answer instantly. No approximation.
//   Complex algorithms (ACO, OR-Tools) are only needed when
//   stop count exceeds ~20. We don't over-engineer.
//
// DISTANCE METRIC:
//   We never use kilometres. Everything is in MINUTES of real
//   road travel time, fetched from OpenRouteService with live
//   traffic. A 2km congested road is worse than a 5km highway.
//
// OUTPUT STATUS:
//   'ok'         → valid route found, no issues
//   'warning'    → valid route found, but driver waits >10min somewhere
//   'infeasible' → no ordering satisfies all time windows
// ============================================================

// If the driver arrives early at a stop, they must wait.
// If any wait exceeds this threshold (minutes), emit a yellow warning.
const WAIT_WARNING_THRESHOLD_MIN = 10;

// ── Time utility functions ────────────────────────────────────

/**
 * Convert a "HH:MM" string to total minutes since midnight.
 * Example: "14:30" → 870
 * Used to compare arrival times with window open/close times.
 */
function timeStringToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Add a number of minutes to a Date object.
 * Returns a NEW Date — does not modify the original.
 * Used to simulate the driver moving from stop to stop.
 */
function addMinutes(date, mins) {
  return new Date(date.getTime() + mins * 60 * 1000);
}

/**
 * Format a Date object as a "HH:MM" string.
 * Used to display arrival times to the driver.
 */
function formatTime(date) {
  return date.toTimeString().slice(0, 5);
}

// ── Permutation generator ─────────────────────────────────────

/**
 * Generate ALL possible orderings of an array.
 * This is a classic recursive algorithm using factorials:
 *   permutations([1,2,3]) → [[1,2,3],[1,3,2],[2,1,3],[2,3,1],[3,1,2],[3,2,1]]
 *
 * For N stops:
 *   N=1 → 1 ordering
 *   N=2 → 2 orderings
 *   N=3 → 6 orderings
 *   N=4 → 24 orderings
 *   N=5 → 120 orderings
 *   N=8 → 40,320 orderings (still instant on modern hardware)
 *
 * Algorithm:
 *   Pick each element as the "first" stop.
 *   Recursively generate all orderings of the remaining elements.
 *   Prepend the picked element to each sub-ordering.
 */
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    // Everything except index i
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    // All orderings of the remaining elements
    for (const perm of permutations(rest)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

// ── Route simulator ───────────────────────────────────────────

/**
 * Simulate driving a single route in order and check time windows.
 *
 * This function models exactly what happens if the driver follows
 * a specific stop sequence. It tracks the clock minute by minute.
 *
 * @param {number[]} order
 *   Indices into the stops array (0-based). Example: [2, 0, 1]
 *   means "visit stop 2 first, then stop 0, then stop 1".
 *
 * @param {object[]} stops
 *   Array of stop objects, each with:
 *     - windowOpen:  'HH:MM' string — earliest acceptable delivery time
 *     - windowClose: 'HH:MM' string — latest acceptable delivery time
 *     - name/address: for display purposes
 *
 * @param {number[][]} matrix
 *   Square travel-time matrix in minutes.
 *   matrix[i][j] = minutes to drive from point i to point j.
 *   Index 0 = restaurant. Indices 1..N = stops (offset by 1).
 *   Example: matrix[0][2] = 12 means restaurant→stop1 takes 12 minutes.
 *
 * @param {Date} departureTime
 *   When the driver leaves the restaurant.
 *
 * @returns {object}
 *   {
 *     valid: boolean,        // true if no time windows were violated
 *     totalMinutes: number,  // total trip duration in minutes
 *     totalWaitMinutes: number, // total time spent waiting at early arrivals
 *     arrivals: array,       // ETA details for each stop
 *     violations: array,     // details of any missed windows
 *   }
 */
function simulateRoute(order, stops, matrix, departureTime) {
  // currentTime tracks the driver's clock throughout the simulation
  let currentTime = new Date(departureTime);

  // currentMatrixIndex tracks which row/column to use in the travel time matrix.
  // Starts at 0 (restaurant). Updates to the matrix index of each visited stop.
  let currentMatrixIndex = 0;

  let totalWaitMinutes = 0;
  const arrivals = [];   // ETA record for each stop visited
  const violations = []; // Records any time window breaches

  for (const stopIndex of order) {
    // Matrix index for this stop is stopIndex+1 because index 0 = restaurant
    const matrixIndex = stopIndex + 1;

    // How long to drive from current location to this stop
    const travelMins = matrix[currentMatrixIndex][matrixIndex];

    // Advance the clock by travel time
    currentTime = addMinutes(currentTime, travelMins);
    const arrivalTime = new Date(currentTime); // snapshot of arrival moment

    const stop = stops[stopIndex];

    // Convert arrival clock to minutes-since-midnight for comparison
    const arrivalMins = arrivalTime.getHours() * 60 + arrivalTime.getMinutes();
    const windowOpen  = timeStringToMinutes(stop.windowOpen);
    const windowClose = timeStringToMinutes(stop.windowClose);

    // ── Case 1: Arrived TOO LATE — window already closed ─────
    if (arrivalMins > windowClose) {
      violations.push({
        stopIndex,
        stopName:      stop.name || `Stop ${stopIndex + 1}`,
        address:       stop.address,
        arrivalTime:   formatTime(arrivalTime),
        windowClose:   stop.windowClose,
        // How many minutes past the deadline we arrived
        lateByMinutes: Math.round(arrivalMins - windowClose),
      });
      arrivals.push({
        stopIndex,
        arrivalTime: formatTime(arrivalTime),
        waitMinutes: 0,
        status: 'late',
      });
      // Don't return early — continue simulating the rest of the route
      // so we can diagnose ALL violations, not just the first one.
      currentMatrixIndex = matrixIndex;
      continue;
    }

    // ── Case 2: Arrived TOO EARLY — window not yet open ──────
    // Driver must wait in the vehicle until the window opens.
    // This wait time is counted in the total trip duration.
    let waitMins = 0;
    if (arrivalMins < windowOpen) {
      waitMins = windowOpen - arrivalMins;  // minutes to wait
      totalWaitMinutes += waitMins;
      currentTime = addMinutes(currentTime, waitMins); // advance clock through the wait
    }

    // ── Case 3: Arrived ON TIME — deliver immediately ─────────
    arrivals.push({
      stopIndex,
      arrivalTime:  formatTime(arrivalTime),  // when driver physically arrived
      deliveryTime: formatTime(currentTime),  // when delivery actually happened (after any wait)
      waitMinutes:  waitMins,
      windowOpen:   stop.windowOpen,
      windowClose:  stop.windowClose,
      status: 'ok',
    });

    // Move to this stop's matrix position for the next leg calculation
    currentMatrixIndex = matrixIndex;
  }

  // Route is only valid if ZERO time windows were violated
  const valid = violations.length === 0;

  // Total trip time = difference between departure and final delivery
  const totalMinutes = (currentTime - departureTime) / 60000; // ms → minutes

  return { valid, totalMinutes, totalWaitMinutes, arrivals, violations };
}

// ── Main TSPTW solver ─────────────────────────────────────────

/**
 * Solve the TSPTW for the given stops and travel time matrix.
 *
 * This is the function called by routes/runs.js when the driver
 * presses "Calculate Route".
 *
 * Algorithm overview:
 *   1. Generate ALL possible stop orderings (permutations)
 *   2. Simulate EVERY ordering against the time windows
 *   3. Discard any ordering that violates a window (infeasible)
 *   4. From valid orderings, pick the one with minimum total time
 *   5. If NO valid orderings exist → infeasibility alert with diagnosis
 *   6. If valid orderings exist with long waits → yellow warning
 *
 * @param {object[]} stops
 *   Array of stop objects with address, windowOpen, windowClose, lat, lng
 *
 * @param {number[][]} matrix
 *   (N+1) × (N+1) travel time matrix in minutes.
 *   Row/column 0 = restaurant. Row/column i+1 = stop i.
 *
 * @param {Date|string} departure
 *   When the driver leaves the restaurant.
 *
 * @returns {object}
 *   {
 *     status: 'ok' | 'warning' | 'infeasible',
 *     route: [{ position, name, address, arrivalTime, waitMinutes, ... }],
 *     totalMinutes: number,
 *     alerts: [{ level, message, detail }],
 *     diagnosis: [{ stopName, windowOpen, windowClose, earliestPossibleArrival, isConflict }],
 *     permutationsChecked: number,
 *     validRoutesFound: number,
 *   }
 */
function solve(stops, matrix, departure) {
  const departureTime = new Date(departure);
  const N = stops.length;

  // Edge case: no stops → trivial result
  if (N === 0) {
    return { status: 'ok', route: [], totalMinutes: 0, alerts: [], diagnosis: [] };
  }

  // Build the list of stop indices: [0, 1, 2, ..., N-1]
  // These are what we'll permute
  const stopIndices = Array.from({ length: N }, (_, i) => i);

  // Generate every possible ordering of the stops
  const allPerms = permutations(stopIndices);

  // Simulate every permutation and separate valid from invalid routes
  const validRoutes    = [];
  const allSimulations = []; // keep ALL simulations for infeasibility diagnosis

  for (const order of allPerms) {
    const sim  = simulateRoute(order, stops, matrix, departureTime);
    sim.order  = order; // remember which order produced this simulation
    allSimulations.push(sim);
    if (sim.valid) validRoutes.push(sim);
  }

  // ── INFEASIBLE: every possible ordering violates at least one window ──
  if (validRoutes.length === 0) {

    // Diagnosis: for each stop, find the earliest it COULD be reached
    // (i.e. if we went there first, skipping all other stops).
    // This tells the dispatcher exactly which window is impossible.
    const diagnosis = stops.map((stop, i) => {

      // All simulations where this stop is visited first in the sequence
      const firstVisitSims = allSimulations.filter(s => s.order[0] === i);

      // Sort by arrival time at this stop to find the best-case scenario
      const bestCase = firstVisitSims.sort((a, b) => {
        const aArr = a.arrivals.find(ar => ar.stopIndex === i);
        const bArr = b.arrivals.find(ar => ar.stopIndex === i);
        return (aArr?.arrivalTime || '99:99').localeCompare(bArr?.arrivalTime || '99:99');
      })[0];

      const arrInfo          = bestCase?.arrivals.find(ar => ar.stopIndex === i);
      const earliestArrival  = arrInfo?.arrivalTime || 'unknown';
      const windowClose      = stop.windowClose;

      // A stop is definitely in conflict if even visiting it FIRST
      // still gets us there after the window closes
      const impossible = earliestArrival !== 'unknown' && earliestArrival > windowClose;

      return {
        stopIndex:               i,
        stopName:                stop.name || `Stop ${i + 1}`,
        address:                 stop.address,
        windowOpen:              stop.windowOpen,
        windowClose:             stop.windowClose,
        earliestPossibleArrival: earliestArrival,
        isConflict:              impossible,
        conflictDetail: impossible
          ? `Earliest possible arrival ${earliestArrival} is after window closes at ${windowClose}`
          : 'Window timing may be reachable but conflicts with other stops',
      };
    });

    return {
      status: 'infeasible',
      route:  [],
      totalMinutes: 0,
      alerts: [{
        level:   'red',
        message: 'No valid route exists. At least one time window cannot be satisfied.',
        detail:  'Adjust the time windows or departure time and recalculate.',
      }],
      diagnosis,
    };
  }

  // ── VALID: pick the ordering with minimum total trip time ──────────────
  // Sort ascending by totalMinutes — best route is first
  validRoutes.sort((a, b) => a.totalMinutes - b.totalMinutes);
  const best = validRoutes[0];

  // Build the structured route array the frontend will display
  const route = best.order.map((stopIndex, position) => {
    const stop    = stops[stopIndex];
    const arrival = best.arrivals.find(a => a.stopIndex === stopIndex);
    return {
      position:    position + 1,      // 1-based stop number for the driver
      stopIndex,                      // 0-based index into the stops array
      name:        stop.name || `Stop ${position + 1}`,
      address:     stop.address,
      lat:         stop.lat,
      lng:         stop.lng,
      windowOpen:  stop.windowOpen,
      windowClose: stop.windowClose,
      arrivalTime: arrival?.arrivalTime,   // when driver arrives
      deliveryTime:arrival?.deliveryTime,  // when delivery happens (after any wait)
      waitMinutes: arrival?.waitMinutes || 0,
      status: 'pending',  // frontend updates this to 'delivered' as stops complete
    };
  });

  // ── Build alerts ──────────────────────────────────────────────────────
  // Even valid routes can have problems worth warning about.
  // We flag any stop where the driver has to wait more than the threshold.
  const alerts = [];
  const longWaits = route.filter(s => s.waitMinutes >= WAIT_WARNING_THRESHOLD_MIN);

  if (longWaits.length > 0) {
    longWaits.forEach(s => {
      alerts.push({
        level:     'yellow',
        message:   `${s.name}: ${s.waitMinutes}-minute wait (arrives early at ${s.arrivalTime}, window opens ${s.windowOpen})`,
        detail:    `Consider adjusting this customer's window to open at ${s.arrivalTime}`,
        stopIndex: s.stopIndex,
      });
    });
  }

  return {
    // 'warning' if there are yellow alerts, 'ok' if clean
    status:              alerts.length > 0 ? 'warning' : 'ok',
    route,
    totalMinutes:        Math.round(best.totalMinutes),
    totalWaitMinutes:    Math.round(best.totalWaitMinutes),
    alerts,
    diagnosis:           [],                  // empty when route is feasible
    permutationsChecked: allPerms.length,     // informational — shown in dev logs
    validRoutesFound:    validRoutes.length,  // informational
  };
}

// Export the main solver and helpers
// (helpers exported for potential unit testing)
module.exports = { solve, permutations, simulateRoute };
