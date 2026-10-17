import type { Point } from './tracking';
export const calibrationTargets = [
  { name: 'center', x: 0.5, y: 0.5 },
  { name: 'left edge', x: 0.04, y: 0.5 },
  { name: 'right edge', x: 0.96, y: 0.5 },
  { name: 'top edge', x: 0.5, y: 0.05 },
  { name: 'bottom edge', x: 0.5, y: 0.95 },
  { name: 'top left corner', x: 0.04, y: 0.05 },
  { name: 'top right corner', x: 0.96, y: 0.05 },
  { name: 'bottom left corner', x: 0.04, y: 0.95 },
  { name: 'bottom right corner', x: 0.96, y: 0.95 },
  { name: 'upper left check point', x: 0.27, y: 0.275 },
  { name: 'upper right check point', x: 0.73, y: 0.275 },
  { name: 'lower left check point', x: 0.27, y: 0.725 },
  { name: 'lower right check point', x: 0.73, y: 0.725 },
];
export type ScreenFit = {
  center: Point;
  scale: Point;
  x: number[];
  y: number[];
};
const features = (x: number, y: number) => [1, x, y, x * y, x * x, y * y];
function solve(matrix: number[][], values: number[]) {
  const rows = matrix.map((row, i) => [...row, values[i]]);
  const size = values.length;
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let i = col + 1; i < size; i++)
      if (Math.abs(rows[i][col]) > Math.abs(rows[pivot][col])) pivot = i;
    if (Math.abs(rows[pivot][col]) < 1e-8) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    for (let j = col; j <= size; j++) rows[col][j] /= divisor;
    for (let i = 0; i < size; i++)
      if (i !== col) {
        const factor = rows[i][col];
        for (let j = col; j <= size; j++) rows[i][j] -= factor * rows[col][j];
      }
  }
  return rows.map((row) => row[size]);
}
export function projectGaze(point: Point, fit: ScreenFit): Point {
  const row = features(
    (point.x - fit.center.x) / fit.scale.x,
    (point.y - fit.center.y) / fit.scale.y,
  );
  return {
    x: fit.x.reduce((n, v, i) => n + v * row[i], 0),
    y: fit.y.reduce((n, v, i) => n + v * row[i], 0),
  };
}
// Screen-fraction limits: a target further off than this is treated as a bad sample,
// and a mapping whose cross-validated error exceeds the RMS limit is unusable.
const outlierError = 0.2;
const maxRmsError = 0.15;
const minPoints = 10;
// Small ridge on the curved terms keeps the quadratic from bending wildly at the edges.
const ridge = 0.1;
function fitPoints(
  samples: Point[],
  indices: number[],
  size: number,
): ScreenFit | null {
  const used = indices.map((i) => samples[i]);
  const min = {
    x: Math.min(...used.map((p) => p.x)),
    y: Math.min(...used.map((p) => p.y)),
  };
  const max = {
    x: Math.max(...used.map((p) => p.x)),
    y: Math.max(...used.map((p) => p.y)),
  };
  // Normalize small iris movements so the solver works on well-scaled numbers.
  const scale = { x: (max.x - min.x) / 2, y: (max.y - min.y) / 2 };
  if (scale.x < 1e-8 || scale.y < 1e-8) return null;
  const center = { x: (max.x + min.x) / 2, y: (max.y + min.y) / 2 };
  const rows = used.map((p) =>
    features((p.x - center.x) / scale.x, (p.y - center.y) / scale.y).slice(
      0,
      size,
    ),
  );
  const matrix = Array.from({ length: size }, (_, i) =>
    Array.from(
      { length: size },
      (_, j) =>
        rows.reduce((n, r) => n + r[i] * r[j], 0) +
        (i === j && i >= 3 ? ridge : 0),
    ),
  );
  const coefficients = (axis: 'x' | 'y') =>
    solve(
      matrix,
      Array.from({ length: size }, (_, i) =>
        rows.reduce(
          (n, row, j) => n + row[i] * calibrationTargets[indices[j]][axis],
          0,
        ),
      ),
    );
  const x = coefficients('x'),
    y = coefficients('y');
  if (!x || !y || [...x, ...y].some((v) => !Number.isFinite(v))) return null;
  // Reject near-collinear samples: the affine part must span both screen axes.
  if (Math.abs(x[1] * y[2] - x[2] * y[1]) < 1e-3) return null;
  return { center, scale, x, y };
}
// Leave-one-out error: how well each target is predicted by a fit that never saw it.
function crossValidate(samples: Point[], indices: number[], size: number) {
  const errors: number[] = [];
  for (const held of indices) {
    const fit = fitPoints(
      samples,
      indices.filter((i) => i !== held),
      size,
    );
    if (!fit) return null;
    const predicted = projectGaze(samples[held], fit),
      target = calibrationTargets[held];
    const error = Math.hypot(predicted.x - target.x, predicted.y - target.y);
    if (!Number.isFinite(error)) return null;
    errors.push(error);
  }
  return {
    errors,
    rms: Math.sqrt(errors.reduce((n, e) => n + e * e, 0) / errors.length),
  };
}
export function fitCalibration(samples: Point[]): ScreenFit | null {
  if (
    samples.length !== calibrationTargets.length ||
    samples.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    return null;
  let indices = samples.map((_, i) => i);
  for (;;) {
    let best: { size: number; errors: number[]; rms: number } | null = null;
    // The quadratic must beat the affine fit on held-out targets to be chosen.
    for (const size of indices.length >= minPoints ? [3, 6] : [3]) {
      const result = crossValidate(samples, indices, size);
      if (result && (!best || result.rms < best.rms))
        best = { size, ...result };
    }
    if (!best) return null;
    const worst = best.errors.indexOf(Math.max(...best.errors));
    // Drop a single bad target (a glance away, a blink) instead of failing the pass.
    if (best.errors[worst] > outlierError && indices.length > minPoints) {
      indices = indices.filter((_, i) => i !== worst);
      continue;
    }
    if (best.rms > maxRmsError) return null;
    return fitPoints(samples, indices, best.size);
  }
}
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
export function calibrationEyesOpen(left: number, right: number) {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    left <= 0.85 &&
    right <= 0.85
  );
}
export class ScreenCalibration {
  step = 0;
  since: number | null = null;
  samples: Point[] = [];
  points: Point[] = [];
  private elapsed = 0;
  private last: number | null = null;
  private missingSince: number | null = null;
  update(
    point: Point | null,
    now: number,
  ): {
    progress: number;
    done: boolean;
    unstable: boolean;
    failed?: boolean;
  } {
    if (this.step >= calibrationTargets.length)
      return { progress: 1, done: true, unstable: false };
    const dt =
      this.last === null ? 0 : Math.min(500, Math.max(0, now - this.last));
    this.last = now;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      this.missingSince ??= now;
      if (now - this.missingSince > 1500) {
        this.since = null;
        this.samples = [];
        this.elapsed = 0;
      }
      return {
        progress: Math.min(1, this.elapsed / 2000),
        done: false,
        unstable: false,
      };
    }
    const recovering = this.missingSince !== null;
    this.missingSince = null;
    this.since ??= now;
    if (!recovering) this.elapsed += dt;
    const elapsed = this.elapsed;
    if (elapsed > 600) {
      this.samples.push(point);
      // Let initial movement settle out without restarting the entire target.
      if (this.samples.length > 60) this.samples.shift();
    }
    if (elapsed >= 2000 && this.samples.length >= 8) {
      const center = {
        x: median(this.samples.map((p) => p.x)),
        y: median(this.samples.map((p) => p.y)),
      };
      const sorted = [...this.samples].sort(
        (a, b) =>
          Math.hypot(a.x - center.x, a.y - center.y) -
          Math.hypot(b.x - center.x, b.y - center.y),
      );
      const stable = sorted.slice(0, Math.ceil(sorted.length * 0.8));
      const average = {
        x: stable.reduce((n, p) => n + p.x, 0) / stable.length,
        y: stable.reduce((n, p) => n + p.y, 0) / stable.length,
      };
      if (
        stable.some((p) => Math.hypot(p.x - average.x, p.y - average.y) > 0.06)
      ) {
        return {
          progress: 1,
          done: false,
          unstable: true,
          failed: elapsed >= 8000,
        };
      }
      this.points.push(average);
      this.step++;
      this.elapsed = 0;
      this.since = null;
      this.samples = [];
      return {
        progress: 0,
        done: this.step === calibrationTargets.length,
        unstable: false,
      };
    }
    return {
      progress: Math.min(1, elapsed / 2000),
      done: false,
      unstable: false,
    };
  }
}
