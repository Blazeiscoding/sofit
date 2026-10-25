export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function present(values: (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => v != null && isFinite(v));
}

export function mean(values: (number | null | undefined)[]): number | null {
  const v = present(values);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function stdDev(values: (number | null | undefined)[]): number | null {
  const v = present(values);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

export function round(v: number | null | undefined, digits = 0): number | null {
  if (v == null || !isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Standard deviation of clock times (minutes of day), unwrapped around a reference so 23:50 and 00:10 are 20 min apart. */
export function circularMinuteStdDev(minutes: number[]): number | null {
  if (minutes.length < 2) return null;
  const ref = minutes[0];
  const unwrapped = minutes.map((m) => {
    let d = m - ref;
    if (d > 720) d -= 1440;
    if (d < -720) d += 1440;
    return ref + d;
  });
  return stdDev(unwrapped);
}
