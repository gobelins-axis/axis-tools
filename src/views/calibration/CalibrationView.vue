<script setup>
// Joystick calibration tool. Behaves like a game: buttons and the Home flow
// come from axis-api. The logic lives in calibration.js; this component
// wires the events and renders the two views. In a browser there is no IPC:
// the page renders but nothing can be calibrated.

import { computed, onBeforeUnmount } from 'vue';
import AppHeader from '../../components/AppHeader.vue';
import InputIndicators from '../../components/InputIndicators.vue';
import { Axis } from '../../axis/axis.js';
import { useAxisEvents } from '../../axis/useAxisEvents.js';
import { useIpc } from '../../axis/useIpc.js';
import { useExitOverlay } from '../../axis/useExitOverlay.js';
import { JOYSTICK_IDS, STEPS, TEXTS, createCalibration, rawToPad, dotTransform } from './calibration.js';

const { on } = useAxisEvents();
const { ready, listen, send } = useIpc();
const exitOverlay = useExitOverlay();

const calibration = createCalibration(send);
const { state, currentJoystickId, currentStep, calibratedLabel, rawDotPosition } = calibration;

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

const overview = computed(() => JOYSTICK_IDS.map((id) => {
    const game = state.game[id];
    const raw = state.raw[id];
    const hasSignal = state.hasSignal[id];
    return {
        id,
        hasSignal,
        gameTransform: dotTransform(game),
        rawTransform: hasSignal ? dotTransform(rawToPad(raw)) : null,
        gameX: game.x.toFixed(2),
        gameY: game.y.toFixed(2),
        rawX: hasSignal ? raw.x : '–',
        rawY: hasSignal ? raw.y : '–',
        calibrated: hasSignal ? calibratedLabel(id) : 'No signal from the board',
        isMissing: hasSignal && !state.stored[id],
    };
}));

// ---------------------------------------------------------------------------
// Calibration flow
// ---------------------------------------------------------------------------

const VISIBLE_STEPS = STEPS.length - 1; // intro has no dot

const flow = computed(() => {
    const step = currentStep();
    const id = currentJoystickId();
    const texts = TEXTS[step];
    const raw = state.raw[id];
    const hasSignal = state.hasSignal[id];

    const isPreview = step === 'test' && Boolean(state.preview);
    const pos = isPreview ? state.preview : rawDotPosition();

    return {
        status: state.isDone ? '' : `Joystick ${id}: ${calibratedLabel(id)}`,
        instruction: texts.instruction(id),
        hint: texts.hint,
        message: state.message,
        stepIndex: state.isDone ? VISIBLE_STEPS : state.stepIndex - 1,
        rawX: hasSignal ? raw.x : '–',
        rawY: hasSignal ? raw.y : '–',
        isPreview,
        dotTransform: pos ? dotTransform(pos) : null,
        // Grey raw dot at every step, so the board signal is always visible
        // even when the white dot is relative to the calibration being built.
        rawTransform: hasSignal ? dotTransform(rawToPad(raw)) : null,
        previewX: isPreview ? state.preview.x.toFixed(2) : '',
        previewY: isPreview ? state.preview.y.toFixed(2) : '',
    };
});

// ---------------------------------------------------------------------------
// Input indicators (same pattern as axis-launcher-front's Inputs component)
// ---------------------------------------------------------------------------

const inputs = computed(() => {
    const exit = { key: 'home', label: 'Tools' };
    if (state.view === 'overview') return [{ key: 'a', label: 'Calibrate' }, exit];

    switch (currentStep()) {
        case 'intro': return [{ key: 'a', label: 'Start' }, { key: 's', label: 'Skip this joystick' }, exit];
        case 'test': return [{ key: 'a', label: 'Save' }, { key: 'x', label: 'Restart' }, exit];
        case 'done': return [{ key: 'a', label: 'Check joysticks' }, exit];
        default: return [{ key: 'a', label: 'Confirm' }, { key: 'x', label: 'Restart' }, exit];
    }
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

// Home in a tool goes straight to the hub (src/axis/axis.js), so the exit
// overlay normally never shows here. If it ever does (axis-api internals
// changed, see routeHome), A / X are its Yes / Back: without this guard
// quitting with Home + A would save the preview and cancelling with X would
// restart the joystick.
on(Axis, 'keydown', (e) => {
    if (exitOverlay.isOpen()) return;
    calibration.onKeydown(e);
});

JOYSTICK_IDS.forEach((id) => {
    on(Axis[`joystick${id}`], 'joystick:move', (e) => calibration.onJoystickMove(id, e));
});

listen('joystick:raw', calibration.onRaw);

ready((ipc) => {
    ipc.invoke('calibration:get')
        .then(calibration.setStored)
        .catch(() => {});
});

// Leaving mid-test (Home -> back to the hub, or the launcher reloading the
// window) must not keep an unsaved preview applied to the joystick.
on(window, 'beforeunload', calibration.discardAppliedDrafts);
onBeforeUnmount(calibration.discardAppliedDrafts);
</script>

<template>
    <div class="layout">
        <AppHeader />

        <!-- Overview: live positions of both joysticks as games see them -->
        <main v-if="state.view === 'overview'" class="view">
            <div class="heading heading--center">
                <h1 class="title">Joystick check</h1>
                <p class="description">Move both joysticks. The white dot is what games see, the grey one is the raw board value. If both feel right, go back with Home.</p>
                <p class="cta">Press <img class="input-icon" src="/icons/input-a.svg" alt="A"> to start calibration</p>
            </div>

            <div class="pads">
                <section v-for="joystick in overview" :key="joystick.id" class="joystick">
                    <h2 class="joystick-name">Joystick {{ joystick.id }}</h2>
                    <div class="pad">
                        <div class="pad-deadzone"></div>
                        <div class="dot dot--raw" :class="{ 'is-hidden': !joystick.hasSignal }" :style="{ transform: joystick.rawTransform }"></div>
                        <div class="dot dot--game" :style="{ transform: joystick.gameTransform }"></div>
                    </div>
                    <div class="values">
                        <div class="value"><span class="value-label">Game</span><span class="value-number">{{ joystick.gameX }}</span><span class="value-number">{{ joystick.gameY }}</span></div>
                        <div class="value"><span class="value-label">Raw</span><span class="value-number">{{ joystick.rawX }}</span><span class="value-number">{{ joystick.rawY }}</span></div>
                    </div>
                    <div class="tag tag--status" :class="{ 'is-missing': joystick.isMissing, 'no-signal': !joystick.hasSignal }">{{ joystick.calibrated }}</div>
                </section>
            </div>
        </main>

        <!-- Calibration flow: one joystick at a time -->
        <main v-else class="view">
            <div class="heading">
                <div class="steps">
                    <span v-for="i in VISIBLE_STEPS" :key="i" :class="{ 'is-done': i - 1 < flow.stepIndex, 'is-current': i - 1 === flow.stepIndex }"></span>
                </div>
                <h1 class="title">{{ flow.instruction }}</h1>
                <p class="description">{{ flow.hint }}</p>
                <p class="message">{{ flow.message }}</p>
            </div>

            <div class="pads">
                <section class="joystick">
                    <div class="pad">
                        <div class="pad-deadzone"></div>
                        <div class="dot dot--raw" :class="{ 'is-hidden': !flow.rawTransform }" :style="{ transform: flow.rawTransform }"></div>
                        <div class="dot dot--live" :class="{ 'is-preview': flow.isPreview, 'is-hidden': !flow.dotTransform }" :style="{ transform: flow.dotTransform }"></div>
                    </div>
                    <div class="values">
                        <div class="value"><span class="value-label">Raw</span><span class="value-number">{{ flow.rawX }}</span><span class="value-number">{{ flow.rawY }}</span></div>
                        <div v-if="flow.isPreview" class="value"><span class="value-label">Game</span><span class="value-number">{{ flow.previewX }}</span><span class="value-number">{{ flow.previewY }}</span></div>
                    </div>
                    <div class="status">{{ flow.status }}</div>
                </section>
            </div>
        </main>

        <InputIndicators :inputs="inputs" />
    </div>
</template>

<style scoped>
.tag--status { min-height: 1.37rem; }
.tag--status:empty { visibility: hidden; }
.tag--status.is-missing { background-color: var(--yellow); }
.tag--status.no-signal { color: var(--white); background-color: var(--red); }

/* Tighter than the base view, narrower description */
.view { gap: 1.2rem; }
.description { max-width: 34rem; }

.heading--center {
    max-width: none;
    justify-self: center;
    text-align: center;
}

.heading--center .description {
    margin-left: auto;
    margin-right: auto;
}

/* Call to action: the button glyph sits inline in the sentence */
.cta {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;           /* a word space around the glyph */
    margin-top: 1.6rem;
    font-weight: 700;
    font-size: 1.25rem;    /* 32px */
    line-height: 1.68rem;  /* 43px */
}

/* Inline in a sentence the glyph matches the cap height rather than the indicator size */
.cta .input-icon {
    height: 1.15em;        /* ~37px at 32px text */
}

.message {
    margin-top: 0.6rem;
    min-height: 1.9rem;
    font-weight: 700;
    font-size: 1.25rem;
    line-height: 1.5;
    color: var(--yellow);
}

/* Step bars */
.steps {
    display: flex;
    gap: 0.4rem;
    margin-bottom: 1.4rem;
    min-height: 0.2rem;
}

.steps span {
    width: 2.2rem;
    height: 0.2rem;
    background: var(--black-2);
    transition: background 0.3s var(--expo-out);
}

.steps span.is-done { background: var(--grey); }
.steps span.is-current { background: var(--white); }

/* Pads */
.pads {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 7rem;
    min-height: 0;
    padding-top: 1.2rem;
}

.joystick {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.2rem;
}

.joystick-name {
    font-weight: 800;
    font-size: 1.75rem;
    line-height: 1;
}

.pad {
    position: relative;
    /* Sized by width like the front, capped by height so short windows never overlap the heading */
    /* In vh only: the dot travel (DOT_RADIUS in calibration.js) is half of it */
    width: 26vh;
    height: 26vh;
    background: var(--black-1);
    border-radius: 50%;
}

.pad::before,
.pad::after {
    content: "";
    position: absolute;
    background: var(--black-2);
}

.pad::before { left: 50%; top: 0; width: 1px; height: 100%; }
.pad::after { top: 50%; left: 0; height: 1px; width: 100%; }

/* Deadzone ring (axis-api default 0.2) */
.pad-deadzone {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 20%;
    height: 20%;
    margin: -10% 0 0 -10%;
    border: 1px dashed var(--grey);
    border-radius: 50%;
    opacity: 0.6;
}

.dot {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 1;
    border-radius: 50%;
    transform: translate(0, 0);
}

.dot.is-hidden { opacity: 0; }

/* What games see */
.dot--game {
    width: 1.5rem;
    height: 1.5rem;
    margin: -0.75rem 0 0 -0.75rem;
    background: var(--white);
}

/* Raw board value */
.dot--raw {
    width: 1.1rem;
    height: 1.1rem;
    margin: -0.55rem 0 0 -0.55rem;
    background: var(--light-grey);
    opacity: 0.35;
}

/* Calibration-view white dot (relative raw during the guided steps) */
.dot--live {
    width: 1.5rem;
    height: 1.5rem;
    margin: -0.75rem 0 0 -0.75rem;
    background: var(--white);
}

.dot--live.is-preview { background: var(--white); }

/* Numbers */
.values {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-weight: 600;
    font-size: 1.1rem;
    line-height: 1.3;
    color: var(--light-grey);
    font-variant-numeric: tabular-nums;
}

.value {
    display: grid;
    grid-template-columns: 2.6rem 3.2rem 3.2rem;
    text-align: right;
}

.value-label {
    text-align: left;
    color: var(--grey);
}

.status {
    font-weight: 600;
    font-size: 1rem;
    color: var(--grey);
    min-height: 1.3rem;
}
</style>
