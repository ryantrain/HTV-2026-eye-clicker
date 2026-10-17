import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('desktop', {
  calibrate: (enabled: boolean) => ipcRenderer.invoke('calibrate', enabled),
  enable: (enabled: boolean) => ipcRenderer.invoke('enable', enabled),
  point: (x: number, y: number, click: boolean) =>
    ipcRenderer.invoke('point', x, y, click),
  onCommand: (callback: (command: 'calibrate' | 'resume') => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      command: 'calibrate' | 'resume',
    ) => callback(command);
    ipcRenderer.on('overlay-command', listener);
    return () => ipcRenderer.removeListener('overlay-command', listener);
  },
  onPause: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('paused', listener);
    return () => ipcRenderer.removeListener('paused', listener);
  },
});
