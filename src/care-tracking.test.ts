import { expect, it } from 'vitest';
import {
  Dwell,
  GazeFilter,
  eyeGaze,
  eyeVector,
  headPose,
  LandmarkEMA,
} from './care-tracking';
import {
  calibrationTargets,
  fitCalibration,
  projectGaze,
} from './overlay-calibration';
it('requires continuous dwell and rearms only after leaving', () => {
  const dwell = new Dwell();
  expect(dwell.update('WATER', 0).trigger).toBe(false);
  expect(dwell.update('WATER', 1999).trigger).toBe(false);
  expect(dwell.update('WATER', 2000).trigger).toBe(true);
  expect(dwell.update('WATER', 4000).trigger).toBe(false);
  dwell.update(null, 4100);
  dwell.update('WATER', 4200);
  expect(dwell.update('WATER', 6200).trigger).toBe(true);
  expect(dwell.update('RESTROOM', 6300).progress).toBe(0);
});
it('dampens jitter while following a sustained move', () => {
  const filter = new GazeFilter();
  filter.update({ x: 0.5, y: 0.5 }, 1 / 30);
  const spike = filter.update({ x: 1, y: 0 }, 1 / 30);
  expect(spike.x).toBeLessThan(0.8);
  let point = spike;
  for (let i = 0; i < 120; i++) point = filter.update({ x: 1, y: 0 }, 1 / 30);
  expect(point.x).toBeGreaterThan(0.99);
  expect(point.y).toBeLessThan(0.01);
  expect(eyeGaze([])).toBeNull();
});

it('smooths all landmark coordinates without changing the source frame', () => {
  const filter = new LandmarkEMA();
  const first = Array.from({ length: 478 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 1,
  }));
  filter.update(first, 1 / 30);
  const second = first.map((p) => ({ ...p, x: 1, y: 1, z: 1 }));
  const result = filter.update(second, 1 / 30);
  expect(result).toHaveLength(478);
  expect(result[477].x).toBeGreaterThan(0);
  expect(result[477].x).toBeLessThan(1);
  expect(result[477].z).toEqual(result[477].y);
  expect(second[477].x).toBe(1);
});
it('keeps eye-local gaze stable under in-plane head roll', () => {
  const points = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  for (const [iris, a, b, top, bottom, x] of [
    [468, 33, 133, 159, 145, 0.2],
    [473, 362, 263, 386, 374, 0.6],
  ]) {
    points[a].x = x;
    points[b].x = x + 0.1;
    points[iris].x = x + 0.05;
    points[top] = { ...points[top], x: x + 0.05, y: 0.45 };
    points[bottom] = { ...points[bottom], x: x + 0.05, y: 0.55 };
  }
  const baseline = eyeGaze(points)!;
  const theta = 0.4;
  const tilted = points.map((p) => ({
    ...p,
    x: (p.x - 0.5) * Math.cos(theta) - (p.y - 0.5) * Math.sin(theta) + 0.5,
    y: (p.x - 0.5) * Math.sin(theta) + (p.y - 0.5) * Math.cos(theta) + 0.5,
  }));
  expect(eyeGaze(tilted)!.x).toBeCloseTo(baseline.x);
  expect(eyeGaze(tilted)!.y).toBeCloseTo(baseline.y);
});

it('calibrates and tracks vertical gaze even when the lids follow the iris', () => {
  const frame = (x: number, y: number) => {
    const points = Array.from({ length: 478 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 1,
    }));
    for (const [iris, a, b, top, bottom, left] of [
      [468, 33, 133, 159, 145, 0.2],
      [473, 362, 263, 386, 374, 0.6],
    ]) {
      const irisY = 0.5 + (y - 0.5) * 0.012;
      points[a] = { x: left, y: 0.5, z: 0, visibility: 1 };
      points[b] = { x: left + 0.1, y: 0.5, z: 0, visibility: 1 };
      points[iris] = {
        x: left + 0.05 + (x - 0.5) * 0.025,
        y: irisY,
        z: 0,
        visibility: 1,
      };
      points[top] = { x: left + 0.05, y: irisY - 0.01, z: 0, visibility: 1 };
      points[bottom] = { x: left + 0.05, y: irisY + 0.01, z: 0, visibility: 1 };
    }
    return points;
  };
  const fit = fitCalibration(
    calibrationTargets.map((p) => eyeVector(frame(p.x, p.y))!),
  );
  expect(fit).not.toBeNull();
  for (const target of [
    { x: 0.35, y: 0.15 },
    { x: 0.65, y: 0.85 },
  ]) {
    const predicted = projectGaze(eyeVector(frame(target.x, target.y))!, fit!);
    expect(predicted.x).toBeCloseTo(target.x);
    expect(predicted.y).toBeCloseTo(target.y);
  }
  const invalid = frame(0.5, 0.5);
  invalid[468].x = NaN;
  expect(eyeVector(invalid)).toBeNull();
});

it('measures head turn independently of in-plane roll', () => {
  const points = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  points[33] = { ...points[33], x: 0.4 };
  points[263] = { ...points[263], x: 0.6 };
  points[1] = { ...points[1], x: 0.52, y: 0.58 };
  const pose = headPose(points)!;
  expect(pose.head.x).toBeCloseTo(0.1);
  expect(pose.head.y).toBeCloseTo(0.4);
  expect(pose.face).toEqual({ x: 0.5, y: 0.5 });
  const theta = 0.3;
  const rolled = points.map((p) => ({
    ...p,
    x: (p.x - 0.5) * Math.cos(theta) - (p.y - 0.5) * Math.sin(theta) + 0.5,
    y: (p.x - 0.5) * Math.sin(theta) + (p.y - 0.5) * Math.cos(theta) + 0.5,
  }));
  expect(headPose(rolled)!.head.x).toBeCloseTo(0.1);
  expect(headPose(rolled)!.head.y).toBeCloseTo(0.4);
  expect(headPose([])).toBeNull();
});
