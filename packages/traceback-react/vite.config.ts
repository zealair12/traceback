import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Builds the standalone "drop into any website" widget: one self-contained JS
// file (React bundled in) that exposes a global `Traceback` with a mount()
// function and registers the <traceback-chat> custom element, plus one CSS file.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // React (bundled into the widget) checks process.env.NODE_ENV at runtime.
  // The browser has no `process`, so we replace it at build time -- otherwise
  // the bundle throws on load. Also puts React in faster production mode.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: {
      entry: 'src/embed.tsx',
      name: 'Traceback',
      formats: ['iife'],
      fileName: () => 'traceback-widget.js'
    },
    outDir: 'dist-widget',
    cssCodeSplit: false,
    emptyOutDir: true
  }
});
