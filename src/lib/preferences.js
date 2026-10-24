// Pure route-preference selection logic extracted from App.js.
// Behavior must stay identical to the original inline implementations:
// - FASTEST: minimum durationSeconds, tiebreak on smaller distanceMeters.
// - SHORTEST: minimum distanceMeters, tiebreak on smaller durationSeconds.
// - CLEANEST: eligible only when candidates[0].pm25_estimate.can_compare_cleanest === true
//   and every candidate (including the first) has an available non-null pm25 value;
//   picks the lowest value. Otherwise returns null (caller keeps the current selection).
// - OPTIMAL: eligible only when every candidate has an available pm25 value; equal-weight
//   score of normalized (distance, duration, pm25). When all pm25 values are equal after
//   rounding to one decimal, pm25 contributes a constant 0.5 instead of being normalized.
//   Otherwise returns null (caller keeps the current selection).
// - MANUAL: no automatic selection (returns null).

export const PREFERENCES = {
  MANUAL: 'manual',
  FASTEST: 'fastest',
  SHORTEST: 'shortest',
  CLEANEST: 'cleanest',
  OPTIMAL: 'optimal',
};

function pickMinWithTiebreak(candidates, primaryKey, tiebreakKey) {
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const b = best;
    const cKey = c[primaryKey] ?? Infinity;
    const bKey = b[primaryKey] ?? Infinity;
    if (cKey < bKey - 1e-9) {
      best = c;
    } else if (Math.abs(cKey - bKey) < 1e-9) {
      if ((c[tiebreakKey] ?? Infinity) < (b[tiebreakKey] ?? Infinity)) {
        best = c;
      }
    }
  }
  return best;
}

export function pickFastest(candidates) {
  return pickMinWithTiebreak(candidates, 'durationSeconds', 'distanceMeters');
}

export function pickShortest(candidates) {
  return pickMinWithTiebreak(candidates, 'distanceMeters', 'durationSeconds');
}

export function pickCleanest(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const firstExp = candidates[0].pm25_estimate;
  if (!firstExp || firstExp.can_compare_cleanest !== true) return null;
  // Same available/non-null guard the loop below applies to later candidates:
  // the first candidate must also carry an available non-null value.
  if (!firstExp.available || firstExp.value === undefined || firstExp.value === null) {
    return null;
  }
  let best = candidates[0];
  let bestVal = firstExp.value;
  for (let i = 1; i < candidates.length; i++) {
    const exp = candidates[i].pm25_estimate;
    if (!exp || !exp.available || exp.value === undefined || exp.value === null) {
      return null;
    }
    const v = exp.value;
    if (v < bestVal) {
      best = candidates[i];
      bestVal = v;
    }
  }
  return best;
}

export function pickOptimal(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  let allPmAvailable = true;
  for (let i = 0; i < candidates.length; i++) {
    const exp = candidates[i].pm25_estimate;
    if (!exp || !exp.available || exp.value === undefined || exp.value === null) {
      allPmAvailable = false;
      break;
    }
  }
  if (!allPmAvailable) return null;
  const pmValues = candidates.map((c) => c.pm25_estimate.value);
  const pmEqual = new Set(pmValues.map((v) => Math.round(v * 10) / 10)).size === 1;
  const distVals = candidates.map((c) => c.distanceMeters ?? 0);
  const durVals = candidates.map((c) => c.durationSeconds ?? 0);
  const dMin = Math.min(...distVals);
  const dMax = Math.max(...distVals);
  const tMin = Math.min(...durVals);
  const tMax = Math.max(...durVals);
  const pMin = Math.min(...pmValues);
  const pMax = Math.max(...pmValues);
  const norm = (v, minv, maxv) => {
    if (maxv === minv) return 0.5;
    return (v - minv) / (maxv - minv);
  };
  let best = candidates[0];
  let bestScore = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const nd = norm(c.distanceMeters ?? 0, dMin, dMax);
    const nt = norm(c.durationSeconds ?? 0, tMin, tMax);
    const np = pmEqual ? 0.5 : norm(c.pm25_estimate.value, pMin, pMax);
    const score = (nd + nt + np) / 3.0;
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// Transparent-selection note for the map screen's preference chips row.
// Pure and deterministic (no RNG): eligibility reuses the exact pick* helpers
// above (they return null exactly when the preference cannot run), so this
// note can never claim eligibility the real selection logic would refuse.
//
// Returns { show, text }; show:false means the caller renders nothing.
// null is reserved for unknown preferences so a typo'd key is loud at the
// call site instead of silently hiding the row.
//
// Round-trip of the previously silent fallback: when CLEANEST/OPTIMAL is
// ineligible the caller keeps the manual selection — the note now SAYS why.
//
// Copy shipped verbatim:
// - manual or empty candidates: no row.
// - single candidate: comparison-caveat text wins over the preference rule.
// - fastest / shortest: always explain what the auto-pick does (even when it
//   just applied), so automatic selection stays transparent.
// - cleanest eligible / ineligible; optimal eligible / ineligible; an
//   indistinguishable_across_routes flag on the first candidate takes priority
//   for CLEANEST (backend cross-route enrichment; the estimands are too close
//   to rank, which is a stronger statement than a data gap).
export function preferenceNote(preference, candidates) {
  // PREFERENCES keys are the upper-case names; the lowercase strings are the
  // VALUES, so a value membership check is what identifies known preferences.
  if (typeof preference !== 'string' || !Object.values(PREFERENCES).includes(preference)) {
    return null;
  }
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0 || preference === PREFERENCES.MANUAL) {
    return { show: false, text: '' };
  }
  if (list.length === 1) {
    return {
      show: true,
      text: 'Only one route returned by the routing service — comparison is limited.',
    };
  }
  switch (preference) {
    case PREFERENCES.FASTEST:
      return { show: true, text: 'Picks the route with the lowest travel time.' };
    case PREFERENCES.SHORTEST:
      return { show: true, text: 'Picks the route with the lowest distance.' };
    case PREFERENCES.CLEANEST: {
      if (pickCleanest(list) != null) {
        return { show: true, text: 'Picks the route with the lowest modelled PM2.5 (µg/m³).' };
      }
      const first = list[0] && list[0].pm25_estimate ? list[0].pm25_estimate : null;
      if (first && first.indistinguishable_across_routes === true) {
        return {
          show: true,
          text: 'Exposure estimates are too similar to rank these routes reliably.',
        };
      }
      return {
        show: true,
        text: 'Cleanest needs comparable exposure estimates for all routes.',
      };
    }
    case PREFERENCES.OPTIMAL: {
      if (pickOptimal(list) != null) {
        return {
          show: true,
          text: 'Balances travel time, distance and exposure equally (1/3 each, normalised).',
        };
      }
      return {
        show: true,
        text: 'Optimal needs an exposure estimate for every route.',
      };
    }
    default:
      return { show: false, text: '' };
  }
}

// Returns the candidate to select for the given preference, or null when the
// caller should keep the current selection (manual mode, ineligible data).
export function selectByPreference(candidates, preference) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (preference === PREFERENCES.MANUAL) return null;
  if (candidates.length === 1) return candidates[0];
  switch (preference) {
    case PREFERENCES.FASTEST:
      return pickFastest(candidates);
    case PREFERENCES.SHORTEST:
      return pickShortest(candidates);
    case PREFERENCES.CLEANEST:
      return pickCleanest(candidates);
    case PREFERENCES.OPTIMAL:
      return pickOptimal(candidates);
    default:
      return null;
  }
}
