import { expect, it } from 'vitest';
import { BlinkGuard } from './blink-guard';
it('freezes before full closure, clicks once, and waits for stable reopening', () => {
  const guard = new BlinkGuard(),
    point = { x: 0.4, y: 0.6 };
  guard.update(0, 0, point, 0);
  guard.update(0, 0, point, 200);
  expect(guard.update(0.2, 0.1, point, 240).anchor).toEqual(point);
  expect(guard.update(0.8, 0.8, point, 280).frozen).toBe(true);
  expect(guard.update(0.05, 0.05, point, 450)).toMatchObject({
    frozen: true,
    click: true,
  });
  expect(guard.update(0, 0, point, 600)).toMatchObject({
    frozen: true,
    click: false,
  });
  expect(guard.update(0, 0, point, 751).frozen).toBe(false);
});
it('winks and long closures freeze movement without clicking', () => {
  const guard = new BlinkGuard(),
    p = { x: 0.5, y: 0.5 };
  guard.update(0, 0, p, 0);
  guard.update(0.9, 0, p, 100);
  expect(guard.update(0, 0, p, 300).click).toBe(false);
  guard.update(0.9, 0.9, p, 1000);
  expect(guard.update(0, 0, p, 2000).click).toBe(false);
});
it('restarts the recovery period if the eyelids partially close again', () => {
  const guard = new BlinkGuard(),
    p = { x: 0.5, y: 0.5 };
  guard.update(0.8, 0.8, p, 0);
  guard.update(0, 0, p, 200);
  guard.update(0.2, 0, p, 400);
  guard.update(0, 0, p, 500);
  expect(guard.update(0, 0, p, 700).frozen).toBe(true);
  expect(guard.update(0, 0, p, 801).frozen).toBe(false);
});

it('discards distorted samples from just before a blink instead of replaying them', () => {
  const guard = new BlinkGuard(),
    stable = { x: 0.4, y: 0.6 };
  guard.update(0, 0, stable, 0);
  expect(guard.measurement(stable, 0)).toBeNull();
  expect(guard.measurement(stable, 130)).toEqual(stable);
  expect(guard.measurement({ x: 1, y: 0 }, 150)).toBeNull();
  expect(guard.update(0.2, 0.2, stable, 180).anchor).toEqual(stable);
  expect(guard.measurement({ x: 1, y: 0 }, 200)).toBeNull();
  guard.update(0, 0, stable, 400);
  guard.update(0, 0, stable, 701);
  expect(guard.measurement(stable, 701)).toBeNull();
  expect(guard.measurement(stable, 830)).toEqual(stable);
});

it('uses the learned open-eye baseline instead of freezing forever', () => {
  const guard = new BlinkGuard({ left: 0.24, right: 0.28 }),
    point = { x: 0.5, y: 0.5 };
  expect(guard.update(0.25, 0.3, point, 0).frozen).toBe(false);
  expect(guard.update(0.6, 0.7, point, 100).frozen).toBe(true);
  expect(guard.update(0.25, 0.3, point, 300).click).toBe(true);
  expect(guard.update(0.25, 0.3, point, 601).frozen).toBe(false);
});

it('does not clamp a learned narrow-eye baseline below its normal open score', () => {
  const guard = new BlinkGuard({ left: 0.44, right: 0.46 });
  expect(guard.update(0.45, 0.47, { x: 0.5, y: 0.5 }, 0).frozen).toBe(false);
});
