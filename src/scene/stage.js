// The 3D machine behind every page: one MachineScene for the whole app,
// created once by App.vue (its canvas sits under the router view) and never
// torn down. three.js loads in its own chunk, after the first page shows.
//
// Each route names a stage in its meta (router.js): 'hub', 'calibration',
// 'led' or 'hidden' (the input debugger covers the screen: no rendering).
// Views refine it (calibration focuses the joystick being calibrated) and the
// LED check drives the strips and the camera focus through getMachine().
//
// Mirrored everywhere: buttons press in and light, sticks tilt (game values).

import { ref } from 'vue';
import { Axis } from '../axis/axis.js';

export const stageName = ref('hub');
export const loaded = ref(false);
export const failed = ref(false);
// Full-screen cover in the input debugger's background colour (App.vue):
// the end of the dive into the screen, faded out once the debugger shows.
export const whiteout = ref(false);

let machine = null;
let pending = { name: 'hub', options: {} };

/** The scene once loaded, else null. */
export function getMachine() {
    return loaded.value ? machine : null;
}

/** @param {'hub' | 'calibration' | 'led' | 'screen' | 'hidden'} name */
export function setStage(name, options = {}) {
    stageName.value = name;
    if (name === 'hidden') {
        if (machine) machine.setPaused(true);
        return;
    }
    pending = { name, options };
    if (!machine) return;
    machine.setPaused(false);
    machine.setStage(name, options);
}

/**
 * The input debugger's entrance (machine.js diveIntoScreen): resolves true
 * once the page is covered, false if the scene isn't there (or reduced
 * motion is on) or another stage interrupted it. Navigate on true.
 */
export function diveIntoScreen() {
    const machine = getMachine();
    if (!machine || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve(false);
    // Full brightness on the canvas (App.vue), like the LED check.
    stageName.value = 'screen';
    pending = { name: 'screen', options: {} };
    return machine.diveIntoScreen({ onWhite: () => { whiteout.value = true; } });
}

export async function mountStage(canvas) {
    if (machine) return;
    const { MachineScene } = await import('./machine.js');
    machine = new MachineScene(canvas);
    machine.setStage(pending.name, pending.options);

    // Dev only: poke the scene from the console.
    if (import.meta.env.DEV) window.__machine = machine;

    try {
        await machine.load();
    } catch (error) {
        console.error(error);
        failed.value = true;
        return;
    }
    machine.start();
    if (stageName.value === 'hidden') machine.setPaused(true);
    loaded.value = true;
}

// Buttons and sticks, whatever the page.
Axis.addEventListener('keydown', (e) => { if (machine) machine.setButton(e.key, e.id, true); });
Axis.addEventListener('keyup', (e) => { if (machine) machine.setButton(e.key, e.id, false); });
Axis.buttonManager.buttonHome.addEventListener('keydown', () => { if (machine) machine.setHome(true); });
Axis.buttonManager.buttonHome.addEventListener('keyup', () => { if (machine) machine.setHome(false); });
[1, 2].forEach((id) => {
    Axis[`joystick${id}`].addEventListener('joystick:move', (e) => {
        if (machine) machine.setJoystick(id, e.position.x, e.position.y);
    });
});
