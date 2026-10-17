import { cpSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// Serve and package the WASM runtime from the installed MediaPipe version.
mkdirSync('public/wasm', { recursive: true });
cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/wasm', {
  recursive: true,
});
export default defineConfig({
  base: './',
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  plugins: [react(), tailwindcss()],
});
