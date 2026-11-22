import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Tâm Giao Đối tác',
        short_name: 'TG Đối tác',
        lang: 'vi',
        start_url: '/',
        display: 'standalone',
        theme_color: '#b80035',
        background_color: '#f8f9ff',
        icons: [],
      },
    }),
  ],
  server: {
    port: 5174,
  },
});
