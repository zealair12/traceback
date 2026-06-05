import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The chat UI lives in the file-linked @traceback/react package. preserveSymlinks
  // makes its imports (react, @xyflow/react, etc.) resolve against this app's
  // node_modules instead of the package's real path, which has none installed.
  resolve: { preserveSymlinks: true }
})
