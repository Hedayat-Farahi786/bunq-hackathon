import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],

    server: {
      port: 5173,
      host: true,
      allowedHosts: ['d2y2jojtwuiz3o.cloudfront.net', 'd2bbh4xzc284n4.cloudfront.net'],
      // Proxy all /api calls to the Express backend.
      // This means the browser never needs to know the backend port,
      // and CORS is never an issue in development.
      proxy: {
        '/api': {
          target:      `http://localhost:${env.PORT || 3001}`,
          changeOrigin: true,
          secure:       false,
          // CRITICAL for TTS streaming: disable proxy-level buffering so chunks
          // flow to the browser the instant the server emits them.
          ws:           false,
          configure(proxy) {
            proxy.on('proxyRes', (proxyRes) => {
              delete proxyRes.headers['content-length']
              proxyRes.headers['cache-control'] = 'no-store'
            })
          },
        },
      },
    },

    publicDir: 'public',

    build: {
      outDir: 'public',
      emptyOutDir: false,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            motion: ['framer-motion'],
          },
        },
      },
    },

    // Expose VITE_ prefixed env vars to the frontend.
    // Backend secrets (ANTHROPIC_API_KEY, etc.) are NOT prefixed with VITE_
    // and therefore never bundled into client code.
    envPrefix: 'VITE_',
  }
})
