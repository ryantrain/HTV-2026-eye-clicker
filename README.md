# OmniAccess development environment

Blank Electron + React + TypeScript starter. No application features are implemented.

## Installed stack

- Electron Forge and Vite for development and packaging
- React and TypeScript
- Tailwind CSS via the Vite plugin
- MediaPipe Tasks Vision for future face/gaze tracking
- Public `@nut-tree-fork/nut-js` for future native desktop input
- Vitest, Oxlint, and Oxfmt for testing, linting, and formatting

## Setup after cloning

Clone this repository and open a terminal in its root directory, where `Dockerfile` and `package.json` are located.

### Docker environment

Install Docker Desktop (macOS/Windows) or Docker Engine (Linux), and start it before running these commands. Host Node.js is not required for this workflow.

```sh
# Build the environment and run type checking, linting, and tests.
docker build -t omniaccess-dev .

# Run the default check again.
docker run --rm omniaccess-dev

# Optional: open a shell inside the environment.
docker run --rm -it omniaccess-dev bash
```

The Dockerfile uses Node.js 24 on Debian Bookworm, installs Linux native-input prerequisites, and installs npm dependencies from `package-lock.json` with `npm ci`. `.dockerignore` excludes host dependencies, build outputs, Git metadata, and local environment files.

Rebuild the image after changing source files or dependencies: the image contains a snapshot of the repository at build time. Changes made inside a container started with `--rm` are discarded when it exits.

If Docker reports **Cannot connect to the Docker daemon**, start Docker Desktop or your Docker service and retry. The Docker image build has not yet been verified because the daemon was unavailable during setup.

### Run the desktop app natively

For the Electron window and future camera and desktop-control features, use a native checkout. The Docker environment provides Linux dependency installation and checks; it does not control the host desktop or build a macOS app.

Install Node.js and npm locally. Node.js 24 is the Docker baseline; the native setup was verified with Node.js 25.8.1 and npm 11.11.0 on macOS Apple Silicon.

```sh
npm ci
npm start
```

This opens a blank Electron window ready for implementation. No API keys or cloud accounts are required for the current starter.

## Development commands

```sh
npm run typecheck
npm run lint
npm run lint:fix     # Apply lint and formatting fixes
npm test            # Test runner configured; no tests yet
npm run package     # Build a local desktop app
npm run make        # Create the platform archive/installer
```

Commit `package-lock.json` with dependency changes so teammates can reproduce the installation. Dependencies and generated build outputs are excluded from Git.

## Entry points

- `src/main.ts`: Electron window and lifecycle bootstrap
- `src/preload.ts`: Empty preload entry for future desktop APIs
- `src/renderer.tsx`: Empty React root
- `src/index.css`: Tailwind entry
- `forge.config.mts` and `vite.*.config.mts`: Build configuration

Camera tracking, models/WASM assets, overlays, IPC commands, input actions, cloud services, and credentials have not been implemented or configured. Add macOS Camera/Accessibility permissions when implementing those features. Distribution signing and notarization are not configured.

The public nut.js fork is installed because official prebuilt packages require a subscription. Its image-processing dependency chain reports seven moderate npm audit entries with no supported automatic fix. Review that dependency before production use. Only macOS ARM64 packaging has been checked.
