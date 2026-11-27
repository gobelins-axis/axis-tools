import { resolve } from 'path';
import { defineConfig } from 'vite';

// Multi-page site: the hub at / and one page per tool under /tools/<id>/.
// Each tool is its own page on purpose: switching tools is a full page load,
// so axis-api, IPC listeners and LED state start clean every time (the
// launcher also clears the LEDs on every load).
const pages = {
    hub: 'index.html',
    calibration: 'tools/calibration/index.html',
    inputs: 'tools/inputs/index.html',
    led: 'tools/led/index.html',
    alternative: 'tools/alternative/index.html',
};

export default defineConfig({
    server: {
        port: 8090,
    },
    build: {
        // Conservative target: old launcher installs shipped Electron 17 (Chromium 98).
        target: 'chrome98',
        rollupOptions: {
            input: Object.fromEntries(Object.entries(pages).map(([name, file]) => [name, resolve(import.meta.dirname, file)])),
        },
    },
});
