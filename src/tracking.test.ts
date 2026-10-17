import { describe, expect, it } from 'vitest';
import { Blink, mapGaze } from './tracking';
describe('screen mapping', () => {
  it('supports reversed camera axes and clamps screen edges', () => {
    const mapping = { left: 0.8, right: 0.2, top: 0.3, bottom: 0.7 };
    const center = mapGaze({ x: 0.5, y: 0.5 }, mapping);
    expect(center.x).toBeCloseTo(0.5);
    expect(center.y).toBeCloseTo(0.5);
    expect(mapGaze({ x: 1, y: 0 }, mapping)).toEqual({ x: 0, y: 0 });
  });
});
describe('single blink click', () => {
  it('clicks once on reopening, ignores long closures and debounces', () => {
    const blink = new Blink();
    blink.update(true, 100);
    expect(blink.update(false, 150)).toBe(false);
    expect(blink.update(true, 1000)).toBe(false);
    expect(blink.update(true, 1100)).toBe(false);
    expect(blink.update(false, 1200)).toBe(true);
    expect(blink.update(false, 1300)).toBe(false);
    blink.update(true, 1400);
    expect(blink.update(false, 1600)).toBe(false);
    blink.update(true, 2500);
    expect(blink.update(false, 3500)).toBe(false);
    blink.update(true, 4000);
    expect(blink.update(false, 4200)).toBe(true);
  });
});
