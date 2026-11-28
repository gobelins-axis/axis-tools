// Routes: the hub at / and one route per tool at /tools/<id>/ (same URLs as
// the old multi-page site, so links stored elsewhere keep working).
//
// meta.tool    tool id: Home -> exit goes back to the hub (src/axis/axis.js)
// meta.theme   'cabinet' (design system, src/styles/base.css) or 'dev'
//              (the input debugger's light look), set on <html data-theme>
// meta.title   document title
// meta.stage   3D background stage (src/scene/stage.js): 'hub' | 'calibration'
//              | 'led' | 'hidden'

import { createRouter, createWebHistory } from 'vue-router';
import HubView from './views/HubView.vue';
import { TOOLS } from './tools.js';
import { getIpc } from './axis/axis.js';

const VIEWS = {
    calibration: () => import('./views/calibration/CalibrationView.vue'),
    inputs: () => import('./views/inputs/InputsView.vue'),
    led: () => import('./views/led/LedView.vue'),
    alternative: () => import('./views/alternative/AlternativeView.vue'),
};

const THEMES = { inputs: 'dev' };
const STAGES = { calibration: 'calibration', led: 'led', inputs: 'hidden' };

export const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: '/', name: 'hub', component: HubView, meta: { theme: 'cabinet', title: 'Axis Tools', stage: 'hub' } },
        ...TOOLS.map((tool) => ({
            path: `/tools/${tool.id}/`,
            name: tool.id,
            component: VIEWS[tool.id],
            meta: { tool: tool.id, theme: THEMES[tool.id] || 'cabinet', title: `${tool.name} · Axis Tools`, stage: STAGES[tool.id] || 'hub' },
        })),
        { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
});

router.beforeEach((to) => {
    document.documentElement.dataset.theme = to.meta.theme || 'cabinet';
    document.title = to.meta.title || 'Axis Tools';
});

// The launcher clears the LEDs on every page load; route changes are not
// page loads, so do it here (the LED check also clears when it unmounts).
router.afterEach((to, from) => {
    if (!from.matched.length) return; // first navigation = the page load itself
    const ipc = getIpc();
    if (ipc) ipc.send('led:clear');
});
