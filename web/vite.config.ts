import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const SOCKET_PROXY_TARGET: string = process.env.VITE_SOCKET_PROXY_TARGET ?? 'http://localhost:4000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/socket.io': {
        target: SOCKET_PROXY_TARGET,
        ws: true,
        changeOrigin: true
      }
    },
    allowedHosts: true,
  },
  preview: {
    proxy: {
      '/socket.io': {
        target: SOCKET_PROXY_TARGET,
        ws: true,
        changeOrigin: true
      }
    },
    allowedHosts: true,
  },
})
