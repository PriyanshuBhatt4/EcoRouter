import { TRIP_FILTER, tripStep } from '../lib/track';

// Degrees of latitude are converted through the same mean-Earth sphere the
// module's haversine uses (R = 6371000 m -> pi*R/180 ≈ 111194.93 m per
// degree; the commonly cited 111320 figure is the WGS84 equator-based value
// and runs ~0.11% long, which matters for the larger steps in these tests).
const BASE = { latitude: 12.9716, longitude: 77.5946 };
const latDelta = (meters) => (meters * 180) / (Math.PI * 6371000);

describe('first reading', () => {
  test('a null reference anchors the fix without distance', () => {
    const step = tripStep(null, {
      ...BASE,
      accuracy: 5,
      timestamp: 1000,
    });
    expect(step).toEqual({ meters: 0, quality: 'ok', lowAccuracy: false });
  });

  test('a missing-coordinate reference behaves like the first reading', () => {
    const step = tripStep({}, {
      ...BASE,
      accuracy: 5,
      timestamp: 1000,
    });
    expect(step).toEqual({ meters: 0, quality: 'ok', lowAccuracy: false });
  });

  test('a soft first fix already flags the low-accuracy notice', () => {
    const step = tripStep(null, {
      ...BASE,
      accuracy: 20,
      timestamp: 1000,
    });
    expect(step.quality).toBe('ok');
    expect(step.meters).toBe(0);
    expect(step.lowAccuracy).toBe(true);
  });
});

describe('stationary jitter', () => {
  const reference = { ...BASE, accuracy: 4, timestamp: 1000 };

  test('sub-meter wiggle with ~8 m accuracy is jitter, meters 0', () => {
    // 0.000005 deg of latitude ≈ 0.56 m — well under MIN_STEP_M.
    const step = tripStep(reference, {
      ...BASE,
      latitude: BASE.latitude + 0.000005,
      accuracy: 8,
      timestamp: 3000,
    });
    expect(step.meters).toBe(0);
    expect(step.quality).toBe('jitter');
  });

  test('an exact duplicate reading is jitter too', () => {
    const step = tripStep(reference, { ...BASE, accuracy: 4, timestamp: 3000 });
    expect(step.meters).toBe(0);
    expect(step.quality).toBe('jitter');
  });

  test('a step above MIN_STEP_M but inside the worse accuracy radius is jitter', () => {
    // 3 m hop with an 8 m error bar on the previous fix: noise, not movement.
    const step = tripStep(
      { ...BASE, accuracy: 8, timestamp: 1000 },
      { ...BASE, latitude: BASE.latitude + latDelta(3), accuracy: 4, timestamp: 4000 },
    );
    expect(step.meters).toBe(0);
    expect(step.quality).toBe('jitter');
  });

  test('real movement after jitter is measured from the kept reference', () => {
    // Demonstration that the caller can hold the reference across a jitter
    // reading: discarding a 0.5 m wiggle must not erase (or distort) the 6 m
    // step that follows, because both are measured against the same anchor.
    const jitter = tripStep(reference, {
      ...BASE,
      latitude: BASE.latitude + 0.000005,
      accuracy: 8,
      timestamp: 3000,
    });
    expect(jitter.quality).toBe('jitter');

    const followUp = tripStep(reference, {
      ...BASE,
      latitude: BASE.latitude + latDelta(6),
      accuracy: 2,
      timestamp: 4000,
    });
    expect(followUp.quality).toBe('ok');
    expect(followUp.meters).toBeCloseTo(6, 1);
    expect(followUp.lowAccuracy).toBe(false);
  });
});

describe('low accuracy', () => {
  const reference = { ...BASE, accuracy: 5, timestamp: 1000 };

  test('a 60 m accuracy reading is never added as distance', () => {
    const step = tripStep(reference, {
      ...BASE,
      latitude: BASE.latitude + latDelta(20),
      accuracy: 60,
      timestamp: 4000,
    });
    expect(step.meters).toBe(0);
    expect(step.quality).toBe('low_accuracy');
    expect(step.lowAccuracy).toBe(true);
  });

  test('a reading with no accuracy value is rejected as untrusted', () => {
    const step = tripStep(reference, {
      ...BASE,
      latitude: BASE.latitude + latDelta(20),
      accuracy: undefined,
      timestamp: 4000,
    });
    expect(step.meters).toBe(0);
    expect(step.quality).toBe('low_accuracy');
    expect(step.lowAccuracy).toBe(true);
  });

  test('accuracy between notice and trust thresholds still accumulates but warns', () => {
    // 16 m accuracy: trusted (<= 30) but above the 15 m notice threshold.
    const step = tripStep(reference, {
      ...BASE,
      latitude: BASE.latitude + latDelta(40),
      accuracy: 16,
      timestamp: 11000,
    });
    expect(step.quality).toBe('ok');
    expect(step.meters).toBeCloseTo(40, 1);
    expect(step.lowAccuracy).toBe(true);
  });
});

describe('legitimate movement', () => {
  test('a 5 m walk step with good accuracy is accepted in full', () => {
    const step = tripStep(
      { ...BASE, accuracy: 3, timestamp: 1000 },
      { ...BASE, latitude: BASE.latitude + latDelta(5), accuracy: 2, timestamp: 4000 },
    );
    expect(step.meters).toBeCloseTo(5, 1);
    expect(step.quality).toBe('ok');
    expect(step.lowAccuracy).toBe(false);
  });

  test('a 9 m/s running step is under the speed cap and accepted', () => {
    const step = tripStep(
      { ...BASE, accuracy: 5, timestamp: 0 },
      { ...BASE, latitude: BASE.latitude + latDelta(90), accuracy: 4, timestamp: 10000 },
    );
    expect(step.quality).toBe('ok');
    expect(step.meters).toBeCloseTo(90, 1);
  });

  test('a fast but sub-cap step is accepted (24 m/s < 25 m/s cap)', () => {
    // Exactly-at-cap speed is a floating-point knife edge (haversine rounding
    // can tip 249.99.../10 m/s either side of the strict > check), so the
    // boundary is probed from just beneath on the accept side and from well
    // beyond it on the reject side.
    const step = tripStep(
      { ...BASE, accuracy: 4, timestamp: 0 },
      { ...BASE, latitude: BASE.latitude + latDelta(240), accuracy: 4, timestamp: 10000 },
    );
    expect(step.quality).toBe('ok');
    expect(step.meters).toBeCloseTo(240, 1);
  });

  test('a long fix gap with a modest step is accepted at its true distance', () => {
    // Location briefly unavailable: no readings arrive, so the next fix has a
    // large dt. Implied speed stays small (100 m over 120 s), so genuine
    // movement is accepted in full — gaps never inflate the distance.
    const step = tripStep(
      { ...BASE, accuracy: 5, timestamp: 0 },
      { ...BASE, latitude: BASE.latitude + latDelta(100), accuracy: 5, timestamp: 120000 },
    );
    expect(step.quality).toBe('ok');
    expect(step.meters).toBeCloseTo(100, 1);
  });
});

describe('impossible jumps', () => {
  const reference = { ...BASE, accuracy: 5, timestamp: 1000 };

  test('200 m in 1 s is rejected as a jump', () => {
    const step = tripStep(reference, {
      ...BASE,
      latitude: BASE.latitude + latDelta(200),
      accuracy: 3,
      timestamp: 2000,
    });
    expect(step.meters).toBe(0);
    expect(step.quality).toBe('jump');
  });

  test('30 m/s sustained motion is rejected as a jump', () => {
    const step = tripStep(
      { ...BASE, accuracy: 4, timestamp: 0 },
      { ...BASE, latitude: BASE.latitude + latDelta(300), accuracy: 5, timestamp: 10000 },
    );
    expect(step.meters).toBe(0);
    expect(step.quality).toBe('jump');
  });

  test('a huge step with no timestamps is rejected via the distance cap', () => {
    // dt is NaN when either timestamp is missing, so the fallback cap applies.
    const step = tripStep(
      { ...BASE, accuracy: 5 },
      { ...BASE, latitude: BASE.latitude + latDelta(200), accuracy: 3 },
    );
    expect(step.meters).toBe(0);
    expect(step.quality).toBe('jump');
  });

  test('a moderate step with no timestamps falls through to acceptance', () => {
    const step = tripStep(
      { ...BASE, accuracy: 5 },
      { ...BASE, latitude: BASE.latitude + latDelta(30), accuracy: 4 },
    );
    expect(step.quality).toBe('ok');
    expect(step.meters).toBeCloseTo(30, 1);
  });

  test('a non-positive dt (stale timestamp) uses the fallback cap too', () => {
    const step = tripStep(
      { ...BASE, accuracy: 5, timestamp: 5000 },
      { ...BASE, latitude: BASE.latitude + latDelta(70), accuracy: 5, timestamp: 5000 },
    );
    expect(step.meters).toBe(0);
    expect(step.quality).toBe('jump');
  });
});

describe('TRIP_FILTER config', () => {
  test('exposes every documented threshold as a number', () => {
    const keys = [
      'MIN_STEP_M',
      'MAX_TRUSTED_ACCURACY_M',
      'LOW_ACCURACY_NOTICE_M',
      'JITTER_ACCURACY_FACTOR',
      'MAX_SPEED_MPS',
      'MAX_STEP_NO_TIMESTAMP_M',
    ];
    keys.forEach((key) => {
      expect(TRIP_FILTER).toHaveProperty(key);
      expect(typeof TRIP_FILTER[key]).toBe('number');
    });
  });

  test('thresholds are ordered sensibly', () => {
    expect(TRIP_FILTER.MIN_STEP_M).toBeGreaterThan(0);
    expect(TRIP_FILTER.MIN_STEP_M).toBeLessThan(TRIP_FILTER.LOW_ACCURACY_NOTICE_M);
    expect(TRIP_FILTER.LOW_ACCURACY_NOTICE_M).toBeLessThan(TRIP_FILTER.MAX_TRUSTED_ACCURACY_M);
    expect(TRIP_FILTER.JITTER_ACCURACY_FACTOR).toBeGreaterThan(0);
    expect(TRIP_FILTER.MAX_SPEED_MPS).toBeGreaterThan(0);
    expect(TRIP_FILTER.MAX_STEP_NO_TIMESTAMP_M).toBeGreaterThan(0);
  });
});
