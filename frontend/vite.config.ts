import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 9316,        // Above MCP server (9315) to avoid increment clashes
    strictPort: false  // Falls back to auto-increment if 9316 is taken
  }
})
