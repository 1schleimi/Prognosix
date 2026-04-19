import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/predict':         'http://localhost:8000',
      '/history':         'http://localhost:8000',
      '/quote':           'http://localhost:8000',
      '/health':          'http://localhost:8000',
      '/backtest-report': 'http://localhost:8000',
      '/equity':          'http://localhost:8000',
      '/thresholds':      'http://localhost:8000',
    },
  },
})
