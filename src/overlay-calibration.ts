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
export function fitCalibration(samples: Point[]): ScreenFit | null {
  if (
    samples.length !== calibrationTargets.length ||
    samples.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    return null;
  const training = samples.slice(0, 9);
  const min = {
    x: Math.min(...training.map((p) => p.x)),
    y: Math.min(...training.map((p) => p.y)),
  };
  const max = {
    x: Math.max(...training.map((p) => p.x)),
    y: Math.max(...training.map((p) => p.y)),
  };
  const scale = { x: (max.x - min.x) / 2, y: (max.y - min.y) / 2 };
  // Normalize small iris movements before fitting; screen-space validation decides accuracy.
  if (scale.x < 1e-8 || scale.y < 1e-8) return null;
  const center = { x: (max.x + min.x) / 2, y: (max.y + min.y) / 2 };
  const rows = training.map((p) =>
    features((p.x - center.x) / scale.x, (p.y - center.y) / scale.y),
  );
  let best: ScreenFit | null = null;
  let bestError = Infinity;
  // Select on held-out targets: a quadratic must improve on the less noisy affine fit.
  for (const size of [3, 6]) {
    const matrix = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) =>
        rows.reduce((n, r) => n + r[i] * r[j], 0),
      ),
    );
    const coefficients = (axis: 'x' | 'y') =>
      solve(
        matrix,
        Array.from({ length: size }, (_, i) =>
          rows.reduce(
            (n, row, j) => n + row[i] * calibrationTargets[j][axis],
            0,
          ),
        ),
      );
    const x = coefficients('x'),
      y = coefficients('y');
    if (!x || !y) continue;
    const fit = { center, scale, x, y };
    // Independent check points catch bad fits that simply memorize the calibration targets.
    const errors = samples.map((p, i) => {
      const predicted = projectGaze(p, fit),
        target = calibrationTargets[i];
      return Math.hypot(predicted.x - target.x, predicted.y - target.y);
    });
    const checkError = Math.sqrt(
      errors.slice(9).reduce((n, e) => n + e * e, 0) / 4,
    );
    if (errors.some((e) => !Number.isFinite(e) || e > 0.16) || checkError > 0.1)
      continue;
    if (checkError < bestError) {
      best = fit;
      bestError = checkError;
    }
  }
  return best;
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
