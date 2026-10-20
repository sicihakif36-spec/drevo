import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) } },
  server: { proxy: { '/api': 'http://127.0.0.1:8095' }, fs: { allow: ['..'] } },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Древо — семейное дерево',
        short_name: 'Древо',
        description: 'Семейное генеалогическое дерево для всей семьи',
        lang: 'ru',
        start_url: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f7f3ec',
        theme_color: '#5b7a3a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          { urlPattern: /\/api\/tree$/, handler: 'NetworkFirst', options: { cacheName: 'tree', networkTimeoutSeconds: 4 } },
          { urlPattern: /\/api\/media\//, handler: 'CacheFirst', options: { cacheName: 'photos', expiration: { maxEntries: 2000 } } },
        ],
      },
    }),
  ],
});
