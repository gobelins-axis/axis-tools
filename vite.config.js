import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Single-page Vue app: the hub at / and one route per tool under
// /tools/<id>/ (src/router.js). Netlify rewrites every path to index.html
// (netlify.toml); `vite` and `vite preview` do the same out of the box.
export default defineConfig({
    plugins: [vue()],
    server: {
        port: 8090,
    },
    build: {
        // Conservative target: old launcher installs shipped Electron 17 (Chromium 98).
        target: 'chrome98',
    },
});
