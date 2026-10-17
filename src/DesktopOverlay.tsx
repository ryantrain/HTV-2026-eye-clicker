import { useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { eyeVector, GazeFilter } from './care-tracking';
import type { Point } from './tracking';
import { BlinkGuard } from './blink-guard';
import {
  ScreenCalibration,
  calibrationTargets,
  calibrationEyesOpen,
  fitCalibration,
  projectGaze,
  type ScreenFit,
} from './overlay-calibration';
import './overlay.css';
type Phase =
  | 'loading'
  | 'calibrating'
  | 'calibration-failed'
  | 'permission'
  | 'active'
  | 'paused'
  | 'error';
export function DesktopOverlay() {
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('Preparing your camera…');
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [face, setFace] = useState(false);
  const [cursor, setCursor] = useState<Point>({ x: 0.5, y: 0.5 });
  const runtime = useRef({
    phase: 'loading' as Phase,
    disposed: false,
    generation: 0,
    frame: 0,
    model: null as FaceLandmarker | null,
    stream: null as MediaStream | null,
    calibration: new ScreenCalibration(),
    mapping: null as ScreenFit | null,
    filter: new GazeFilter(),
    guard: new BlinkGuard(),
    baseline: { left: 0, right: 0 },
    baselineSamples: [] as { left: number; right: number }[],
    baselineSteps: [] as { left: number; right: number }[],
    cursor: { x: 0.5, y: 0.5 },
    frozen: false,
    last: 0,
    arming: false,
  });
  function transition(value: Phase, text: string) {
    runtime.current.phase = value;
    setPhase(value);
    setMessage(text);
  }
  function pause() {
    if (runtime.current.disposed) return;
    runtime.current.generation++;
    runtime.current.guard = new BlinkGuard(runtime.current.baseline);
    transition('paused', 'Control paused.');
    void window.desktop.enable(false);
  }
  async function arm() {
    const r = runtime.current;
    if (r.arming || r.disposed || !r.mapping) return;
    r.arming = true;
    const generation = r.generation;
    try {
      await window.desktop.enable(true);
      if (r.disposed || generation !== r.generation) {
        await window.desktop.enable(false);
        return;
      }
      r.guard = new BlinkGuard(r.baseline);
      r.frozen = false;
      transition('active', 'Look to move. Blink once to click.');
    } catch (error) {
      if (!r.disposed && generation === r.generation)
        transition('permission', String(error));
    } finally {
      r.arming = false;
    }
  }
  async function calibrate() {
    const r = runtime.current;
    r.generation++;
    r.mapping = null;
    r.guard = new BlinkGuard(r.baseline);
    r.filter = new GazeFilter();
    r.calibration = new ScreenCalibration();
    r.baselineSamples = [];
    r.baselineSteps = [];
    setStep(0);
    setProgress(0);
    transition(
      'calibrating',
      'Keep your head steady and follow the glowing target.',
    );
    try {
      await window.desktop.calibrate(true);
    } catch (error) {
      transition('error', `Unable to start calibration: ${String(error)}`);
    }
  }
  useEffect(() => {
    document.documentElement.classList.add('desktop-overlay');
    const r = runtime.current;
    const onPause = window.desktop.onPause(() => {
      if (r.phase === 'active' || r.phase === 'permission') pause();
    });
    const onCommand = window.desktop.onCommand((command) => {
      if (r.phase === 'error') {
        location.reload();
        return;
      }
      if (command === 'calibrate') void calibrate();
      else if (r.mapping) void arm();
      else void calibrate();
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') pause();
    };
    window.addEventListener('keydown', key);
    async function start() {
      const generation = r.generation;
      let model: FaceLandmarker | null = null,
        stream: MediaStream | null = null;
      try {
        await window.desktop.calibrate(true);
        const files = await FilesetResolver.forVisionTasks(
          new URL('./wasm', location.href).href,
        );
        model = await FaceLandmarker.createFromOptions(files, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });
        if (r.disposed) {
          model.close();
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        r.model = model;
        r.stream = stream;
        video.current!.srcObject = stream;
        await video.current!.play();
        stream.getVideoTracks()[0].addEventListener('ended', () => {
          pause();
          transition(
            'error',
            'Camera disconnected. Reconnect it and relaunch OmniAccess.',
          );
        });
        if (generation === r.generation && r.phase === 'loading')
          await calibrate();
        let previous = -1;
        r.last = performance.now();
        const frame = () => {
          if (r.disposed) return;
          try {
            const v = video.current!,
              now = performance.now();
            if (v.readyState >= 2 && v.currentTime !== previous) {
              previous = v.currentTime;
              const result = r.model!.detectForVideo(v, now),
                points = result.faceLandmarks[0];
              setFace(!!points);
              const scores = result.faceBlendshapes[0]?.categories || [];
              const score = (name: string) =>
                scores.find((s) => s.categoryName === name)?.score ?? 0;
              const blinkState = r.guard.update(
                score('eyeBlinkLeft'),
                score('eyeBlinkRight'),
                r.cursor,
                now,
              );
              // Calibration must not depend on the stricter cursor-freeze threshold.
              const calibrationClosed = !calibrationEyesOpen(
                score('eyeBlinkLeft'),
                score('eyeBlinkRight'),
              );
              const usable =
                r.phase === 'calibrating'
                  ? !calibrationClosed
                  : !blinkState.frozen;
              const vector = points && usable ? eyeVector(points) : null;
              if (!vector) {
                if (r.phase === 'calibrating') {
                  const waiting = r.calibration.update(null, now);
                  setProgress(waiting.progress);
                  setMessage(
                    !points
                      ? 'Face not detected. Move into the camera view.'
                      : calibrationClosed
                        ? 'Blink detected — holding your progress.'
                        : 'Eye landmarks unclear. Face the camera in even lighting.',
                  );
                }
                if (!points) {
                  r.guard = new BlinkGuard(r.baseline);
                  r.frozen = false;
                  r.filter = new GazeFilter();
                }
              }
              if (r.phase === 'calibrating' && vector) {
                r.baselineSamples.push({
                  left: score('eyeBlinkLeft'),
                  right: score('eyeBlinkRight'),
                });
                const previousStep = r.calibration.step;
                const result = r.calibration.update(vector, now);
                if (
                  r.calibration.step !== previousStep &&
                  r.baselineSamples.length
                ) {
                  const median = (axis: 'left' | 'right') =>
                    r.baselineSamples.map((p) => p[axis]).sort((a, b) => a - b)[
                      Math.floor(r.baselineSamples.length / 2)
                    ];
                  r.baselineSteps.push({
                    left: median('left'),
                    right: median('right'),
                  });
                  r.baselineSamples = [];
                  // Lids droop when looking down; use the most-closed open-eye pose as the
                  // baseline so low targets do not read as blinks and freeze the cursor.
                  r.baseline = {
                    left: Math.max(...r.baselineSteps.map((p) => p.left)),
                    right: Math.max(...r.baselineSteps.map((p) => p.right)),
                  };
                  r.guard = new BlinkGuard(r.baseline);
                }
                setMessage(
                  'Keep looking at the glowing target with your eyes only.',
                );
                setProgress(result.progress);
                setStep(
                  Math.min(calibrationTargets.length - 1, r.calibration.step),
                );
                if (result.unstable)
                  setMessage(
                    'Gaze moved too much. Keep looking at this target; sampling again…',
                  );
                if (result.done || result.failed) {
                  const mapping = result.done
                    ? fitCalibration(r.calibration.points)
                    : null;
                  if (!mapping) {
                    // A completed pass must terminate, even when validation fails.
                    pause();
                    setProgress(1);
                    transition(
                      'calibration-failed',
                      result.failed
                        ? 'This target stayed too noisy to measure. Adjust your camera or lighting, then retry calibration.'
                        : 'The eye samples did not pass the accuracy check. Face the camera in even lighting, keep your head still, and follow each dot with your eyes. Retry calibration when ready.',
                    );
                    // Keep the camera running and allow clicks on the retry button.
                    void window.desktop
                      .calibrate(true)
                      .catch((error) =>
                        transition(
                          'error',
                          `Unable to retry calibration: ${String(error)}`,
                        ),
                      );
                  } else {
                    r.mapping = mapping;
                    r.filter = new GazeFilter();
                    transition(
                      'permission',
                      'Calibration complete. Checking desktop access…',
                    );
                    void arm();
                  }
                }
              } else if (
                (r.phase === 'active' ||
                  r.phase === 'permission' ||
                  r.phase === 'paused') &&
                r.mapping &&
                points
              ) {
                if (blinkState.frozen && !r.frozen) {
                  r.cursor = blinkState.anchor;
                  r.filter = new GazeFilter();
                  r.filter.update(r.cursor, 1 / 30);
                  setCursor({ ...r.cursor });
                }
                r.frozen = blinkState.frozen;
                if (vector) {
                  const mapped = projectGaze(vector, r.mapping);
                  const accepted = r.guard.measurement(
                    {
                      x: Math.max(0, Math.min(1, mapped.x)),
                      y: Math.max(0, Math.min(1, mapped.y)),
                    },
                    now,
                  );
                  if (accepted) {
                    r.cursor = r.filter.update(
                      accepted,
                      Math.min(0.1, (now - r.last) / 1000),
                    );
                    setCursor({ ...r.cursor });
                  }
                }
                if (r.phase === 'active') {
                  void window.desktop
                    .point(r.cursor.x, r.cursor.y, blinkState.click)
                    .catch((error) => {
                      if (r.disposed || r.phase !== 'active') return;
                      pause();
                      transition(
                        'permission',
                        `Desktop control interrupted: ${String(error)}. Checking access again…`,
                      );
                    });
                }
              }
              r.last = now;
            }
          } catch (error) {
            pause();
            transition('error', `Tracking stopped: ${String(error)}`);
            return;
          }
          r.frame = requestAnimationFrame(frame);
        };
        frame();
      } catch (error) {
        model?.close();
        stream?.getTracks().forEach((t) => t.stop());
        if (!r.disposed) {
          pause();
          transition(
            'error',
            `Unable to start camera: ${String(error)}. Check Camera permission, then use the recalibrate shortcut to retry.`,
          );
        }
      }
    }
    void start();
    const retry = setInterval(() => {
      if (r.phase === 'permission' && !r.arming) void arm();
    }, 1500);
    return () => {
      r.disposed = true;
      r.generation++;
      clearInterval(retry);
      cancelAnimationFrame(r.frame);
      r.stream?.getTracks().forEach((t) => t.stop());
      r.model?.close();
      onPause();
      onCommand();
      window.removeEventListener('keydown', key);
      document.documentElement.classList.remove('desktop-overlay');
      void window.desktop.enable(false);
    };
  }, []);
  const calibrating = phase === 'calibrating';
  return (
    <div className={`overlay-root ${phase}`}>
      <video className="overlay-video" ref={video} muted playsInline />
      {(phase === 'loading' ||
        calibrating ||
        phase === 'permission' ||
        phase === 'paused' ||
        phase === 'error' ||
        phase === 'calibration-failed') && (
        <section
          className="overlay-instructions"
          role="status"
          // Keep the text away from the target so reading it does not pull the gaze.
          style={
            calibrating
              ? { top: calibrationTargets[step].y >= 0.5 ? '22%' : '78%' }
              : undefined
          }
        >
          <div className="overlay-wordmark">◉ omniaccess</div>
          <span className="overlay-kicker">
            {calibrating
              ? `SCREEN CALIBRATION · ${step + 1} OF ${calibrationTargets.length}`
              : 'HANDS-FREE DESKTOP CONTROL'}
          </span>
          <h1>
            {calibrating
              ? `Look at the ${calibrationTargets[step].name}`
              : phase === 'loading'
                ? 'Let’s make the screen yours.'
                : phase === 'permission'
                  ? 'One system permission to go.'
                  : phase === 'paused'
                    ? 'Control paused.'
                    : 'Let’s get you connected.'}
          </h1>
          <p>{message}</p>
          {phase === 'calibration-failed' && (
            <button type="button" onClick={() => void calibrate()}>
              Retry calibration
            </button>
          )}
          {calibrating && (
            <>
              <progress value={progress} max={1} />
              <p>
                {face
                  ? 'Hold your gaze. Each target takes about two seconds.'
                  : 'Looking for your face…'}
              </p>
            </>
          )}
          <small>
            ⌘/Ctrl Shift Space: pause / resume · ⌘/Ctrl Shift R: recalibrate ·
            ⌘/Ctrl Shift Q: quit
          </small>
        </section>
      )}
      {calibrating && (
        <span
          className="overlay-target"
          style={{
            left: `${calibrationTargets[step].x * 100}%`,
            top: `${calibrationTargets[step].y * 100}%`,
          }}
        />
      )}
      {phase === 'active' && face && (
        <span
          className="overlay-cursor"
          style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
        />
      )}
    </div>
  );
}
