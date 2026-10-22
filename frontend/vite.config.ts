import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Porta 3000 reservada para o preview; o proxy /api encaminha para o backend
// Spring Boot em desenvolvimento para que o frontend nunca aponte para
// "localhost" do browser (que no preview remoto seria a máquina do utilizador).
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    allowedHosts: ['pv-18804d082349-f13ba90b-6992-4542-857a-7c47657b0b9c.style.dev'],
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/actuator': { target: apiTarget, changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
