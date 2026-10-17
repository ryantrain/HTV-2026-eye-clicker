import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { Point } from './tracking';
export class KalmanAxis {
  value: number | null = null;
  variance = 1;
  update(value: number, dt: number) {
    if (this.value === null) this.value = value;
    this.variance += 0.02 * Math.min(dt, 0.1);
    const gain = this.variance / (this.variance + 0.025);
    this.value += gain * (value - this.value);
    this.variance *= 1 - gain;
    return this.value;
  }
}
export class GazeFilter {
  x = new KalmanAxis();
  y = new KalmanAxis();
  update(point: Point, dt: number) {
    return { x: this.x.update(point.x, dt), y: this.y.update(point.y, dt) };
  }
}
export class Dwell {
  target: string | null = null;
  since = 0;
  fired = false;
  update(target: string | null, now: number, threshold = 2000) {
    if (target !== this.target || target === null) {
      this.target = target;
      this.since = now;
      this.fired = false;
    }
    const progress = target ? Math.min(1, (now - this.since) / threshold) : 0;
    const trigger = progress === 1 && !this.fired;
    if (trigger) this.fired = true;
    return { progress, trigger };
  }
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
// Eye-local projections compensate in-plane head roll; depth/yaw still need calibration.
export function eyeVector(points: NormalizedLandmark[]): Point | null {
  if (points.length < 478) return null;
  const eye = (
    iris: number,
    outer: number,
    inner: number,
    top: number,
    bottom: number,
  ) => {
    const a = points[outer],
      b = points[inner],
      i = points[iris];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      width = Math.hypot(dx, dy);
    if (!Number.isFinite(width) || width < 0.005) return null;
    const vertical = { x: -dy / width, y: dx / width };
    const height =
      (points[bottom].x - points[top].x) * vertical.x +
      (points[bottom].y - points[top].y) * vertical.y;
    if (!Number.isFinite(height) || Math.abs(height) < 0.001) return null;
    if (!Number.isFinite(i.x) || !Number.isFinite(i.y)) return null;
    return {
      x: ((i.x - a.x) * dx + (i.y - a.y) * dy) / (width * width),
      // Lids follow vertical gaze; use the corners and width as the stable reference.
      y: 0.5 + ((i.x - a.x) * vertical.x + (i.y - a.y) * vertical.y) / width,
    };
  };
  const l = eye(468, 33, 133, 159, 145),
    r = eye(473, 362, 263, 386, 374);
  if (!l || !r) return null;
  return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
}
export function eyeGaze(points: NormalizedLandmark[]): Point | null {
  const vector = eyeVector(points);
  if (!vector) return null;
  // shortcut: generic eye ranges support coarse macro selection; calibrate for precise screen pointing.
  return {
    x: clamp(0.5 - (vector.x - 0.5) * 3.5),
    y: clamp(0.5 + (vector.y - 0.5) * 2),
  };
}

export class LandmarkEMA {
  points: NormalizedLandmark[] = [];
  update(points: NormalizedLandmark[], dt: number) {
    const alpha = 1 - Math.exp(-Math.min(dt, 0.1) / 0.06);
    if (this.points.length !== points.length)
      this.points = points.map((p) => ({ ...p }));
    else
      points.forEach((point, index) => {
        const filtered = this.points[index];
        filtered.x += alpha * (point.x - filtered.x);
        filtered.y += alpha * (point.y - filtered.y);
        filtered.z += alpha * (point.z - filtered.z);
      });
    return this.points;
  }
}
