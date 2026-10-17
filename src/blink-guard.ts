import { Blink, type Point } from './tracking';
export class BlinkGuard {
  private blink = new Blink();
  private blocked = false;
  private closed = false;
  private openSince: number | null = null;
  private anchor: Point = { x: 0.5, y: 0.5 };
  private samples: { point: Point; time: number }[] = [];
  constructor(private baseline = { left: 0, right: 0 }) {}
  update(left: number, right: number, cursor: Point, now: number) {
    const open =
      left < Math.min(0.7, this.baseline.left + 0.12) &&
      right < Math.min(0.7, this.baseline.right + 0.12);
    if (!open && !this.blocked) {
      this.blocked = true;
      this.openSince = null;
      this.anchor = { ...cursor };
      this.samples = [];
    }
    if (
      left > Math.min(0.8, Math.max(0.5, this.baseline.left + 0.3)) &&
      right > Math.min(0.8, Math.max(0.5, this.baseline.right + 0.3))
    )
      this.closed = true;
    if (open) this.closed = false;
    const click = this.blink.update(this.closed, now);
    if (this.blocked) {
      if (open) this.openSince ??= now;
      else this.openSince = null;
      if (this.openSince !== null && now - this.openSince >= 300) {
        this.blocked = false;
        this.samples = [];
      }
    }
    return {
      frozen: this.blocked,
      click: click && open,
      anchor: { ...this.anchor },
    };
  }
  // Delay measurements slightly so eyelid detection can discard pre-blink iris distortion.
  measurement(point: Point, now: number): Point | null {
    if (this.blocked) return null;
    this.samples.push({ point: { ...point }, time: now });
    const index = this.samples.findLastIndex(
      (sample) => sample.time <= now - 120,
    );
    if (index < 0) return null;
    const accepted = this.samples[index].point;
    this.samples = this.samples.slice(index + 1);
    return accepted;
  }
}
