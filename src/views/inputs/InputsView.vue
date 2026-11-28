<script setup>
// Input debugger (formerly the standalone `debugger` project,
// gobelins-axis/joystick-debugger). Keeps its own light, dense dev-tool look
// (inputs.css, <html data-theme="dev">): it does not use the cabinet styles.
//
// Joysticks and buttons are read through axis-api like a game; on the machine
// the raw joystick stream comes straight from the launcher (joystick:move
// IPC). Canvas drawing lives in draw.js, run by one frame loop.

import { computed, markRaw, reactive, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import './inputs.css';
import JoystickCard from './JoystickCard.vue';
import AlternativeCard from './AlternativeCard.vue';
import { Axis, isMachine } from '../../axis/axis.js';
import { useAxisEvents } from '../../axis/useAxisEvents.js';
import { useIpc } from '../../axis/useIpc.js';
import { CALIBRATION, CHART_SAMPLES, drawJoystick, drawChart, drawField, rangeText } from './draw.js';

const SERIAL_STALL_MS = 1000;
const NUMERIC = /^-?\d+(\.\d+)?$/;

const { on } = useAxisEvents();
const { ready, listen } = useIpc();

/* ------------------------------------------------------------------ */
/* Utils                                                              */
/* ------------------------------------------------------------------ */

const logLines = ref([]);
const logText = computed(() => logLines.value.join('\n'));

function log(message) {
    const d = new Date();
    const t = `${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    logLines.value.unshift(`${t}  ${message}`);
    if (logLines.value.length > 200) logLines.value.pop();
}

function clearLog() {
    logLines.value = [];
}

function pad(n) {
    return String(n).padStart(2, '0');
}

function fmt(n, digits = 3) {
    return (n === undefined || n === null || Number.isNaN(n)) ? '–' : n.toFixed(digits);
}

const pills = reactive({
    source: { text: 'Source: browser', state: null },
    ipc: { text: 'ipcRenderer: no', state: null },
    gamepads: { text: 'Gamepads: 0', state: null },
    serial: { text: 'Serial: none', state: null },
    sleep: { text: 'Awake', state: null },
});

function setPill(name, text, state) {
    pills[name] = { text, state: state || null };
}

/* ------------------------------------------------------------------ */
/* Settings (written to axis-api, restored when leaving)              */
/* ------------------------------------------------------------------ */

const settings = reactive({ deadzone: 0.2, threshold: 0.1, trail: 60 });

// Other tools share the same axis-api instance now: keep its config as it was.
const initialConfig = {
    deadzone: [Axis.joystick1.deadzone, Axis.joystick2.deadzone],
    threshold: [Axis.joystick1.threshold, Axis.joystick2.threshold],
};

watch(() => settings.deadzone, (v) => { Axis.joystick1.deadzone = v; Axis.joystick2.deadzone = v; }, { immediate: true });
watch(() => settings.threshold, (v) => { Axis.joystick1.threshold = v; Axis.joystick2.threshold = v; }, { immediate: true });

function formatSetting(v) {
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/* ------------------------------------------------------------------ */
/* Joysticks                                                          */
/* ------------------------------------------------------------------ */

function createJoystickModel(joystick) {
    return markRaw({
        joystick,
        id: joystick.id,
        canvas: null,
        chart: null,
        normalized: { x: 0, y: 0, magnitude: 0 },
        raw: null,
        rest: null,
        range: null,
        trail: [],
        samples: [],
        quickmoveTimers: {},
        eventCount: 0,
        rate: 0,
        lastRateTime: performance.now(),
        readout: reactive({
            nx: '0.000', ny: '0.000', nmag: '0.000', nangle: '0°',
            rx: '–', ry: '–', rest: '–', rminmaxx: '–', rminmaxy: '–',
            rate: '0 Hz',
            qm: { left: 0, right: 0, up: 0, down: 0 },
            qmActive: { left: false, right: false, up: false, down: false },
        }),
    });
}

const joysticks = [createJoystickModel(Axis.joystick1), createJoystickModel(Axis.joystick2)];

function onMove(view, e) {
    view.normalized = {
        x: e.position.x,
        y: e.position.y,
        magnitude: e.position.magnitude !== undefined
            ? e.position.magnitude
            : Math.sqrt(e.position.x * e.position.x + e.position.y * e.position.y),
    };
    view.eventCount++;

    view.trail.push({ x: e.position.x, y: e.position.y });
    while (view.trail.length > settings.trail) view.trail.shift();

    view.samples.push({
        nx: e.position.x,
        ny: e.position.y,
        rx: view.raw ? view.raw.x : null,
        ry: view.raw ? view.raw.y : null,
    });
    while (view.samples.length > CHART_SAMPLES) view.samples.shift();
}

function onRaw(view, position) {
    view.raw = { x: position.x, y: position.y };

    if (!view.rest) view.rest = { ...view.raw };

    if (!view.range) {
        view.range = { minX: position.x, maxX: position.x, minY: position.y, maxY: position.y };
    } else {
        view.range.minX = Math.min(view.range.minX, position.x);
        view.range.maxX = Math.max(view.range.maxX, position.x);
        view.range.minY = Math.min(view.range.minY, position.y);
        view.range.maxY = Math.max(view.range.maxY, position.y);
    }

    // The API dispatches the normalized event before we get the raw one,
    // so attach the raw value to the sample that was just recorded.
    const last = view.samples[view.samples.length - 1];
    if (last && last.rx === null) {
        last.rx = position.x;
        last.ry = position.y;
    }
}

function onQuickmove(view, e) {
    view.readout.qm[e.direction]++;
    view.readout.qmActive[e.direction] = true;
    clearTimeout(view.quickmoveTimers[e.direction]);
    view.quickmoveTimers[e.direction] = setTimeout(() => { view.readout.qmActive[e.direction] = false; }, 150);
    log(`joystick ${view.id} quickmove ${e.direction}`);
}

function updateReadouts(view) {
    const n = view.normalized;
    const r = view.readout;
    r.nx = fmt(n.x);
    r.ny = fmt(n.y);
    r.nmag = fmt(n.magnitude);
    r.nangle = n.magnitude > 0
        ? `${Math.round((Math.atan2(n.y, n.x) * 180) / Math.PI)}°`
        : '–';

    if (view.raw) {
        r.rx = view.raw.x;
        r.ry = view.raw.y;
        r.rest = view.rest ? `${view.rest.x} / ${view.rest.y}` : '–';
        if (view.range) {
            r.rminmaxx = rangeText(view.range.minX, view.range.maxX, CALIBRATION.x);
            r.rminmaxy = rangeText(view.range.minY, view.range.maxY, CALIBRATION.y);
        }
    }

    r.rate = `${view.rate} Hz`;
}

joysticks.forEach((view) => {
    on(view.joystick, 'joystick:move', (e) => onMove(view, e));
    on(view.joystick, 'joystick:quickmove', (e) => onQuickmove(view, e));
});

/* ------------------------------------------------------------------ */
/* Buttons                                                            */
/* ------------------------------------------------------------------ */

const BUTTON_GROUPS = [
    { id: 1, title: 'Group 1', keys: ['a', 'x', 'i', 's', 'w'] },
    { id: 2, title: 'Group 2', keys: ['a', 'x', 'i', 's', 'w'] },
    { id: 0, title: 'Home', keys: ['home'] },
];

const buttons = reactive(Object.fromEntries(
    BUTTON_GROUPS.flatMap((group) => group.keys.map((key) => [`${key}-${group.id}`, { down: false, count: 0 }])),
));

function buttonDown(key, id) {
    const button = buttons[`${key}-${id}`];
    if (!button) return;
    button.down = true;
    button.count++;
    log(`keydown  ${key.toUpperCase()} (group ${id})`);
}

function buttonUp(key, id) {
    const button = buttons[`${key}-${id}`];
    if (!button) return;
    button.down = false;
    log(`keyup    ${key.toUpperCase()} (group ${id})`);
}

on(Axis, 'keydown', (e) => buttonDown(e.key, e.id));
on(Axis, 'keyup', (e) => buttonUp(e.key, e.id));
on(Axis.buttonManager.buttonHome, 'keydown', () => buttonDown('home', 0));
on(Axis.buttonManager.buttonHome, 'keyup', () => buttonUp('home', 0));

on(Axis, 'sleep', () => { setPill('sleep', 'Sleep', 'warn'); log('machine: sleep'); });
on(Axis, 'awake', () => { setPill('sleep', 'Awake', 'ok'); log('machine: awake'); });
on(Axis, 'exit:attempted', () => log('exit attempted'));
on(Axis, 'exit:canceled', () => log('exit canceled'));
on(Axis, 'exit:completed', () => log('exit completed'));

on(window, 'gamepadconnected', (e) => log(`gamepad ${e.gamepad.index} connected: ${e.gamepad.id}`));
on(window, 'gamepaddisconnected', (e) => log(`gamepad ${e.gamepad.index} disconnected`));

/* ------------------------------------------------------------------ */
/* Machine (ipcRenderer) raw data                                     */
/* ------------------------------------------------------------------ */

let lastSerialTime = 0;
let serialState = 'none';
let hasIpc = false;

ready(() => {
    hasIpc = true;
    setPill('ipc', 'ipcRenderer: yes', 'ok');
    setPill('source', 'Source: machine', 'ok');
    log('ipcRenderer attached, listening to raw joystick:move');
});

listen('joystick:move', (_event, data) => {
    const view = joysticks[data.id - 1];
    if (view) onRaw(view, data.position);
    lastSerialTime = performance.now();
});

const noIpcTimeout = setTimeout(() => {
    if (!hasIpc) log('no ipcRenderer after 3s: running in browser emulation mode (keyboard + gamepad)');
}, 3000);

function updateSerialPill(now) {
    let next;
    if (lastSerialTime === 0) next = 'none';
    else if (now - lastSerialTime > SERIAL_STALL_MS) next = 'stalled';
    else next = 'ok';

    if (next === serialState) return;
    serialState = next;
    if (next === 'ok') { setPill('serial', 'Serial: receiving', 'ok'); log('serial: receiving joystick data'); }
    if (next === 'stalled') { setPill('serial', 'Serial: stalled', 'warn'); log('serial: no joystick data for 1s (firmware keepalive is 50ms)'); }
}

/* ------------------------------------------------------------------ */
/* Alternative controllers                                            */
/* ------------------------------------------------------------------ */

// Extra USB boards plugged into the machine (see axis-api
// AlternativeControllerManager). Read through the API, exactly like a game.
// Fields are free-form strings: numeric ones get a chart, others a badge.

const altManager = Axis.alternativeControllerManager;
const alts = ref([]); // reactive alt models, in connection order
const altByName = new Map();
const altCount = ref('0 connected');

function getAlt(controller) {
    let alt = altByName.get(controller.name);
    if (alt) return alt;

    alt = reactive({
        name: controller.name,
        controller: markRaw(controller),
        meta: '',
        disconnected: false,
        rateText: '0 Hz',
        badges: [],
        numbers: [],
        fields: markRaw(new Map()), // label -> field
        eventCount: 0,
        lastRateTime: performance.now(),
    });
    altByName.set(controller.name, alt);
    alts.value.push(alt);
    updateAltSummary();
    return alt;
}

// `key` names the input (key:joystick__x:..__y:..), so fields are labelled
// joystick.x, joystick.y. Messages without a key use the bare field name.
function fieldLabel(data, field) {
    return data.key !== undefined ? `${data.key}.${field}` : field;
}

function getNumericField(alt, label) {
    let field = alt.fields.get(label);
    if (field) return field;

    field = reactive({
        kind: 'number',
        label,
        value: '',
        rangeText: '',
        canvas: null,
        samples: markRaw([]), // { t, v }
        min: Infinity,
        max: -Infinity,
    });
    alt.fields.set(label, field);
    alt.numbers.push(field);
    return field;
}

function getTextField(alt, label) {
    let field = alt.fields.get(label);
    if (field) return field;

    field = reactive({ kind: 'text', label, value: '', flash: false, timer: null });
    alt.fields.set(label, field);
    alt.badges.push(field);
    return field;
}

function onAltMessage({ data }, controller) {
    const alt = getAlt(controller);
    const now = performance.now();
    alt.eventCount++;

    for (const [name, value] of Object.entries(data)) {
        // `key` is the input's name, already part of every label.
        if (name === 'key') continue;
        const label = fieldLabel(data, name);
        const existing = alt.fields.get(label);

        // A field keeps the kind it was first seen with.
        if ((existing ? existing.kind === 'number' : NUMERIC.test(value))) {
            const field = getNumericField(alt, label);
            const v = parseFloat(value);
            if (Number.isNaN(v)) continue;
            field.samples.push({ t: now, v });
            field.min = Math.min(field.min, v);
            field.max = Math.max(field.max, v);
            field.value = value;
        } else {
            const field = getTextField(alt, label);
            field.value = value;
            field.flash = true;
            clearTimeout(field.timer);
            field.timer = setTimeout(() => { field.flash = false; }, 150);
        }
    }
}

function updateAltSummary() {
    altCount.value = `${altManager.connectedControllers.length} connected`;

    for (const alt of alts.value) {
        const { controller } = alt;
        alt.meta = controller.isConnected ? `slot ${controller.slot}` : 'disconnected';
        alt.disconnected = !controller.isConnected;
    }
}

function updateAlternatives(now) {
    for (const alt of alts.value) {
        if (now - alt.lastRateTime >= 500) {
            const hz = Math.round(alt.eventCount / ((now - alt.lastRateTime) / 1000));
            alt.eventCount = 0;
            alt.lastRateTime = now;
            alt.rateText = `${hz} Hz`;
        }
        for (const field of alt.numbers) {
            if (field.canvas) drawField(field, now);
        }
    }
}

if (altManager) {
    on(altManager, 'alternative:connected', (e) => {
        const alt = getAlt(altManager.getController(e.name));
        // A new connection starts a new range.
        for (const field of alt.numbers) {
            field.min = Infinity;
            field.max = -Infinity;
            field.samples = markRaw([]);
            field.value = '–';
            field.rangeText = '';
            if (field.canvas) field.canvas.getContext('2d').clearRect(0, 0, field.canvas.width, field.canvas.height);
        }
        updateAltSummary();
        log(`alternative: ${e.name} connected (slot ${e.slot})`);
    });
    on(altManager, 'alternative:disconnected', (e) => {
        updateAltSummary();
        log(`alternative: ${e.name} disconnected`);
    });
    on(altManager, 'alternative:message', (e) => onAltMessage(e, altManager.getController(e.name)));
}

/* ------------------------------------------------------------------ */
/* Main loop                                                          */
/* ------------------------------------------------------------------ */

let frame = null;

function update() {
    const now = performance.now();

    const gamepads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    const gamepadText = `Gamepads: ${gamepads.length}`;
    if (pills.gamepads.text !== gamepadText) setPill('gamepads', gamepadText, gamepads.length ? 'ok' : null);

    updateSerialPill(now);

    for (const view of joysticks) {
        if (now - view.lastRateTime >= 500) {
            view.rate = Math.round(view.eventCount / ((now - view.lastRateTime) / 1000));
            view.eventCount = 0;
            view.lastRateTime = now;
        }
        if (view.canvas) drawJoystick(view);
        if (view.chart) drawChart(view);
        updateReadouts(view);
    }

    if (altManager) updateAlternatives(now);

    frame = requestAnimationFrame(update);
}

onMounted(() => {
    if (isMachine()) setPill('source', 'Source: machine', 'ok');
    log('debugger ready');
    update();
});

onBeforeUnmount(() => {
    cancelAnimationFrame(frame);
    clearTimeout(noIpcTimeout);
    joysticks.forEach((view) => Object.values(view.quickmoveTimers).forEach(clearTimeout));
    for (const alt of alts.value) alt.badges.forEach((field) => clearTimeout(field.timer));

    Axis.joystick1.deadzone = initialConfig.deadzone[0];
    Axis.joystick2.deadzone = initialConfig.deadzone[1];
    Axis.joystick1.threshold = initialConfig.threshold[0];
    Axis.joystick2.threshold = initialConfig.threshold[1];
});
</script>

<template>
    <div class="debugger">
        <header class="header">
            <h1><RouterLink class="back" :to="{ name: 'hub', query: { from: 'inputs' } }">← Tools</RouterLink> Input debugger <span class="back-hint">Home / Escape to go back</span></h1>
            <div class="pills">
                <span v-for="(pill, name) in pills" :key="name" class="pill" :class="pill.state">{{ pill.text }}</span>
            </div>
        </header>

        <div class="layout">
            <main class="grid">
                <div class="joysticks">
                    <JoystickCard v-for="model in joysticks" :key="model.id" :model="model" />
                </div>

                <section class="card">
                    <h2>Buttons</h2>
                    <div class="button-groups">
                        <div v-for="group in BUTTON_GROUPS" :key="group.id" class="button-group">
                            <h3>{{ group.title }}</h3>
                            <div class="buttons">
                                <div v-for="key in group.keys" :key="key" class="btn" :class="{ down: buttons[`${key}-${group.id}`].down }">
                                    <span class="key">{{ key.toUpperCase() }}</span>
                                    <span class="count">{{ buttons[`${key}-${group.id}`].count }}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <p class="hint">Keyboard emulation: group 1 = Q D Z S Space · group 2 = ← → ↑ ↓ Enter. Gamepad buttons 0–3 = A X I S (group 1), 4–7 = A X I S (group 2).</p>
                </section>

                <section class="card">
                    <h2>Settings (live)</h2>
                    <label>Deadzone <input v-model.number="settings.deadzone" type="range" min="0" max="0.6" step="0.01"> <span>{{ formatSetting(settings.deadzone) }}</span></label>
                    <label>Quickmove threshold <input v-model.number="settings.threshold" type="range" min="0" max="0.5" step="0.01"> <span>{{ formatSetting(settings.threshold) }}</span></label>
                    <label>Trail length <input v-model.number="settings.trail" type="range" min="0" max="200" step="10"> <span>{{ formatSetting(settings.trail) }}</span></label>
                    <p class="hint">Deadzone and threshold are written to Axis.joystick1 / joystick2 so you can tune the API config.</p>
                </section>

                <section class="card log-card">
                    <h2>Event log <button @click="clearLog">Clear</button></h2>
                    <pre class="log">{{ logText }}</pre>
                </section>
            </main>

            <aside class="card alternatives-card">
                <h2>Alternative controllers <span class="rate">{{ altCount }}</span></h2>
                <div v-if="alts.length" class="alternatives">
                    <AlternativeCard v-for="alt in alts" :key="alt.name" :alt="alt" />
                </div>
                <p v-else class="hint">{{ altManager ? "No alternative controller yet. Plug a board that answers the launcher's handshake (see arduino/scripts/AlternativeController). Only works on the machine." : 'This axis-api build has no alternative controller support.' }}</p>
                <p class="hint">One chart per numeric field: the dot is the current value, the left half the last ~5s, scaled to the values seen since connection. Text fields are badges.</p>
            </aside>
        </div>
    </div>
</template>
