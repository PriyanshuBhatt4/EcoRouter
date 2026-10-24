import { formatDistance, formatDuration, formatDurationLong, formatPmUnits } from '../lib/format';

describe('formatDistance', () => {
  test('meters below 1000 round to whole meters', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(1)).toBe('1 m');
    expect(formatDistance(750)).toBe('750 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  test('meters below 1000 round to nearest meter', () => {
    expect(formatDistance(750.4)).toBe('750 m');
    expect(formatDistance(750.6)).toBe('751 m');
  });

  test('1000 meters and above are shown in km with one decimal', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(12345)).toBe('12.3 km');
    expect(formatDistance(1234567)).toBe('1234.6 km');
  });

  test('non-finite inputs return null', () => {
    expect(formatDistance(NaN)).toBeNull();
    expect(formatDistance(Infinity)).toBeNull();
    expect(formatDistance(-Infinity)).toBeNull();
    expect(formatDistance(undefined)).toBeNull();
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance('1200')).toBeNull();
  });
});

describe('formatDuration', () => {
  test('seconds below 60', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(59)).toBe('59 s');
  });

  test('sub-second values round to nearest second', () => {
    expect(formatDuration(45.4)).toBe('45 s');
    expect(formatDuration(45.6)).toBe('46 s');
    expect(formatDuration(59.6)).toBe('1 min'); // rounds up to 60s
  });

  test('minutes', () => {
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(90)).toBe('1 min');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(3599)).toBe('59 min');
  });

  test('hours and minutes', () => {
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(3660)).toBe('1 h 1 min');
    expect(formatDuration(3661)).toBe('1 h 1 min');
    expect(formatDuration(7800)).toBe('2 h 10 min');
  });

  test('negative values clamp to 0', () => {
    expect(formatDuration(-5)).toBe('0 s');
  });

  test('non-finite inputs return null', () => {
    expect(formatDuration(NaN)).toBeNull();
    expect(formatDuration(Infinity)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration('120')).toBeNull();
  });
});

describe('formatDurationLong', () => {
  test('non-finite inputs return em dash', () => {
    expect(formatDurationLong(NaN)).toBe('—');
    expect(formatDurationLong(Infinity)).toBe('—');
    expect(formatDurationLong(undefined)).toBe('—');
    expect(formatDurationLong(null)).toBe('—');
    expect(formatDurationLong('90')).toBe('—');
  });

  test('seconds only', () => {
    expect(formatDurationLong(0)).toBe('0s');
    expect(formatDurationLong(1)).toBe('1s');
    expect(formatDurationLong(59)).toBe('59s');
  });

  test('minutes and seconds', () => {
    expect(formatDurationLong(60)).toBe('1m 0s');
    expect(formatDurationLong(61)).toBe('1m 1s');
    expect(formatDurationLong(3599)).toBe('59m 59s');
  });

  test('hours, minutes and seconds', () => {
    expect(formatDurationLong(3600)).toBe('1h 0m 0s');
    expect(formatDurationLong(3661)).toBe('1h 1m 1s');
    expect(formatDurationLong(7322)).toBe('2h 2m 2s');
  });

  test('sub-second values floor', () => {
    expect(formatDurationLong(90.7)).toBe('1m 30s');
  });

  test('negative values clamp to 0', () => {
    expect(formatDurationLong(-5)).toBe('0s');
  });
});

// ADD-only: PM units prettifier (backend payload strings are never altered).
describe('formatPmUnits', () => {
  test('maps the ASCII backend key to the display glyphs (µ U+00B5, ³ U+00B3)', () => {
    expect(formatPmUnits('ug/m3')).toBe('\u00B5g/m\u00B3');
  });

  test('unknown unit strings collapse to an empty string', () => {
    expect(formatPmUnits('mg/m3')).toBe('');
    expect(formatPmUnits('ug/m3 ')).toBe(''); // exact key only, no trimming
    expect(formatPmUnits('')).toBe('');
  });

  test('already-pretty forms do not round-trip (single deterministic mapping)', () => {
    expect(formatPmUnits('µg/m³')).toBe('');
  });

  test('non-string inputs return an empty string', () => {
    expect(formatPmUnits(undefined)).toBe('');
    expect(formatPmUnits(null)).toBe('');
    expect(formatPmUnits(42)).toBe('');
  });
});

// ADD-only: imperial unit support (default 'metric' output above is untouched).
describe('formatDistance (imperial)', () => {
  test('0 m shows as 0 ft', () => {
    expect(formatDistance(0, 'imperial')).toBe('0 ft');
  });

  test('distances below 0.1 mi show in feet (100 m -> 328 ft)', () => {
    expect(formatDistance(100, 'imperial')).toBe('328 ft');
    expect(formatDistance(160, 'imperial')).toBe('525 ft'); // 160*3.28084 = 524.9...
  });

  test('1609.344 m shows 1.0 mi (exact mile boundary)', () => {
    expect(formatDistance(1609.344, 'imperial')).toBe('1.0 mi');
  });

  test('21000 m shows 13.0 mi (one-decimal style matches metric)', () => {
    expect(formatDistance(21000, 'imperial')).toBe('13.0 mi');
  });

  test('non-finite inputs return null under imperial too (fallback behavior preserved)', () => {
    expect(formatDistance(NaN, 'imperial')).toBeNull();
    expect(formatDistance(Infinity, 'imperial')).toBeNull();
    expect(formatDistance(-Infinity, 'imperial')).toBeNull();
    expect(formatDistance(undefined, 'imperial')).toBeNull();
    expect(formatDistance(null, 'imperial')).toBeNull();
    expect(formatDistance('1200', 'imperial')).toBeNull();
  });

  test('the default call keeps today\'s exact metric output', () => {
    expect(formatDistance(500)).toBe('500 m');
    expect(formatDistance(5000)).toBe('5.0 km');
    expect(formatDistance(null)).toBeNull();
  });
});
