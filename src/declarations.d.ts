/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';
interface Window {
  desktop: {
    calibrate(enabled: boolean): Promise<void>;
    enable(enabled: boolean): Promise<void>;
    point(x: number, y: number, click: boolean): Promise<void>;
    onCommand(callback: (command: 'calibrate' | 'resume') => void): () => void;
    onPause(callback: () => void): () => void;
  };
}
