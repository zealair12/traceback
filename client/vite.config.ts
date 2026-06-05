import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // preserveSymlinks: resolve the file-linked package's imports against this
  // app's node_modules. dedupe: force a single copy of React even though the
  // package has its own (needed for its standalone widget build) -- otherwise
  // React hooks throw "more than one copy of React".
  resolve: { preserveSymlinks: true, dedupe: ['react', 'react-dom'] }
})
