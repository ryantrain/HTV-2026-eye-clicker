import { useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { Dwell, GazeFilter, eyeGaze, LandmarkEMA } from './care-tracking';
import { Blink, type Point } from './tracking';
import { api, type Analytics, type Order } from './care-api';
import './care.css';
const actions = [
  {
    id: 'RESTROOM',
    icon: '↗',
    title: 'Restroom',
    detail: 'Help getting there',
    color: 'mint',
  },
  {
    id: 'WATER',
    icon: '◒',
    title: 'Water',
    detail: 'Something to drink',
    color: 'blue',
  },
  {
    id: 'COMFORT',
    icon: '☀',
    title: 'Comfort',
    detail: 'Make my space comfortable',
    color: 'peach',
  },
  {
    id: 'ASSISTANCE',
    icon: '✦',
    title: 'Assistance',
    detail: 'Someone to check in',
    color: 'lavender',
  },
];
type Sample = { x: number; y: number; jitter: number; blinkMs: number };
function tone() {
  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.06, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.25);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.25);
  oscillator.onended = () => {
    void audio.close();
  };
}
export function CareApp() {
  const [tab, setTab] = useState(location.hash === '#admin' ? 'admin' : 'care');
  const [health, setHealth] = useState<{
    database: string;
    routing: string;
  } | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [connection, setConnection] = useState('Connecting to local backend…');
  const [notice, setNotice] = useState('Your care team is a look away.');
  const [camera, setCamera] = useState('off');
  const [face, setFace] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [pointerDemo, setPointerDemo] = useState(false);
  const [raw, setRaw] = useState<Point>({ x: 0.5, y: 0.5 });
  const [smooth, setSmooth] = useState<Point>({ x: 0.5, y: 0.5 });
  const [selection, setSelection] = useState<{
    id: string | null;
    progress: number;
  }>({ id: null, progress: 0 });
  const [settings, setSettings] = useState(false);
  const [token, setToken] = useState(
    sessionStorage.getItem('omni-token') || '',
  );
  const [sound, setSound] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<{
    intent: string;
    requestId: string;
  } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const runtime = useRef({
    running: false,
    enabled: false,
    pointerDemo: false,
    sound: true,
    busy: false,
    request: null as { intent: string; requestId: string } | null,
    model: null as FaceLandmarker | null,
    stream: null as MediaStream | null,
    frame: 0,
    filter: new GazeFilter(),
    landmarks: new LandmarkEMA(),
    dwellMs: 2000,
    blinkThreshold: 0.5,
    dwell: new Dwell(),
    blink: new Blink(),
    samples: [] as Sample[],
    lastSample: 0,
    blinkMs: 0,
    closedAt: null as number | null,
    lastTime: 0,
    smooth: { x: 0.5, y: 0.5 },
    generation: 0,
    latched: null as string | null,
  });
  runtime.current.sound = sound;
  runtime.current.pointerDemo = pointerDemo;
  function clearDwell() {
    runtime.current.dwell = new Dwell();
    setSelection({ id: null, progress: 0 });
  }
  function pause() {
    runtime.current.enabled = false;
    setEnabled(false);
    clearDwell();
  }
  function stop() {
    const r = runtime.current;
    r.generation++;
    r.running = false;
    pause();
    cancelAnimationFrame(r.frame);
    r.stream?.getTracks().forEach((t) => t.stop());
    r.model?.close();
    r.model = null;
    r.stream = null;
    r.samples = [];
    setCamera('off');
    setFace(false);
  }
  async function refresh() {
    try {
      const [h, o, a] = await Promise.all([
        api<{
          database: string;
          routing: string;
          dwellMs: number;
          blinkThreshold: number;
        }>('health'),
        api<Order[]>('orders'),
        api<Analytics>('analytics'),
      ]);
      runtime.current.dwellMs = h.dwellMs;
      runtime.current.blinkThreshold = h.blinkThreshold;
      setHealth(h);
      setOrders(o);
      setAnalytics(a);
      setConnection('Connected');
    } catch (error) {
      setHealth(null);
      setConnection(
        error instanceof Error ? error.message : 'Backend unavailable',
      );
    }
  }
  useEffect(() => {
    let disposed = false,
      fetching = false;
    const poll = async () => {
      if (disposed || fetching) return;
      fetching = true;
      await refresh();
      fetching = false;
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') pause();
    };
    window.addEventListener('keydown', escape);
    const visibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', visibility);
    const remove = window.desktop?.onPause(pause);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', visibility);
      remove?.();
      stop();
    };
  }, []);
  useEffect(() => {
    let sending = false;
    const timer = setInterval(async () => {
      const r = runtime.current;
      if (sending || !r.samples.length) return;
      sending = true;
      const batch = r.samples.splice(0, 120);
      try {
        await api('telemetry', 'POST', batch);
      } catch {
        setConnection('Telemetry not saved — check backend connection');
      } finally {
        sending = false;
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  async function submit(
    intent: string,
    existing?: { intent: string; requestId: string },
  ) {
    const r = runtime.current;
    if (r.busy) return;
    r.busy = true;
    // A manual pointer click jumps directly to its card; discard the old filter trail.
    if (r.pointerDemo) r.filter = new GazeFilter();
    r.latched = intent;
    setBusy(true);
    clearDwell();
    const request = existing || { intent, requestId: crypto.randomUUID() };
    r.request = request;
    setRetry(null);
    setNotice(`Sending ${intent.toLowerCase()} request…`);
    try {
      const order = await api<Order>('orders', 'POST', request);
      setNotice(
        `${intent[0]}${intent.slice(1).toLowerCase()} request received by ${order.department}.`,
      );
      r.request = null;
      if (r.sound)
        try {
          tone();
        } catch {
          /* Audio may be blocked until a user gesture. */
        }
      await refresh();
    } catch (error) {
      setRetry(request);
      pause();
      setNotice(
        `Request not confirmed: ${error instanceof Error ? error.message : 'Connection error'}`,
      );
    } finally {
      r.busy = false;
      setBusy(false);
    }
  }
  function targetAt(point: Point) {
    const bounds = grid.current?.getBoundingClientRect();
    if (!bounds) return null;
    const element = document.elementFromPoint(
      bounds.left + point.x * bounds.width,
      bounds.top + point.y * bounds.height,
    );
    return (
      element?.closest<HTMLElement>('[data-intent]')?.dataset.intent || null
    );
  }
  function update(point: Point, unfiltered: Point, now: number, blink = false) {
    const r = runtime.current;
    setRaw(unfiltered);
    setSmooth(point);
    r.smooth = point;
    if (!r.enabled || r.busy) {
      clearDwell();
      return;
    }
    const target = targetAt(point);
    if (target === r.latched && target) {
      setSelection({ id: target, progress: 1 });
      return;
    }
    r.latched = null;
    const dwell = r.dwell.update(target, now, r.dwellMs);
    setSelection({ id: target, progress: dwell.progress });
    if (target && (dwell.trigger || (blink && !r.dwell.fired))) {
      r.dwell.fired = true;
      void submit(target);
    }
  }
  async function start() {
    const r = runtime.current;
    if (r.running || camera === 'loading') return;
    const generation = ++r.generation;
    setCamera('loading');
    let model: FaceLandmarker | null = null,
      stream: MediaStream | null = null;
    try {
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
      if (generation !== r.generation) {
        model.close();
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      r.model = model;
      r.stream = stream;
      r.running = true;
      r.filter = new GazeFilter();
      r.landmarks = new LandmarkEMA();
      r.blink = new Blink();
      r.lastTime = performance.now();
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stop();
        setNotice('Camera disconnected. Reconnect to resume.');
      });
      video.current!.srcObject = stream;
      await video.current!.play();
      setCamera('on');
      setPointerDemo(false);
      let previous = -1;
      const frame = () => {
        if (!r.running) return;
        try {
          const v = video.current!,
            now = performance.now();
          if (v.readyState >= 2 && v.currentTime !== previous) {
            previous = v.currentTime;
            const result = r.model!.detectForVideo(v, now);
            const landmarks = result.faceLandmarks[0];
            setFace(!!landmarks);
            const scores = result.faceBlendshapes[0]?.categories || [];
            const closed = ['eyeBlinkLeft', 'eyeBlinkRight'].every(
              (name) =>
                (scores.find((s) => s.categoryName === name)?.score || 0) >
                r.blinkThreshold,
            );
            if (!landmarks) {
              clearDwell();
              r.blink = new Blink();
              r.closedAt = null;
              r.filter = new GazeFilter();
              r.landmarks = new LandmarkEMA();
              r.lastTime = now;
            } else {
              if (closed) r.closedAt ??= now;
              else if (r.closedAt !== null) {
                const duration = now - r.closedAt;
                if (duration >= 100 && duration <= 650) r.blinkMs = duration;
                r.closedAt = null;
              }
              const blink = r.blink.update(closed, now);
              const gaze = eyeGaze(landmarks);
              const stable = !closed
                ? eyeGaze(
                    r.landmarks.update(landmarks, (now - r.lastTime) / 1000),
                  )
                : null;
              if (!r.pointerDemo && gaze && stable && !closed) {
                const filtered = r.filter.update(
                  stable,
                  (now - r.lastTime) / 1000,
                );
                update(filtered, gaze, now, blink);
                if (now - r.lastSample >= 50) {
                  r.samples.push({
                    x: filtered.x,
                    y: filtered.y,
                    jitter: Math.hypot(
                      gaze.x - filtered.x,
                      gaze.y - filtered.y,
                    ),
                    blinkMs: r.blinkMs,
                  });
                  r.blinkMs = 0;
                  r.lastSample = now;
                  if (r.samples.length > 120) r.samples.shift();
                }
              }
              if (closed) clearDwell();
              r.lastTime = now;
            }
          }
        } catch (error) {
          stop();
          setNotice(`Tracking stopped: ${String(error)}`);
          return;
        }
        r.frame = requestAnimationFrame(frame);
      };
      frame();
    } catch (error) {
      model?.close();
      stream?.getTracks().forEach((t) => t.stop());
      if (generation === r.generation) {
        r.running = false;
        setCamera('off');
        setNotice(`Camera unavailable: ${String(error)}`);
      }
    }
  }
  useEffect(() => {
    if (!pointerDemo || tab !== 'care') return;
    const r = runtime.current;
    let point = { x: 0.5, y: 0.5 },
      inside = false,
      frame = 0,
      last = performance.now();
    r.filter = new GazeFilter();
    r.landmarks = new LandmarkEMA();
    const move = (e: PointerEvent) => {
      const rect = grid.current?.getBoundingClientRect();
      if (rect) {
        inside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        point = {
          x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
        };
      }
    };
    const tick = () => {
      const now = performance.now(),
        filtered = r.filter.update(point, (now - last) / 1000);
      last = now;
      if (inside) update(filtered, point, now);
      else clearDwell();
      if (now - r.lastSample > 50) {
        r.samples.push({
          x: filtered.x,
          y: filtered.y,
          jitter: Math.hypot(point.x - filtered.x, point.y - filtered.y),
          blinkMs: 0,
        });
        r.lastSample = now;
        if (r.samples.length > 120) r.samples.shift();
      }
      frame = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', move);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
    };
  }, [pointerDemo, tab]);
  function changeTab(value: string) {
    stop();
    setTab(value);
    location.hash = value;
  }
  const live = analytics?.live || [];
  const heat = Array.from(
    { length: 6 },
    (_, i) =>
      analytics?.aggregates
        .filter(
          (a) =>
            Math.min(2, a.cell_x) === i % 3 &&
            Math.min(1, a.cell_y) === Math.floor(i / 3),
        )
        .reduce((n, a) => n + Number(a.samples), 0) || 0,
  );
  const blinkCount = live.reduce((n, p) => n + Number(p.blinks), 0);
  return (
    <div className="care-app">
      <header className="care-header">
        <a
          className="care-brand"
          href="#care"
          onClick={() => changeTab('care')}
        >
          <span>◉</span> omniaccess<span className="prototype">DEMO</span>
        </a>
        <nav aria-label="Main navigation">
          <button
            className={tab === 'care' ? 'selected' : ''}
            onClick={() => changeTab('care')}
          >
            My space
          </button>
          <button
            className={tab === 'admin' ? 'selected' : ''}
            onClick={() => changeTab('admin')}
          >
            Care dashboard
          </button>
        </nav>
        <button
          className="connection-button"
          onClick={() => setSettings(!settings)}
        >
          ● {health ? 'Connected' : 'Connect'}
        </button>
      </header>
      {settings && (
        <section className="connection-settings">
          <label>
            Demo access token{' '}
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            onClick={() => {
              sessionStorage.setItem('omni-token', token);
              void refresh();
              setSettings(false);
            }}
          >
            Connect
          </button>
          <span>{connection}</span>
        </section>
      )}
      <div className="care-body">
        <div className="care-topline">
          <span className="care-eyebrow">
            A LITTLE SUPPORT. MORE INDEPENDENCE.
          </span>
          <span className="service-label">
            {health ? `${health.routing} / ${health.database}` : connection}
          </span>
        </div>
        {tab === 'care' ? (
          <>
            <section className="care-intro">
              <div>
                <h1>
                  What would make
                  <br />
                  your day <em>better?</em>
                </h1>
                <p>
                  Look at a card for two seconds, or blink once to select.
                  <br />
                  We’ll let your care team know.
                </p>
              </div>
              <div className="room-label">
                <span className="room-dot" /> DEMO ROOM{' '}
                <b>Your space, your pace.</b>
                <small>Requests go to the demo dashboard.</small>
              </div>
            </section>
            <div className="care-layout">
              <div
                className="macro-grid"
                ref={grid}
                onPointerLeave={() => {
                  if (pointerDemo) clearDwell();
                }}
              >
                {actions.map((action) => (
                  <button
                    key={action.id}
                    data-intent={action.id}
                    disabled={busy || !health}
                    className={`macro ${action.color} ${selection.id === action.id ? 'targeted' : ''}`}
                    onClick={() => void submit(action.id)}
                  >
                    <span className="macro-icon">{action.icon}</span>
                    <span className="macro-arrow">↗</span>
                    <strong>{action.title}</strong>
                    <span>{action.detail}</span>
                    <div className="dwell-track">
                      <div
                        style={{
                          width: `${selection.id === action.id ? selection.progress * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </button>
                ))}
                <div className="tracking-dots" aria-hidden="true">
                  {(face || pointerDemo) && (
                    <>
                      <i
                        className="raw-dot"
                        style={{
                          left: `${raw.x * 100}%`,
                          top: `${raw.y * 100}%`,
                        }}
                      />
                      <i
                        className="filtered-dot"
                        style={{
                          left: `${smooth.x * 100}%`,
                          top: `${smooth.y * 100}%`,
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
              <aside className="tracking-card">
                <div className="tracking-heading">
                  <h2>Your connection</h2>
                  <span className={face ? 'face-online' : ''}>
                    {pointerDemo
                      ? 'POINTER DEMO'
                      : face
                        ? 'FACE FOUND'
                        : 'CAMERA OFF'}
                  </span>
                </div>
                <div className="care-camera">
                  <video ref={video} muted playsInline />
                  {camera !== 'on' && (
                    <div>
                      <span>◎</span>
                      <p>
                        {camera === 'loading'
                          ? 'Preparing camera…'
                          : 'A look is all it takes.'}
                      </p>
                    </div>
                  )}
                </div>
                <div className="dot-legend">
                  <span>
                    <i className="red" /> Raw gaze
                  </span>
                  <span>
                    <i className="green" /> Filtered gaze
                  </span>
                </div>
                <p className="tracking-help">
                  Keep your head comfortable and steady. Large targets work
                  without a dot calibration; accuracy varies.
                </p>
                <button
                  className="care-primary"
                  onClick={camera === 'off' ? start : stop}
                >
                  {camera === 'off'
                    ? 'Enable camera'
                    : camera === 'loading'
                      ? 'Cancel loading'
                      : 'Stop camera'}
                </button>
                <button
                  className="care-outline"
                  disabled={!health || (!face && !pointerDemo)}
                  onClick={() => {
                    if (enabled) pause();
                    else {
                      runtime.current.enabled = true;
                      setEnabled(true);
                      clearDwell();
                    }
                  }}
                >
                  {enabled ? 'Pause gaze selection' : 'Start gaze selection'}
                </button>
                <label className="check-control">
                  <input
                    type="checkbox"
                    checked={pointerDemo}
                    onChange={(e) => {
                      pause();
                      setPointerDemo(e.target.checked);
                    }}
                  />{' '}
                  Try with pointer (demo)
                </label>
                <label className="check-control">
                  <input
                    type="checkbox"
                    checked={sound}
                    onChange={(e) => setSound(e.target.checked)}
                  />{' '}
                  Sound confirmation
                </label>
                <small>
                  Press Esc to pause · Selection {enabled ? 'on' : 'paused'}
                </small>
              </aside>
            </div>
            <section
              className={`care-notice ${retry ? 'failed' : ''}`}
              role="status"
            >
              <span>{busy ? '◌' : retry ? '!' : '✓'}</span>
              <div>
                <strong>{notice}</strong>
                <p>
                  {retry
                    ? 'Reconnect, then retry the same request to avoid duplicates.'
                    : 'Requests are shown to staff for review. This demo does not contact a real care team.'}
                </p>
              </div>
              {retry && (
                <button onClick={() => void submit(retry.intent, retry)}>
                  Retry request
                </button>
              )}
            </section>
            <section className="recent-section">
              <h2>My recent requests</h2>
              {orders.length === 0 ? (
                <p>No requests yet. Take your time.</p>
              ) : (
                orders.slice(0, 3).map((order) => (
                  <div className="recent-request" key={order.id}>
                    <b>{order.intent.toLowerCase()}</b>
                    <span>{order.department}</span>
                    <span className={`order-status ${order.status}`}>
                      {order.status}
                    </span>
                  </div>
                ))
              )}
            </section>
          </>
        ) : (
          <>
            <section className="care-intro">
              <div>
                <h1>
                  A clearer picture.
                  <br />
                  <em>A little better care.</em>
                </h1>
                <p>Requests and interaction signals from the demo room.</p>
              </div>
              <div className="room-label">
                <span className="room-dot" /> LIVE DASHBOARD{' '}
                <b>Refreshes every second</b>
                <small>{analytics?.source || 'Awaiting connection'}</small>
              </div>
            </section>
            <div className="stats-row">
              <div>
                <span>OPEN REQUESTS</span>
                <strong>
                  {orders.filter((o) => o.status !== 'completed').length}
                </strong>
                <small>Awaiting care team action</small>
              </div>
              <div>
                <span>BLINKS / LAST 60 SECONDS</span>
                <strong>{blinkCount}</strong>
                <small>Interaction signal · not a diagnosis</small>
              </div>
              <div>
                <span>RECORDED SAMPLES</span>
                <strong>
                  {Number(analytics?.samples || 0).toLocaleString()}
                </strong>
                <small>{analytics?.source || 'No data yet'}</small>
              </div>
            </div>
            <div className="admin-grid">
              <section className="order-panel">
                <div className="section-heading">
                  <h2>Incoming requests</h2>
                  <span>{orders.length} total</span>
                </div>
                {orders.length === 0 ? (
                  <div className="empty-orders">
                    ✦<h3>Ready to lend a hand.</h3>
                    <p>
                      Select a care card in My space to see its routed work
                      order here.
                    </p>
                  </div>
                ) : (
                  orders.map((order) => (
                    <article className="order-card" key={order.id}>
                      <div>
                        <span className="care-eyebrow">{order.department}</span>
                        <span className={`order-status ${order.status}`}>
                          {order.status}
                        </span>
                      </div>
                      <h3>
                        {order.intent.charAt(0) +
                          order.intent.slice(1).toLowerCase()}{' '}
                        requested
                      </h3>
                      <p>{order.summary}</p>
                      <footer>
                        <span>
                          {new Date(order.created_at).toLocaleTimeString()} ·{' '}
                          {order.source === 'gemini' ? 'Gemini' : 'Demo rules'}
                        </span>
                        {order.status !== 'completed' && (
                          <button
                            onClick={async () => {
                              try {
                                await api(`orders/${order.id}`, 'PATCH', {
                                  status:
                                    order.status === 'pending'
                                      ? 'acknowledged'
                                      : 'completed',
                                });
                                await refresh();
                              } catch (error) {
                                setConnection(String(error));
                              }
                            }}
                          >
                            {order.status === 'pending'
                              ? 'Acknowledge'
                              : 'Complete'}{' '}
                            ↗
                          </button>
                        )}
                      </footer>
                    </article>
                  ))
                )}
              </section>
              <aside className="analytics-panel">
                <h2>Gaze stability</h2>
                <p>Raw-to-filtered distance · last 60 seconds</p>
                <svg
                  className="jitter-chart"
                  viewBox="0 0 400 130"
                  role="img"
                  aria-label="Live gaze jitter over the last minute"
                >
                  <path
                    d="M0 30H400 M0 70H400 M0 110H400"
                    stroke="#dbe2da"
                    fill="none"
                  />
                  {live.length > 1 && (
                    <polyline
                      fill="none"
                      stroke="#2d7059"
                      strokeWidth="3"
                      points={live
                        .map(
                          (p, i) =>
                            `${(i / (live.length - 1)) * 400},${120 - Math.min(1, Number(p.jitter)) * 110}`,
                        )
                        .join(' ')}
                    />
                  )}
                </svg>
                <div className="chart-labels">
                  <span>60 seconds ago</span>
                  <span>Now</span>
                </div>
                <h2>Where attention lands</h2>
                <p>Five-minute gaze heatmap</p>
                <div className="heatmap">
                  {heat.map((n, i) => (
                    <div
                      key={i}
                      style={{
                        background: `rgba(45,112,89,${0.06 + (0.75 * n) / Math.max(1, ...heat)})`,
                      }}
                    >
                      {n}
                    </div>
                  ))}
                </div>
                <p className="analytics-footnote">
                  {analytics?.source === 'Tiger Data'
                    ? 'Five-minute continuous aggregates include recent raw data. Completed buckets refresh each minute.'
                    : 'Local demo data is held in memory and resets when the server restarts.'}
                </p>
              </aside>
            </div>
          </>
        )}
        <footer className="care-footer">
          <span>Designed around people. Powered by possibility.</span>
          <span>
            Video stays on-device · Coordinate telemetry is sent to the demo
            backend
          </span>
          {window.desktop && <a href="?desktop">Desktop click mode ↗</a>}
        </footer>
      </div>
    </div>
  );
}
