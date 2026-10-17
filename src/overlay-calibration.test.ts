import { expect, it } from 'vitest';
import {
  ScreenCalibration,
  calibrationTargets,
  calibrationEyesOpen,
  fitCalibration,
  projectGaze,
} from './overlay-calibration';
it('fits cross-axis gaze and discards a single bad target', () => {
  const samples = calibrationTargets.map((t) => ({
    x: 0.8 - 0.4 * t.x + 0.06 * t.y,
    y: 0.2 + 0.35 * t.y + 0.04 * t.x,
  }));
  const fit = fitCalibration(samples)!;
  expect(fit).not.toBeNull();
  const point = projectGaze(
    { x: 0.8 - 0.4 * 0.32 + 0.06 * 0.68, y: 0.2 + 0.35 * 0.68 + 0.04 * 0.32 },
    fit,
  );
  expect(point.x).toBeCloseTo(0.32);
  expect(point.y).toBeCloseTo(0.68);
  const bad = samples.map((p) => ({ ...p }));
  bad[10].x += 0.15;
  const robust = fitCalibration(bad)!;
  expect(robust).not.toBeNull();
  expect(projectGaze(samples[10], robust).x).toBeCloseTo(0.73);
  expect(fitCalibration(Array(13).fill({ x: 0.5, y: 0.5 }))).toBeNull();
});
it('rejects singular fits and supports nonlinear calibration', () => {
  const fit = fitCalibration(
    calibrationTargets.map((t) => ({ x: t.x, y: t.y - 0.08 * t.x * t.x })),
  )!;
  expect(projectGaze({ x: 0.3, y: 0.7 - 0.08 * 0.3 * 0.3 }, fit).x).toBeCloseTo(
    0.3,
  );
  expect(
    fitCalibration(calibrationTargets.map((t) => ({ x: t.x, y: t.x }))),
  ).toBeNull();
});
it('uses the affine fit when a noisy training target makes the curve less accurate', () => {
  const samples = calibrationTargets.map(({ x, y }) => ({ x, y }));
  samples[0].x += 0.16;
  const fit = fitCalibration(samples);
  expect(fit).not.toBeNull();
  expect(fit!.x).toHaveLength(3);
  const predicted = projectGaze({ x: 0.35, y: 0.65 }, fit!);
  expect(Math.hypot(predicted.x - 0.35, predicted.y - 0.65)).toBeLessThan(0.04);
});
it('pauses on brief gaps, resets prolonged loss, and collects all 13 targets', () => {
  const c = new ScreenCalibration();
  for (let now = 0; now <= 1800; now += 30) c.update({ x: 0.2, y: 0.5 }, now);
  const count = c.samples.length;
  expect(count).toBeGreaterThan(0);
  const progress = c.update(null, 1830).progress;
  expect(c.update(null, 2000).progress).toBe(progress);
  expect(c.samples.length).toBe(count);
  c.update(null, 3500);
  expect(c.samples).toEqual([]);
  let now = 4000;
  for (let step = 0; step < 13; step++) {
    let frames = 0;
    while (c.step === step && frames++ < 200) {
      c.update({ x: step / 20, y: step / 20 }, now);
      now += 34;
    }
    expect(c.step).toBe(step + 1);
  }
  expect(c.points).toHaveLength(13);
  const completed = c.points.map((point) => ({ ...point }));
  // Subsequent frames, including tracking loss, cannot reopen a completed pass.
  expect(c.update(null, now + 2000)).toEqual({
    progress: 1,
    done: true,
    unstable: false,
  });
  expect(c.update({ x: 0.1, y: 0.1 }, now + 4000).done).toBe(true);
  expect(c.step).toBe(13);
  expect(c.points).toEqual(completed);
});
it('allows normal open-eye scores that used to block center calibration', () => {
  expect(calibrationEyesOpen(0.25, 0.3)).toBe(true);
  expect(calibrationEyesOpen(0.7, 0.65)).toBe(true);
  expect(calibrationEyesOpen(0.98, 0.98)).toBe(false);
  expect(calibrationEyesOpen(NaN, 0.2)).toBe(false);
});

it('recovers from initial movement using recent stable samples', () => {
  const c = new ScreenCalibration();
  let result;
  for (let now = 0; now <= 3600; now += 30)
    result = c.update({ x: (now / 30) % 2 ? 0.3 : 0.7, y: 0.5 }, now);
  expect(result!.unstable).toBe(true);
  expect(c.step).toBe(0);
  for (let now = 3630; now <= 6000 && c.step === 0; now += 30)
    c.update({ x: 0.5, y: 0.5 }, now);
  expect(c.step).toBe(1);
  expect(c.points[0].x).toBeCloseTo(0.5);
});

it('accepts small consistent iris movements and ignores one inaccurate target', () => {
  const samples = calibrationTargets.map(({ x, y }) => ({
    x: 0.5 + (x - 0.5) * 0.02,
    y: 0.5 + (y - 0.5) * 0.008,
  }));
  const fit = fitCalibration(samples);
  expect(fit).not.toBeNull();
  const predicted = projectGaze({ x: 0.497, y: 0.5012 }, fit!);
  expect(predicted.x).toBeCloseTo(0.35);
  expect(predicted.y).toBeCloseTo(0.65);
  const good = samples[10];
  samples[10] = { ...good, y: good.y + 0.004 };
  const robust = fitCalibration(samples)!;
  expect(robust).not.toBeNull();
  expect(projectGaze(good, robust).y).toBeCloseTo(0.275);
});

// Deterministic pseudo-random noise so the webcam simulation is repeatable.
function noise(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 2;
  };
}

it('calibrates with realistic webcam noise on a small vertical iris range', () => {
  const random = noise(7);
  const eye = (x: number, y: number) => ({
    x: 0.5 - (x - 0.5) * 0.16 + 0.01 * (y - 0.5),
    y: 0.5 + (y - 0.5) * 0.05 - 0.01 * (x - 0.5) ** 2,
  });
  for (let trial = 0; trial < 50; trial++) {
    const fit = fitCalibration(
      calibrationTargets.map(({ x, y }) => {
        const p = eye(x, y);
        return { x: p.x + 0.008 * random(), y: p.y + 0.008 * random() };
      }),
    );
    expect(fit).not.toBeNull();
    const predicted = projectGaze(eye(0.3, 0.7), fit!);
    expect(Math.hypot(predicted.x - 0.3, predicted.y - 0.7)).toBeLessThan(0.15);
  }
});

it('rejects samples that carry no gaze information', () => {
  const random = noise(11);
  const fit = fitCalibration(
    calibrationTargets.map(() => ({
      x: 0.5 + 0.02 * random(),
      y: 0.5 + 0.02 * random(),
    })),
  );
  expect(fit).toBeNull();
});

it('advances the first target in two seconds on a 5 FPS camera', () => {
  const c = new ScreenCalibration();
  for (let now = 0; now <= 2200 && c.step === 0; now += 200)
    c.update({ x: 0.5, y: 0.5 }, now);
  expect(c.step).toBe(1);
  expect(c.points[0]).toEqual({ x: 0.5, y: 0.5 });
});

it('accepts moderate webcam jitter with outliers trimmed', () => {
  const c = new ScreenCalibration();
  for (let frame = 0; frame <= 70 && c.step === 0; frame++)
    c.update({ x: 0.5 + (frame % 2 ? 0.04 : -0.04), y: 0.5 }, frame * 30);
  expect(c.step).toBe(1);
  expect(c.points[0].x).toBeCloseTo(0.5, 1);
});

it('ends persistent noisy sampling with a failure instead of an endless first target', () => {
  const c = new ScreenCalibration();
  let result;
  for (let now = 0; now <= 8100; now += 30)
    result = c.update({ x: (now / 30) % 2 ? 0.3 : 0.7, y: 0.5 }, now);
  expect(result!.failed).toBe(true);
  expect(c.step).toBe(0);
});
