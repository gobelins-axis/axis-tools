// LED check.
//
// Drives the machine's LEDs exclusively through axis-api, exactly like a game
// would (axis-api -> led:set IPC -> launcher LedManager -> serial -> V6-LED
// firmware), and mirrors everything on a 3D model of the machine
// (machine.js). Everything starts off.
//
//   - Button echo: a held button moves in on the 3D machine and its LED
//     lights white, on screen and on the machine.
//   - Strip sweep: holding W of controller 1 lights the left strip one LED at
//     a time, W of controller 2 the right strip. At the end of a strip the
//     sweep restarts from the top with the next colour: red, green, blue...
//     A strip lighting for the other controller's W points at a wiring swap.
//   - Joysticks tilt on the 3D machine and orbit the camera: full left
//     shows the right side, full right the left side, up / down raise or
//     lower it slightly, centred is the rest view. A held W sweep takes over the camera while it runs.
//
// Without the machine: keyboard (see src/shared/axis.js) and gamepad 0,
// set up as the axis-api README describes: left stick = joystick 1, right
// stick = joystick 2, buttons 0-3 = A X I S of group 1, 4-7 = group 2 (same
// as the inputs tool), d-pad left = W1, d-pad right = W2.

import '../../src/shared/base.css';
import './led.css';
import { setupAxis, getIpc } from '../../src/shared/axis.js';
import { MachineScene, STRIP_LENGTH } from './machine.js';

const Axis = setupAxis({ tool: 'led' });

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

const state = {
    sweeps: {
        left: createSweep(strips.left.leds.length),
        right: createSweep(strips.right.leds.length),
    },
    sent: 0, // LED commands issued
};

const els = {
    canvas: document.querySelector('.js-canvas'),
    loading: document.querySelector('.js-loading'),
    sent: document.querySelector('.js-sent'),
    sweeps: {},
};

SIDES.forEach((side) => {
    els.sweeps[side] = {
        root: document.querySelector(`.js-sweep-${side}`),
        status: document.querySelector(`.js-sweep-status-${side}`),
        color: document.querySelector(`.js-sweep-color-${side}`),
        index: document.querySelector(`.js-sweep-index-${side}`),
        passes: document.querySelector(`.js-sweep-passes-${side}`),
    };
});

// ---------------------------------------------------------------------------
// Gamepad emulation (axis-api README, "Emulate joystick inputs")
// ---------------------------------------------------------------------------

const gamepadEmulator = Axis.createGamepadEmulator(0);
Axis.joystick1.setGamepadEmulatorJoystick(gamepadEmulator, 0);
Axis.joystick2.setGamepadEmulatorJoystick(gamepadEmulator, 1);
['a', 'x', 'i', 's'].forEach((key, i) => {
    Axis.registerGamepadEmulatorKeys(gamepadEmulator, i, key, 1);
    Axis.registerGamepadEmulatorKeys(gamepadEmulator, i + 4, key, 2);
});
Axis.registerGamepadEmulatorKeys(gamepadEmulator, 14, 'w', 1); // d-pad left
Axis.registerGamepadEmulatorKeys(gamepadEmulator, 15, 'w', 2); // d-pad right

// Does nothing on the machine (no gamepad found). Scheduled first so one
// failing update (axis-api's emulator throws after a second
// gamepadconnected for the same index) doesn't stop the loop.
function updateGamepad() {
    requestAnimationFrame(updateGamepad);
    gamepadEmulator.update();
}
updateGamepad();

const machine = new MachineScene(els.canvas);

// Dev only: poke the scene from the console (window.__machine).
if (import.meta.env.DEV) window.__machine = machine;

// ---------------------------------------------------------------------------
// Render (3D strips + the small stats panel)
// ---------------------------------------------------------------------------

function renderSweep(side) {
    const sweep = state.sweeps[side];
    // The 3D strip has STRIP_LENGTH LEDs; the axis-api group may differ by a few.
    const colors = Array.from({ length: STRIP_LENGTH }, (_, i) => sweep.cells[i] || null);
    machine.setStrip(side, colors);

    const ui = els.sweeps[side];
    ui.root.classList.toggle('is-running', sweep.running);
    ui.status.textContent = sweep.running ? 'Sweeping' : `Hold W${SWEEP_BUTTONS[side].id}`;
    ui.color.textContent = SWEEP_COLORS[sweep.colorIndex].name;
    ui.color.style.color = SWEEP_COLORS[sweep.colorIndex].css;
    ui.index.textContent = `${sweep.index} / ${sweep.cells.length}`;
    ui.passes.textContent = String(sweep.passes);
}

function renderSent() {
    els.sent.textContent = String(state.sent);
}

// ---------------------------------------------------------------------------
// LED control (axis-api only)
// ---------------------------------------------------------------------------

function setButtonLed(key, id, color) {
    const button = id === 0 ? Axis.buttonManager.buttonHome : Axis.buttonManager.getButton(key, id);
    if (!button) return;
    button.setLedColor(color);
    state.sent++;
    renderSent();
}

function setStripLed(side, index, color) {
    strips[side].leds[index].setColor(color);
    state.sent++;
}

function sweepStep(side) {
    const sweep = state.sweeps[side];
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
    renderSent();
}

function startSweep(side) {
    const sweep = state.sweeps[side];
    if (sweep.running) return;
    sweep.running = true;
    machine.setFocus(side, true);
    sweepStep(side);
    sweep.timer = setInterval(() => sweepStep(side), SWEEP_STEP_MS);
    renderSweep(side);
}

function pauseSweep(side) {
    const sweep = state.sweeps[side];
    if (!sweep.running) return;
    sweep.running = false;
    machine.setFocus(side, false);
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

Axis.addEventListener('keydown', (e) => {
    machine.setButton(e.key, e.id, true);
    setButtonLed(e.key, e.id, ECHO_COLOR);

    const side = sweepSideFor(e);
    if (side) startSweep(side);
});

Axis.addEventListener('keyup', (e) => {
    machine.setButton(e.key, e.id, false);
    setButtonLed(e.key, e.id, OFF_COLOR);

    const side = sweepSideFor(e);
    if (side) pauseSweep(side);
});

// Home also opens the exit overlay (back to the tools); light it while held.
Axis.buttonManager.buttonHome.addEventListener('keydown', () => {
    machine.setHome(true);
    setButtonLed('home', 0, ECHO_COLOR);
});
Axis.buttonManager.buttonHome.addEventListener('keyup', () => {
    machine.setHome(false);
    setButtonLed('home', 0, OFF_COLOR);
});

// Either joystick orbits the camera; per axis, the one pushed furthest wins.
const sticks = { 1: { x: 0, y: 0 }, 2: { x: 0, y: 0 } };
const furthest = (axis) => (Math.abs(sticks[1][axis]) >= Math.abs(sticks[2][axis]) ? sticks[1][axis] : sticks[2][axis]);

[1, 2].forEach((id) => {
    Axis[`joystick${id}`].addEventListener('joystick:move', (e) => {
        machine.setJoystick(id, e.position.x, e.position.y);
        sticks[id] = { x: e.position.x, y: e.position.y };
        machine.setOrbit(furthest('x'), furthest('y'));
    });
});

// The launcher clears the strips when the page unloads; stop the timers so
// no command is issued after that.
window.addEventListener('beforeunload', () => {
    SIDES.forEach(pauseSweep);
    const ipc = getIpc();
    if (ipc) ipc.send('led:clear');
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

SIDES.forEach(renderSweep);
renderSent();

machine.load()
    .then(() => {
        SIDES.forEach(renderSweep);
        machine.start();
        els.loading.hidden = true;
    })
    .catch((error) => {
        console.error(error);
        els.loading.textContent = 'Could not load the 3D machine';
    });
