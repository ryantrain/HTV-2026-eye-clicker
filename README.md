# OmniAccess development environment

Blank Electron + React + TypeScript starter. No application features are implemented.

## Installed stack

- Electron Forge and Vite for development and packaging
- React and TypeScript
- Tailwind CSS via the Vite plugin
- MediaPipe Tasks Vision for future face/gaze tracking
- Public `@nut-tree-fork/nut-js` for future native desktop input
- Vitest, Oxlint, and Oxfmt for testing, linting, and formatting

Verified toolchain: Node 25.8.1 and npm 11.11.0 on macOS Apple Silicon.

## Commands

```sh
npm ci              # Reinstall dependencies from the lockfile
npm start           # Open a blank Electron window with hot reload
npm run typecheck
npm run lint
npm test            # Test runner configured; no tests yet
npm run package     # Build a local desktop app
npm run make        # Create the platform archive/installer
```

## Entry points

- `src/main.ts`: Electron window and lifecycle bootstrap
- `src/preload.ts`: Empty preload entry for future desktop APIs
- `src/renderer.tsx`: Empty React root
- `src/index.css`: Tailwind entry
- `forge.config.mts` and `vite.*.config.mts`: Build configuration

Camera tracking, models/WASM assets, overlays, IPC commands, input actions, cloud services, and credentials have not been implemented or configured. Add macOS Camera/Accessibility permissions when implementing those features. Distribution signing and notarization are not configured.

The public nut.js fork is installed because official prebuilt packages require a subscription. Its image-processing dependency chain reports seven moderate npm audit entries with no supported automatic fix. Review that dependency before production use. Only macOS ARM64 packaging has been checked.
