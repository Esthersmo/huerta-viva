import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: false,
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,webp,svg}'] },
      manifest: {
        name: 'Huerta Viva',
        short_name: 'Huerta Viva',
        description: 'Calendario de siembra por provincia, riegos y cuidados de tus plantas.',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#F6F3EE',
        theme_color: '#F6F3EE',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
