import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/supply-requests': 'http://localhost:3000',
      '/concerns': 'http://localhost:3000',
      '/crew-off-requests': 'http://localhost:3000',
      '/export': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/timesheet': 'http://localhost:3000',
    },
  },
});
