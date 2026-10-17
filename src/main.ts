import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  systemPreferences,
  Menu,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { protectProcessOutput } from './process-output';
protectProcessOutput();
if (started) app.quit();
let window: BrowserWindow;
let enabled = false;
let busy = false;
let lastFrame = 0;
let inputGeneration = 0;
let accessibilityPrompted = false;
let display: Electron.Display;
function hasControlAccess() {
  if (process.platform !== 'darwin') return true;
  const allowed = systemPreferences.isTrustedAccessibilityClient(
    !accessibilityPrompted,
  );
  accessibilityPrompted = true;
  return allowed;
}
function clickThrough() {
  if (!window || window.isDestroyed()) return;
  window.setIgnoreMouseEvents(true, { forward: true });
  window.setFocusable(false);
  window.blur();
}
function command(value: 'calibrate' | 'resume') {
  send('overlay-command', value);
}
function send(channel: string, ...args: unknown[]) {
  if (
    window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed() &&
    !window.webContents.isCrashed()
  )
    window.webContents.send(channel, ...args);
}
function pause() {
  enabled = false;
  inputGeneration++;
  clickThrough();
  send('paused');
}
function createWindow() {
  display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  window = new BrowserWindow({
    ...display.bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    fullscreenable: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',

    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.setAlwaysOnTop(true, 'floating');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback) =>
      callback(contents === window.webContents && permission === 'media'),
  );
  window.webContents.on('will-navigate', (event, url) => {
    const destination = new URL(url);
    const current = new URL(window.webContents.getURL());
    if (
      destination.origin !== current.origin ||
      destination.pathname !== current.pathname
    )
      event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('closed', pause);
  window.webContents.on('render-process-gone', pause);
  window.webContents.on('unresponsive', pause);
  window.webContents.on('did-start-navigation', pause);
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else
    void window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
}
app.whenReady().then(() => {
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Untrusted input');
  };
  ipcMain.handle('calibrate', (event, value: unknown) => {
    trusted(event);
    pause();
    if (value === true) {
      // Ask before calibration so the system prompt cannot interrupt the handoff.
      hasControlAccess();
      display =
        screen.getAllDisplays().find((d) => d.id === display.id) ||
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      window.setBounds(display.bounds);
      window.setFocusable(true);
      window.setIgnoreMouseEvents(false);
      window.show();
      window.focus();
    }
  });
  ipcMain.handle('enable', async (event, value: unknown) => {
    trusted(event);
    enabled = false;
    inputGeneration++;
    const generation = inputGeneration;
    clickThrough();
    if (value === true) {
      if (!hasControlAccess()) {
        throw new Error(
          'Allow OmniAccess (Electron during development) in System Settings → Privacy & Security → Accessibility. Control will start automatically once access is granted.',
        );
      }
      // Load native control before reporting success, rather than on the first gaze frame.
      await import('@nut-tree-fork/nut-js');
      if (generation !== inputGeneration) return;
      enabled = true;
      window.showInactive();
    }
  });
  ipcMain.handle(
    'point',
    async (event, x: unknown, y: unknown, click: unknown) => {
      trusted(event);
      if (!enabled || busy) return;
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        x > 1 ||
        y < 0 ||
        y > 1 ||
        typeof click !== 'boolean'
      )
        throw new Error('Invalid pointer');
      if (!click && Date.now() - lastFrame < 50) return;
      busy = true;
      lastFrame = Date.now();
      const generation = inputGeneration;
      try {
        const { mouse, Point, Button } = await import('@nut-tree-fork/nut-js');
        if (!enabled || generation !== inputGeneration) return;
        const { bounds } = display;
        await mouse.setPosition(
          new Point(
            Math.round(bounds.x + x * (bounds.width - 1)),
            Math.round(bounds.y + y * (bounds.height - 1)),
          ),
        );
        if (enabled && generation === inputGeneration && click)
          await mouse.click(Button.LEFT);
      } catch (error) {
        // The renderer retains calibration and retries access after a control failure.
        enabled = false;
        inputGeneration++;
        clickThrough();
        throw error;
      } finally {
        busy = false;
      }
    },
  );
  createWindow();
  const toggle = () => {
    if (enabled) pause();
    else command('resume');
  };
  const recalibrate = () => {
    pause();
    command('calibrate');
  };
  const shortcuts = [
    ['CommandOrControl+Shift+Space', toggle],
    ['CommandOrControl+Shift+R', recalibrate],
    ['CommandOrControl+Shift+Q', () => app.quit()],
  ] as const;
  for (const [key, handler] of shortcuts) {
    if (!globalShortcut.register(key, handler))
      console.error(`Shortcut unavailable: ${key}`);
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'OmniAccess',
        submenu: [
          { label: 'Pause / resume gaze control', click: toggle },
          { label: 'Recalibrate screen', click: recalibrate },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
    ]),
  );
  const displayChanged = () => {
    pause();
    command('calibrate');
  };
  screen.on('display-removed', displayChanged);
  screen.on('display-metrics-changed', (_event, changed) => {
    if (changed.id === display.id) displayChanged();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
