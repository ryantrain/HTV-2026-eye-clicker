import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const webContents = {
    mainFrame: {},
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isCrashed: vi.fn(() => false),
    session: { setPermissionRequestHandler: vi.fn() },
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  };
  const window = {
    webContents,
    isDestroyed: () => false,
    setIgnoreMouseEvents: vi.fn(),
    setFocusable: vi.fn(),
    blur: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    on: vi.fn(),
    loadFile: vi.fn(),
    setBounds: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    showInactive: vi.fn(),
    getContentBounds: () => mocks.display.bounds,
  };
  return {
    handlers,
    window,
    access: vi.fn(() => true),
    setPosition: vi.fn(),
    click: vi.fn(),
    display: { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } },
  };
});
vi.mock('electron-squirrel-startup', () => ({ default: false }));
vi.mock('./process-output', () => ({ protectProcessOutput: vi.fn() }));
vi.mock('electron', () => ({
  app: { whenReady: () => Promise.resolve(), on: vi.fn(), quit: vi.fn() },
  BrowserWindow: class {
    constructor() {
      return mocks.window;
    }
  },
  globalShortcut: { register: () => true, unregisterAll: vi.fn() },
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) =>
      mocks.handlers.set(name, handler),
  },
  screen: {
    getDisplayNearestPoint: () => mocks.display,
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getAllDisplays: () => [mocks.display],
    on: vi.fn(),
  },
  systemPreferences: { isTrustedAccessibilityClient: mocks.access },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
}));
vi.mock('@nut-tree-fork/nut-js', () => ({
  mouse: { setPosition: mocks.setPosition, click: mocks.click },
  Point: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
  Button: { LEFT: 0 },
}));

const event = {
  sender: mocks.window.webContents,
  senderFrame: mocks.window.webContents.mainFrame,
};
const invoke = (name: string, ...args: unknown[]) =>
  mocks.handlers.get(name)!(event, ...args);

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.window.webContents.isDestroyed.mockReturnValue(false);
  mocks.window.webContents.isCrashed.mockReturnValue(false);
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', '');
  vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');
  await import('./main');
  await Promise.resolve();
});

it.each(['isDestroyed', 'isCrashed'] as const)(
  'does not send pause notifications when renderer %s',
  (state) => {
    mocks.window.webContents.send.mockClear();
    mocks.window.webContents[state].mockReturnValue(true);
    expect(() => invoke('calibrate', false)).not.toThrow();
    expect(mocks.window.webContents.send).not.toHaveBeenCalled();
  },
);

it('requests macOS access during calibration and starts moving after access is granted', async () => {
  if (process.platform !== 'darwin') return;
  mocks.access.mockReturnValue(false);
  invoke('calibrate', true);
  expect(mocks.access).toHaveBeenCalledWith(true);
  await expect(invoke('enable', true)).rejects.toThrow('Accessibility');
  expect(mocks.access).toHaveBeenLastCalledWith(false);
  mocks.access.mockReturnValue(true);
  await invoke('enable', true);
  await invoke('point', 0.75, 0.25, false);
  expect(mocks.setPosition).toHaveBeenCalledWith({ x: 749, y: 200 });
});

it('allows control to recover after a native cursor failure without broadcasting pause', async () => {
  mocks.access.mockReturnValue(true);
  await invoke('enable', true);
  mocks.window.webContents.send.mockClear();
  mocks.setPosition.mockRejectedValueOnce(new Error('Access denied'));
  await expect(invoke('point', 0.5, 0.5, true)).rejects.toThrow(
    'Access denied',
  );
  expect(mocks.window.webContents.send).not.toHaveBeenCalledWith('paused');
  expect(mocks.click).not.toHaveBeenCalled();
  await invoke('enable', true);
  await invoke('point', 0.75, 0.25, true);
  expect(mocks.setPosition).toHaveBeenLastCalledWith({ x: 749, y: 200 });
  expect(mocks.click).toHaveBeenCalledOnce();
});
