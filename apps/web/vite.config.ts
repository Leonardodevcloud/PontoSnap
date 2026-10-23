import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      workbox: {
        // Injeta o handler de push dentro do SW gerado pelo workbox
        importScripts: ['sw-push.js'],
        // pdf.js (visor da conferência de notas) só baixa quando o RH abre um PDF.
        globIgnores: ['**/pdfjs-*.js', '**/index-*unpdf*.js', '**/municipios-br-*.js'],
      },
      manifest: {
        name: 'PontoSnap',
        short_name: 'PontoSnap',
        description: 'Bater ponto num estalo.',
        theme_color: '#2457D6',
        background_color: '#F5F7FB',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
});
