import { defineConfig } from 'vite';
export default defineConfig({
  build: { rollupOptions: { external: ['@nut-tree-fork/nut-js'] } },
});
