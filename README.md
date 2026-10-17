# OmniAccess

A hands-free desktop overlay controlled by gaze and single blinks. Electron launches directly into automatic 13-target calibration, then becomes transparent and passes mouse input through to the applications underneath. The browser care-request demo and its backend remain available separately.

## Run the desktop overlay

```sh
npm ci
npm start
```

No backend or cloud keys are required for the desktop overlay. It automatically starts the camera and guides you through **13 targets**: the center, four edges, four corners, and four independent check points. Each takes about 2 seconds (roughly 26 seconds total, longer on slow cameras or during blinks). The first 0.6 seconds lets your gaze settle; at least eight samples are trimmed to discard outliers. Moderate webcam jitter is accepted; noisy targets get up to eight seconds of usable tracking before calibration stops with guidance instead of waiting forever. Brief blinks or tracking gaps pause sampling without discarding progress; prolonged tracking loss resets the current target. The center target also learns your normal open-eye scores so blink protection does not mistake naturally narrower eyes for a continuous blink. Live sample counts and waiting messages explain calibration progress. A quadratic screen mapping accounts for horizontal/vertical coupling and nonlinear gaze response. The four check points are held out of the fit; a poor validation result ends calibration with an explanation and leaves desktop control paused. It never automatically repeats the full set. Press Command/Ctrl + Shift + R to explicitly retry.

Blink protection freezes the cursor when either eyelid starts closing, clicks at the frozen pre-blink position, and waits for both eyes to remain open for 300 ms before accepting gaze again. A 120 ms measurement buffer lets the app discard iris distortion that appears just before blink detection; this intentionally adds a small amount of cursor latency. Winks and long closures freeze movement without clicking.

The overlay covers the display containing your pointer when the app launches. It uses a frameless, transparent, always-on-top window without entering a separate macOS fullscreen Space. After calibration it becomes non-focusable and ignores mouse events, allowing native clicks to reach other apps. Only a gaze cursor and a small status strip remain visible. Face loss suspends pointer updates and clicks. Display changes require a new calibration.

Global shortcuts:

- **Command/Ctrl + Shift + Space**: pause or resume.
- **Command/Ctrl + Shift + R**: recalibrate (or retry after a camera error).
- **Command/Ctrl + Shift + Q**: quit and release the webcam.
- **Escape**: pause while calibration has focus.

The application menu also offers pause/resume, recalibration, and quit. After a pause, the overlay remains transparent and passes input through.

The OS may require manual Camera and Accessibility permission approval. On macOS, allow OmniAccess (Electron during development) under System Settings → Privacy & Security. Desktop control starts automatically once Accessibility permission is detected; some OS permission changes may require restarting the app. The model downloads at startup, so internet access is required. Webcam precision and native overlay behavior still require hardware testing. Linux Wayland can restrict native mouse automation.

## Run the full local demo

Use Node.js 24 or newer:

```sh
npm ci
npm run demo
```

Open **http://127.0.0.1:8787**. No keys are required: the header explicitly shows **Demo rules / In-memory demo**. Choose a large care card by clicking, or enable **Try with pointer (demo)** and **Start gaze selection** to test dwell. The pointer mode generates labeled demo telemetry. Open **Care dashboard** in a second window to watch requests, acknowledgement/completion, a live jitter chart, blink counts, and a five-minute gaze heatmap.

For the webcam, enable the camera, keep your head steady, then start gaze selection. A red marker shows raw gaze and a green marker shows the filtered estimate. Leaving a card rearms selection; holding the same card does not repeatedly submit requests. A failed request pauses selection and offers an idempotent retry. **Escape** pauses gaze selection; switching tabs or hiding the page also pauses it. Camera processing requires downloading Google's model at startup. Browsers require localhost or HTTPS for camera access.

For frontend development, run `npm run server` and `npm run web:dev` in separate terminals; Vite proxies `/api` to port 8787.

## Enable Gemini and Tiger Data

Copy `.env.example` to `.env` and set server-side values:

- `GEMINI_API_KEY`: Google AI Studio API key. The official `@google/genai` SDK defaults to `gemini-2.5-flash`; override `GEMINI_MODEL` for a model available to your account.
- `DATABASE_URL`: Tiger Cloud PostgreSQL connection string with its required TLS settings. The database user needs permission to create the demo tables, hypertable, continuous aggregate, and refresh/retention policies. Prefer a dedicated demo database.
- `API_TOKEN`: a random value of at least 24 characters when exposing the server. Enter the same value through **Connect** in the web UI; it is kept in that tab's session storage.
- `ROOM_TIMEZONE`: room context timezone, default `America/Toronto`.

Restart the server after configuration changes. A configured service failing does **not** silently become a demo service: startup fails if database setup fails, and Gemini errors return an unconfirmed request for retry. Without keys, deterministic room-hour rules route requests and bounded in-memory storage resets on server restart.

The server executes the idempotent [database schema](server/schema.sql) at startup. It includes patient baseline thresholds, persistent work orders, a high-frequency gaze hypertable, and a five-minute continuous aggregate with heatmap cells and blink statistics. The aggregate uses real-time raw data for recent buckets; completed buckets refresh every minute. The chart separately queries the last 60 seconds of raw data once per second. Raw telemetry has a seven-day retention policy.

The client performs landmark EMA and scalar Kalman filtering on-device. It sends batches of normalized coordinates, raw-to-filtered jitter, and blink durations at **up to 20 samples/second**, not video or facial landmarks. API bodies and batches are bounded and validated. Request IDs prevent duplicate tickets on retry.

## Deploy on Vultr with a GoDaddy domain

The repository includes a web backend container and Caddy HTTPS reverse proxy. Cloud deployment has not been performed.

1. Create a Vultr Linux compute instance and install Docker Engine with the Compose plugin.
2. Point the GoDaddy domain's DNS A record to the instance IP. Only add an AAAA record if IPv6 is correctly configured. Allow inbound ports 80 and 443 in the host/Vultr firewall; keep database ports private.
3. Clone the repository onto the instance and populate `.env` there. Set a strong `API_TOKEN`, your Gemini key, Tiger connection string, and `HOST=0.0.0.0`.
4. Set your domain and launch:

```sh
export OMNI_DOMAIN=your-domain.health
docker compose --env-file .env -f deploy/compose.yaml up -d --build
```

Caddy obtains HTTPS certificates. Open your domain and enter the access token. Do not put keys in client code or `VITE_` variables. Backend and API share the same origin; the API port is only exposed inside the Compose network. The static frontend is public, while API reads and writes require the configured token.

This is a single-room hackathon demo with a shared access token, not a clinical deployment. It does not notify real staff or integrate with a hospital system. Real patient use requires individual identities, role separation, access logging, privacy review, validated accessibility/hardware performance, and operational handling of missed requests.

## Verification and limits

```sh
npm run typecheck
npm run lint
npm test
npm run web:build
npm run package
```

Tests cover filtering, dwell rearming, blink timing, mapping, API authentication/origin validation, invalid inputs, concurrent deduplication, order updates, and telemetry aggregation. API integration tests start a temporary localhost server and require permission to bind a local port.

Coarse gaze uses iris coordinates in an eye-local frame, compensating in-plane head roll. It does **not** promise calibration-free precise gaze or full 3D posture compensation. Lighting, glasses, camera placement, head motion and individual anatomy affect accuracy. Kalman/EMA smoothing reduces jitter but cannot eliminate neurological tremors or prove intended selection. Blink counts are interaction signals, not a fatigue diagnosis. Room context currently uses time only; no room image, medication schedule, or sensor values are invented or collected. Audio is subject to browser playback permission.

Live webcam accuracy, Gemini calls, a real Tiger Data instance, Vultr deployment, and DNS/TLS still require verification with the relevant hardware/accounts. Docker validation requires a running daemon. Signing and notarization of desktop packages are not configured. The existing nut.js dependency chain reports moderate audit findings; review before production distribution.

Reference APIs: [Google Gen AI SDK](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html), [Tiger Data continuous aggregates](https://www.tigerdata.com/docs/build/continuous-aggregates/create-a-continuous-aggregate), and [MediaPipe Face Landmarker](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/face_landmarker/face_landmarker.ts).
