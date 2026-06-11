import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('error', (_err, _req, res) => {
            if (res.writeHead) {
              res.writeHead(502, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                error: 'Local API not running on :3001. Run `npm run dev` or set VITE_API_URL in .env to the Render backend URL.',
              }))
            }
          })
        },
      },
    },
  },
})
