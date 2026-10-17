export type Point = { x: number; y: number };
export type Mapping = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
export function mapGaze(p: Point, m: Mapping): Point {
  return {
    x: Math.max(0, Math.min(1, (p.x - m.left) / (m.right - m.left))),
    y: Math.max(0, Math.min(1, (p.y - m.top) / (m.bottom - m.top))),
  };
}
export class Blink {
  private closedAt: number | null = null;
  private lastClick = -Infinity;
  update(closed: boolean, now: number) {
    if (closed) {
      this.closedAt ??= now;
      return false;
    }
    const duration = this.closedAt === null ? 0 : now - this.closedAt;
    this.closedAt = null;
    if (duration >= 100 && duration <= 650 && now - this.lastClick > 900) {
      this.lastClick = now;
      return true;
    }
    return false;
  }
}
