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
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'badge-96.png'],
      manifest: {
        name: 'Древо — семейное дерево',
        short_name: 'Древо',
        description: 'Семейное генеалогическое дерево для всей семьи',
        lang: 'ru',
        start_url: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f6f1e7',
        theme_color: '#46682a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // Фон во весь квадрат: круг или «капельку» вырезает сам телефон.
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // woff2 — шрифт PT Sans: приложение без сети открывается с ним же.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Обработчики уведомлений (push, нажатие) — отдельным файлом из public.
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          { urlPattern: /\/api\/tree$/, handler: 'NetworkFirst', options: { cacheName: 'tree', networkTimeoutSeconds: 4 } },
          // rangeRequests: запись голоса Safari просит кусками (Range); целиком сохранённый файл режется на нужный кусок.
          { urlPattern: /\/api\/media\//, handler: 'CacheFirst', options: { cacheName: 'photos', rangeRequests: true, expiration: { maxEntries: 2000 } } },
        ],
      },
    }),
  ],
});
