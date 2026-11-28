<script setup>
// Hub: the tool picker, first page of the site.
//
// Joystick up/down (either one) or the keyboard arrows move the selection,
// A (or Enter / the A key on a keyboard) opens the tool, Home quits to the
// launcher menu like any game. Coming back from a tool (?from=<id>)
// reselects it.

import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import InputIndicators from '../components/InputIndicators.vue';
import { Axis } from '../axis/axis.js';
import { useAxisEvents } from '../axis/useAxisEvents.js';
import { useExitOverlay } from '../axis/useExitOverlay.js';
import { TOOLS } from '../tools.js';

const route = useRoute();
const router = useRouter();
const { on } = useAxisEvents();
const exitOverlay = useExitOverlay();

const index = ref(Math.max(0, TOOLS.findIndex((tool) => tool.id === route.query.from)));
const openingIndex = ref(-1);

const inputs = [
    { key: 'a', label: 'Open' },
    { key: 'home', label: 'Exit' },
];

function select(next) {
    if (openingIndex.value !== -1) return;
    index.value = (next + TOOLS.length) % TOOLS.length;
}

function open(next = index.value) {
    // Home's exit overlay takes the buttons while it is shown.
    if (openingIndex.value !== -1 || exitOverlay.isOpen()) return;
    index.value = next;
    openingIndex.value = next;
    router.push({ name: TOOLS[next].id });
}

on(Axis, 'keydown', (e) => {
    if (e.key === 'a' || e.key === 'w') open();
});

// Laptop keyboard: arrows move, Enter or the A key open the selected tool
// (the axis mapping puts button A on Q / ←, which nobody guesses).
on(window, 'keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowUp') select(index.value - 1);
    if (e.key === 'ArrowDown') select(index.value + 1);
    if (e.repeat) return;
    if (e.key === 'Enter' || e.key === 'a' || e.key === 'A') open();
});

[Axis.joystick1, Axis.joystick2].forEach((joystick) => {
    on(joystick, 'joystick:quickmove', (e) => {
        if (e.direction === 'up') select(index.value - 1);
        if (e.direction === 'down') select(index.value + 1);
    });
});
</script>

<template>
    <div class="layout">
        <AppHeader />

        <main class="view view--hub">
            <div class="heading">
                <h1 class="title">Debug Tools</h1>
                <p class="description">Calibration and debugging for the machine.</p>
            </div>

            <ol class="tools">
                <li
                    v-for="(tool, i) in TOOLS"
                    :key="tool.id"
                    class="tool"
                    :class="{ 'is-selected': i === index, 'is-opening': i === openingIndex }"
                    @mouseenter="select(i)"
                    @click="open(i)"
                >
                    <h2 class="tool-name">{{ tool.name }}</h2>
                    <p class="tool-description">{{ tool.description }}</p>
                </li>
            </ol>
        </main>

        <InputIndicators :inputs="inputs" />
    </div>
</template>

<style scoped>
/* One centred column (title, description, tool list), vertically centred
   under the header. The selected tool sits on the cabinet's tag shape
   (square bottom-left, like the menu's GameTag); the others recede. */

.view--hub {
    align-content: center;
    justify-items: center;
    grid-template-rows: auto auto;
    gap: 3.2rem;
    padding-bottom: 3rem; /* optical centre, above the inputs row */
    text-align: center;
}

.view--hub .heading { margin-top: 0; }
.view--hub .description { max-width: 48rem; margin-left: auto; margin-right: auto; text-wrap: balance; }

.tools {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    width: 58rem;
}

.tool {
    padding: 1.1rem 2.4rem 1.3rem;
    border-radius: 1.4rem 1.4rem 1.4rem 0;
    color: var(--grey);
    transition: background-color 0.4s var(--expo-out), color 0.4s var(--expo-out);
}

.tool-name {
    font-weight: 800;
    font-size: 2.4rem;
    line-height: 1;
}

.tool-description {
    margin-top: 0.5rem;
    font-weight: 700;
    font-size: 1.15rem;
    line-height: 1.5rem;
    text-wrap: balance;
    color: var(--grey);
    opacity: 0.7;
    transition: color 0.4s var(--expo-out), opacity 0.4s var(--expo-out);
}

.tool.is-selected {
    color: var(--white);
    background-color: var(--black-1);
}

.tool.is-selected .tool-description {
    color: var(--light-grey);
    opacity: 1;
}

.tool.is-opening { background-color: var(--black-2); }

:global(html:not(.is-axis-machine)) .tool { cursor: pointer; }
</style>
