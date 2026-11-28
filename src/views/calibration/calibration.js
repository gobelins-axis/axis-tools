// Joystick calibration logic, framework-free apart from `reactive`.
//
// Ported line for line from the pre-Vue tools/calibration/calibration.js:
// same steps, thresholds, formulas and IPC messages. Only the DOM rendering
// moved to CalibrationView.vue (the state is reactive, so the old render()
// calls are gone).
//
// The extras compared with a game are the launcher's calibration IPC (see
// axis-launcher-electron/src/managers/CalibrationManager.js): the raw
// joystick stream in, and get / apply / save / discard out.
//
// Two views:
//   overview     both joysticks live, as games see them (stored calibration)
//   calibration  one joystick at a time: intro, center, range, right, up, test

import { reactive } from 'vue';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const JOYSTICK_IDS = [1, 2];
export const STEPS = ['intro', 'center', 'range', 'right', 'up', 'test'];

// Samples averaged for the rest position (~0.5 s at 50 msg/s).
const CENTER_SAMPLE_COUNT = 25;
// Minimum travel (raw counts) on both raw axes before the range step is accepted.
const MIN_RANGE_SPAN = 200;
// Minimum normalized deflection to accept a "push right" / "push up" sample.
const MIN_DIRECTION_DEFLECTION = 0.5;
// Dot travel inside a pad, in vh (half the pad minus the dot).
export const DOT_RADIUS = 13;

export const TEXTS = {
    intro: {
        instruction: (id) => `Calibrate joystick ${id}`,
        hint: 'Press A to start, or S to skip this joystick',
    },
    center: {
        instruction: (id) => `Let joystick ${id} rest at the centre`,
        hint: 'Do not touch it, then press A',
    },
    range: {
        instruction: (id) => `Make two or three wide circles with joystick ${id}`,
        hint: 'Then press A',
    },
    right: {
        instruction: (id) => `Push joystick ${id} fully to the right`,
        hint: 'Hold it there and press A',
    },
    up: {
        instruction: (id) => `Push joystick ${id} fully up`,
        hint: 'Hold it there and press A',
    },
    test: {
        instruction: (id) => `Try joystick ${id}`,
        hint: 'The white dot is what games will see. Press A to save, X to start over.',
    },
    done: {
        instruction: () => 'Calibration saved',
        hint: 'Press A to check both joysticks, or go back with Home',
    },
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function createEmptyDraft() {
    return {
        center: { a: 0, b: 0 },
        min: { a: 0, b: 0 },
        max: { a: 0, b: 0 },
        x: null,
        y: null,
    };
}

// Same formula as JoystickCalibration.normalizeAxis in the main process.
export function normalizeAxis(value, center, min, max) {
    let n;
    if (value < center) n = (value - center) / Math.max(1, center - min);
    else n = (value - center) / Math.max(1, max - center);
    return Math.max(-1, Math.min(1, n));
}

// Raw 0..1023 -> -1..1 with 512 at the centre, low raw y shown as up
// (same convention as the games' DIRECTION_Y).
export function rawToPad(raw) {
    return {
        x: (raw.x - 511.5) / 511.5,
        y: -(raw.y - 511.5) / 511.5,
    };
}

/** CSS transform of a dot inside a pad. */
export function dotTransform(pos) {
    return `translate(${pos.x * DOT_RADIUS}vh, ${-pos.y * DOT_RADIUS}vh)`;
}

// Reactive proxies cannot go through Electron's structured clone: every
// payload is sent as plain data.
function plain(data) {
    return data === undefined ? undefined : JSON.parse(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Calibration session
// ---------------------------------------------------------------------------

/**
 * @param {(channel: string, data: object) => void} sendIpc launcher IPC send
 *   (no-op in a browser)
 */
export function createCalibration(sendIpc) {
    const send = (channel, data) => sendIpc(channel, plain(data));

    const state = reactive({
        view: 'overview', // 'overview' | 'calibration'
        joystickIndex: 0,
        stepIndex: 0,
        isDone: false,
        message: '',
        stored: {},
        raw: { 1: { x: 0, y: 0 }, 2: { x: 0, y: 0 } },
        game: { 1: { x: 0, y: 0 }, 2: { x: 0, y: 0 } },
        hasSignal: { 1: false, 2: false },
        recentRaw: [],
        draft: createEmptyDraft(),
        preview: null,
    });

    // Joysticks whose draft is applied in the main process but not saved.
    // A page load used to drop them (launcher's did-start-loading); route
    // changes don't, so the view discards them on unmount.
    const appliedDrafts = new Set();

    function currentJoystickId() {
        return JOYSTICK_IDS[state.joystickIndex];
    }

    function currentStep() {
        return state.isDone ? 'done' : STEPS[state.stepIndex];
    }

    function calibratedLabel(id) {
        const stored = state.stored[id];
        if (stored && stored.createdAt) return `Calibrated ${new Date(stored.createdAt).toLocaleString()}`;
        return 'Never calibrated, raw values passed through';
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function showOverview() {
        state.view = 'overview';
        state.isDone = false;
        state.joystickIndex = 0;
        state.stepIndex = 0;
        state.message = '';
        state.draft = createEmptyDraft();
        state.preview = null;
        state.recentRaw = [];
    }

    function startCalibration() {
        state.view = 'calibration';
        state.isDone = false;
        state.joystickIndex = 0;
        state.stepIndex = 0;
        state.message = '';
        state.draft = createEmptyDraft();
        state.preview = null;
        state.recentRaw = [];
    }

    // -----------------------------------------------------------------------
    // Calibration steps
    // -----------------------------------------------------------------------

    function confirm() {
        state.message = '';

        switch (currentStep()) {
            case 'intro': return nextStep();
            case 'center': return confirmCenter();
            case 'range': return confirmRange();
            case 'right': return confirmDirection('x', 'right');
            case 'up': return confirmDirection('y', 'up');
            case 'test': return save();
            case 'done': return showOverview();
            default: return null;
        }
    }

    function confirmCenter() {
        if (state.recentRaw.length < 5) {
            state.message = `No signal from joystick ${currentJoystickId()} yet`;
            return;
        }

        const sum = state.recentRaw.reduce((acc, raw) => ({ x: acc.x + raw.x, y: acc.y + raw.y }), { x: 0, y: 0 });
        const center = { a: sum.x / state.recentRaw.length, b: sum.y / state.recentRaw.length };

        state.draft.center = center;
        // Range starts at the centre and expands while the user rotates the stick.
        state.draft.min = { ...center };
        state.draft.max = { ...center };

        nextStep();
    }

    function confirmRange() {
        const spanA = state.draft.max.a - state.draft.min.a;
        const spanB = state.draft.max.b - state.draft.min.b;

        if (spanA < MIN_RANGE_SPAN || spanB < MIN_RANGE_SPAN) {
            state.message = 'Not enough travel recorded. Keep the stick tilted all the way and make a few more circles, then press A';
            return;
        }

        nextStep();
    }

    function confirmDirection(target, label) {
        const raw = state.raw[currentJoystickId()];
        const { center, min, max } = state.draft;

        const deflection = {
            a: normalizeAxis(raw.x, center.a, min.a, max.a),
            b: normalizeAxis(raw.y, center.b, min.b, max.b),
        };

        const axis = Math.abs(deflection.a) >= Math.abs(deflection.b) ? 'a' : 'b';
        const value = deflection[axis];

        if (Math.abs(value) < MIN_DIRECTION_DEFLECTION) {
            state.message = `Hold the joystick fully ${label} while pressing A`;
            return;
        }

        const other = target === 'x' ? state.draft.y : state.draft.x;
        if (other && other.axis === axis) {
            state.message = `That is the same axis as before, push ${label} instead`;
            return;
        }

        state.draft[target] = { axis, sign: value > 0 ? 1 : -1 };
        nextStep();
    }

    function nextStep() {
        state.stepIndex = Math.min(state.stepIndex + 1, STEPS.length - 1);

        if (currentStep() === 'test') {
            // From here on the main process maps this joystick with the draft,
            // so Axis.joystickN reports what any game would get.
            send('calibration:apply', { id: currentJoystickId(), calibration: state.draft });
            appliedDrafts.add(currentJoystickId());
            state.preview = { x: 0, y: 0 };
        }
    }

    function restartJoystick() {
        send('calibration:discard', { id: currentJoystickId() });
        appliedDrafts.delete(currentJoystickId());
        state.stepIndex = 0;
        state.draft = createEmptyDraft();
        state.preview = null;
        state.recentRaw = [];
        state.message = 'Restarted';
    }

    function skipJoystick() {
        if (currentStep() !== 'intro') return;
        state.message = '';
        nextJoystick();
    }

    function save() {
        send('calibration:save', { id: currentJoystickId() });
        appliedDrafts.delete(currentJoystickId());
        state.stored[currentJoystickId()] = { ...plain(state.draft), createdAt: new Date().toISOString() };
        nextJoystick();
    }

    function nextJoystick() {
        state.draft = createEmptyDraft();
        state.preview = null;
        state.recentRaw = [];
        state.stepIndex = 0;

        if (state.joystickIndex >= JOYSTICK_IDS.length - 1) {
            state.isDone = true;
        } else {
            state.joystickIndex++;
        }
    }

    // Live dot from raw values. Before a centre has been captured (intro,
    // centre, done) it is the plain raw mapping; afterwards it is relative to
    // the draft centre and the travel seen so far, so the user sees the
    // calibration forming.
    function rawDotPosition() {
        const step = currentStep();
        const raw = state.raw[currentJoystickId()];
        if (!state.hasSignal[currentJoystickId()]) return null;
        if (step === 'intro' || step === 'center' || step === 'done') return rawToPad(raw);

        const { center, min, max } = state.draft;
        const spanA = Math.max(1, (max.a - min.a) / 2);
        const spanB = Math.max(1, (max.b - min.b) / 2);
        const x = Math.max(-1, Math.min(1, (raw.x - center.a) / spanA));
        const y = Math.max(-1, Math.min(1, (raw.y - center.b) / spanB));
        return { x, y: -y };
    }

    // -----------------------------------------------------------------------
    // Events (wired by the view)
    // -----------------------------------------------------------------------

    function onKeydown(e) {
        if (state.view === 'overview') {
            if (e.key === 'a') startCalibration();
            return;
        }

        if (e.key === 'a') confirm();
        if (e.key === 'x' && !state.isDone && currentStep() !== 'intro') restartJoystick();
        if (e.key === 's') skipJoystick();
    }

    // Positions through the real pipeline: stored calibration on the
    // overview, the draft applied in the main process during the test step.
    function onJoystickMove(id, e) {
        state.game[id] = { x: e.position.x, y: e.position.y };

        if (state.view === 'overview') return;

        if (id === currentJoystickId() && currentStep() === 'test') {
            state.preview = state.game[id];
        }
    }

    function onRaw(event, data) {
        const { id, position } = data;
        if (!state.raw[id]) return;

        state.raw[id] = position;
        state.hasSignal[id] = true;

        if (state.view === 'overview') return;
        if (id !== currentJoystickId()) return;

        state.recentRaw.push(position);
        if (state.recentRaw.length > CENTER_SAMPLE_COUNT) state.recentRaw.shift();

        if (currentStep() === 'range') {
            state.draft.min.a = Math.min(state.draft.min.a, position.x);
            state.draft.max.a = Math.max(state.draft.max.a, position.x);
            state.draft.min.b = Math.min(state.draft.min.b, position.y);
            state.draft.max.b = Math.max(state.draft.max.b, position.y);
        }
    }

    function setStored(data) {
        state.stored = (data && data.calibrations) || {};
    }

    /** Drops drafts applied but never saved (leaving the page mid-test). */
    function discardAppliedDrafts() {
        appliedDrafts.forEach((id) => send('calibration:discard', { id }));
        appliedDrafts.clear();
    }

    return {
        state,
        currentJoystickId,
        currentStep,
        calibratedLabel,
        rawDotPosition,
        onKeydown,
        onJoystickMove,
        onRaw,
        setStored,
        discardAppliedDrafts,
    };
}
