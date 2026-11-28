<script setup>
// LED check.
//
// Drives the machine's LEDs exclusively through axis-api, exactly like a game
// would (axis-api -> led:set IPC -> launcher LedManager -> serial -> V6-LED
// firmware), and mirrors everything on the 3D machine behind every page
// (src/scene/: the 'led' stage brings the camera to the rest view with the
// green atmosphere, then hands it to the mouse / W focus / joystick orbit).
// Button presses and stick tilts are mirrored by the stage itself.
// Everything starts off.
//
//   - Button echo: a held button moves in on the 3D machine and its LED
//     lights white, on screen and on the machine.
//   - Strip sweep: holding W of controller 1 lights the left strip one LED at
//     a time, W of controller 2 the right strip. At the end of a strip the
//     sweep restarts from the top with the next colour: red, green, blue...
//     A strip lighting for the other controller's W points at a wiring swap.
//   - Joysticks tilt on the 3D machine and orbit the camera: full left
//     shows the right side, full right the left side, up / down raise or
//     lower it slightly, centred is the rest view. A held W sweep takes over
//     the camera while it runs.
//
// Without the machine: keyboard and gamepad 0 (src/axis/axis.js).

import { reactive, ref, computed, watch, onBeforeUnmount } from 'vue';
import AppHeader from '../../components/AppHeader.vue';
import InputIndicators from '../../components/InputIndicators.vue';
import { Axis, getIpc } from '../../axis/axis.js';
import { useAxisEvents } from '../../axis/useAxisEvents.js';
import { getMachine, loaded, failed } from '../../scene/stage.js';

// LEDs on the 3D strips (machine.js STRIP_LENGTH; kept here so the scene
// chunk stays lazy).
const STRIP_LENGTH = 51;

const { on } = useAxisEvents();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ECHO_COLOR = 'white';
const OFF_COLOR = 'black';

// Which controller's W drives which strip.
const SWEEP_BUTTONS = {
    left: { key: 'w', id: 1 },
    right: { key: 'w', id: 2 },
};
const SIDES = Object.keys(SWEEP_BUTTONS);
const SWEEP_COLORS = [
    { name: 'red', css: 'rgb(255, 0, 0)' },
    { name: 'green', css: 'rgb(0, 255, 0)' },
    { name: 'blue', css: 'rgb(0, 0, 255)' },
];
// One LED every 40 ms: a 51-LED strip takes about two seconds per pass.
const SWEEP_STEP_MS = 40;

const STRIP_TITLES = { left: 'Left strip', right: 'Right strip' };
const inputs = [{ key: 'home', label: 'Tools' }];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const strips = {
    left: Axis.ledManager.getLedGroupByName('left-strip'),
    right: Axis.ledManager.getLedGroupByName('right-strip'),
};

function createSweep(length) {
    return {
        running: false,
        timer: null,
        index: 0, // next LED to light
        colorIndex: 0,
        passes: 0,
        cells: new Array(length).fill(null), // CSS colour per LED, mirrors the strip
    };
}

// Plain objects: the sweeps tick every 40 ms, only the panel text is reactive.
const sweeps = {
    left: createSweep(strips.left.leds.length),
    right: createSweep(strips.right.leds.length),
};

const panels = reactive({ left: {}, right: {} });
const sent = ref(0); // LED commands issued
const loading = computed(() => {
    if (failed.value) return 'Could not load the 3D machine';
    return loaded.value ? '' : 'Loading the machine…';
});

// Buttons pressed while this view is shown: a keyup without its keydown is
// the button that opened the tool being released, not a press here.
const held = new Set();

// ---------------------------------------------------------------------------
// Render (3D strips + the small stats panel)
// ---------------------------------------------------------------------------

function renderSweep(side) {
    const sweep = sweeps[side];
    const machine = getMachine();
    // The 3D strip has STRIP_LENGTH LEDs; the axis-api group may differ by a few.
    if (machine) {
        const colors = Array.from({ length: STRIP_LENGTH }, (_, i) => sweep.cells[i] || null);
        machine.setStrip(side, colors);
    }

    panels[side] = {
        running: sweep.running,
        status: sweep.running ? 'Sweeping' : `Hold W${SWEEP_BUTTONS[side].id}`,
        colorName: SWEEP_COLORS[sweep.colorIndex].name,
        colorCss: SWEEP_COLORS[sweep.colorIndex].css,
        index: `${sweep.index} / ${sweep.cells.length}`,
        passes: String(sweep.passes),
    };
}

// ---------------------------------------------------------------------------
// LED control (axis-api only)
// ---------------------------------------------------------------------------

function setButtonLed(key, id, color) {
    const button = id === 0 ? Axis.buttonManager.buttonHome : Axis.buttonManager.getButton(key, id);
    if (!button) return;
    button.setLedColor(color);
    sent.value++;
}

function setStripLed(side, index, color) {
    strips[side].leds[index].setColor(color);
    sent.value++;
}

function sweepStep(side) {
    const sweep = sweeps[side];
    const color = SWEEP_COLORS[sweep.colorIndex];

    setStripLed(side, sweep.index, color.css);
    sweep.cells[sweep.index] = color.css;
    sweep.index++;

    if (sweep.index >= sweep.cells.length) {
        // End of the strip: restart from the top with the next colour,
        // overwriting the previous pass LED by LED.
        sweep.index = 0;
        sweep.colorIndex = (sweep.colorIndex + 1) % SWEEP_COLORS.length;
        sweep.passes++;
    }

    renderSweep(side);
}

function startSweep(side) {
    const sweep = sweeps[side];
    if (sweep.running) return;
    sweep.running = true;
    getMachine()?.setFocus(side, true);
    sweepStep(side);
    sweep.timer = setInterval(() => sweepStep(side), SWEEP_STEP_MS);
    renderSweep(side);
}

function pauseSweep(side) {
    const sweep = sweeps[side];
    if (!sweep.running) return;
    sweep.running = false;
    getMachine()?.setFocus(side, false);
    clearInterval(sweep.timer);
    sweep.timer = null;
    renderSweep(side);
}

// The strip whose sweep button matches this event, if any.
function sweepSideFor(e) {
    return SIDES.find((side) => SWEEP_BUTTONS[side].key === e.key && SWEEP_BUTTONS[side].id === e.id);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

on(Axis, 'keydown', (e) => {
    held.add(`${e.key}:${e.id}`);
    setButtonLed(e.key, e.id, ECHO_COLOR);

    const side = sweepSideFor(e);
    if (side) startSweep(side);
});

on(Axis, 'keyup', (e) => {
    if (!held.delete(`${e.key}:${e.id}`)) return;
    setButtonLed(e.key, e.id, OFF_COLOR);

    const side = sweepSideFor(e);
    if (side) pauseSweep(side);
});

// Home also opens the exit overlay (back to the tools); light it while held.
on(Axis.buttonManager.buttonHome, 'keydown', () => {
    held.add('home:0');
    setButtonLed('home', 0, ECHO_COLOR);
});
on(Axis.buttonManager.buttonHome, 'keyup', () => {
    if (!held.delete('home:0')) return;
    setButtonLed('home', 0, OFF_COLOR);
});

// Either joystick orbits the camera (the stage tilts the sticks); per axis, the one pushed furthest wins.
const sticks = { 1: { x: 0, y: 0 }, 2: { x: 0, y: 0 } };
const furthest = (axis) => (Math.abs(sticks[1][axis]) >= Math.abs(sticks[2][axis]) ? sticks[1][axis] : sticks[2][axis]);

[1, 2].forEach((id) => {
    on(Axis[`joystick${id}`], 'joystick:move', (e) => {
        sticks[id] = { x: e.position.x, y: e.position.y };
        getMachine()?.setOrbit(furthest('x'), furthest('y'));
    });
});

// Stop the timers so no command is issued after leaving, and switch every
// LED this page lit back off (the launcher only clears on page loads).
function shutdown() {
    SIDES.forEach(pauseSweep);
    const ipc = getIpc();
    if (ipc) ipc.send('led:clear');
}

on(window, 'beforeunload', shutdown);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

SIDES.forEach(renderSweep);
// The scene may still be loading when the view opens.
watch(loaded, () => SIDES.forEach(renderSweep));

// The scene stays: leave its strips dark and its camera free of this page.
onBeforeUnmount(() => {
    shutdown();
    const machine = getMachine();
    if (!machine) return;
    machine.setStrip('left', []);
    machine.setStrip('right', []);
    machine.setOrbit(0, 0);
});
</script>

<template>
    <!-- The 3D machine is the app's background canvas (App.vue) -->
    <p v-if="loading" class="loading">{{ loading }}</p>

    <div class="layout">
        <AppHeader />

        <main class="view">
            <div class="heading">
                <h1 class="title">LED check</h1>
                <p class="description">Press any button to light its LED. Hold W1 to sweep the left strip, W2 for the right one, in red, then green, then blue. Push a joystick left or right to look at the sides. Every light goes through axis-api, like in a game.</p>
            </div>

            <div class="sweeps">
                <section v-for="side in SIDES" :key="side" class="sweep" :class="{ 'is-running': panels[side].running }">
                    <h2 class="sweep-title">{{ STRIP_TITLES[side] }} <span class="sweep-key">W{{ SWEEP_BUTTONS[side].id }}</span></h2>
                    <dl class="sweep-values">
                        <dt>Status</dt><dd>{{ panels[side].status }}</dd>
                        <dt>Colour</dt><dd :style="{ color: panels[side].colorCss }">{{ panels[side].colorName }}</dd>
                        <dt>Next LED</dt><dd>{{ panels[side].index }}</dd>
                        <dt>Passes</dt><dd>{{ panels[side].passes }}</dd>
                    </dl>
                </section>
            </div>
        </main>

        <div class="footnote">LED commands sent: <span>{{ sent }}</span></div>

        <InputIndicators :inputs="inputs" />
    </div>
</template>

<style scoped>
/* The layout floats above the 3D machine and lets the mouse through to
   its orbit controls. */
.layout {
    pointer-events: none;
}

.loading {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    font-weight: 700;
    font-size: 1.25rem;
    color: var(--grey);
}

.heading { max-width: 30rem; }

.description { max-width: 28rem; }

/* Strip stats, bottom left above the footnote */
.view { grid-template-rows: auto 1fr; }

.sweeps {
    align-self: end;
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    margin-bottom: 1.6rem;
}

.sweep {
    padding-left: 1rem;
    border-left: 0.2rem solid var(--black-2);
    transition: border-color 0.3s var(--expo-out);
}

.sweep.is-running { border-left-color: var(--white); }

.sweep-title {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
    font-weight: 800;
    font-size: 1.4rem;
    line-height: 1;
}

.sweep-key {
    padding: 0.1rem 0.45rem 0.18rem;
    border-radius: 0.6rem 0.6rem 0.6rem 0;
    background: var(--black-1);
    font-weight: 700;
    font-size: 0.8rem;
    color: var(--light-grey);
}

.sweep.is-running .sweep-key { background: var(--white); color: var(--black); }

.sweep-values {
    display: grid;
    grid-template-columns: 7rem auto;
    justify-content: start;
    column-gap: 1.2rem;
    row-gap: 0.2rem;
    font-weight: 600;
    font-size: 1rem;
    line-height: 1.3;
    color: var(--light-grey);
    font-variant-numeric: tabular-nums;
}

.sweep-values dt { color: var(--grey); }
</style>
