import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Dev only. The Claude desktop app runs Node under an AppContainer that
    // realpaths this folder to a virtualized path outside Vite's default allowlist.
    fs: { strict: false },
  },
});
