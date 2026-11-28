// Hub: the tool picker, first page of the site.
//
// Joystick up/down (either one) or the keyboard arrows move the selection,
// A (or Enter / the A key on a keyboard) opens the tool, Home quits to the
// launcher menu like any game. Coming back from a tool (?from=<id>)
// reselects it.

import '../shared/base.css';
import './hub.css';
import { setupAxis, onIpc } from '../shared/axis.js';
import { createInputs } from '../shared/inputs.js';
import { TOOLS, toolUrl } from '../tools.js';

const Axis = setupAxis();

const els = {
    tools: document.querySelector('.js-tools'),
};

const setInputs = createInputs(document.querySelector('.js-inputs'));

const from = new URLSearchParams(window.location.search).get('from');
const state = {
    index: Math.max(0, TOOLS.findIndex((tool) => tool.id === from)),
    isOpening: false,
    isExitOverlayOpen: false,
};

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function build() {
    TOOLS.forEach((tool, index) => {
        const item = document.createElement('li');
        item.className = 'tool';
        item.innerHTML = `
            <h2 class="tool-name">${tool.name}</h2>
            <p class="tool-description">${tool.description}</p>
        `;

        // Mouse, for laptops.
        item.addEventListener('mouseenter', () => select(index));
        item.addEventListener('click', () => open(index));

        els.tools.appendChild(item);
    });
}

function render() {
    Array.from(els.tools.children).forEach((item, index) => {
        item.classList.toggle('is-selected', index === state.index);
    });

    setInputs([
        { key: 'a', label: 'Open' },
        { key: 'home', label: 'Exit' },
    ]);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function select(index) {
    if (state.isOpening) return;
    state.index = (index + TOOLS.length) % TOOLS.length;
    render();
}

function open(index = state.index) {
    if (state.isOpening || state.isExitOverlayOpen) return;
    state.isOpening = true;
    state.index = index;
    els.tools.children[index].classList.add('is-opening');
    window.location.href = toolUrl(TOOLS[index].id);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

Axis.addEventListener('keydown', (e) => {
    if (e.key === 'a' || e.key === 'w') open();
});

// Laptop keyboard: arrows move, Enter or the A key open the selected tool
// (the axis mapping puts button A on Q / ←, which nobody guesses).
window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowUp') select(state.index - 1);
    if (e.key === 'ArrowDown') select(state.index + 1);
    if (e.repeat) return;
    if (e.key === 'Enter' || e.key === 'a' || e.key === 'A') open();
});

[Axis.joystick1, Axis.joystick2].forEach((joystick) => {
    joystick.addEventListener('joystick:quickmove', (e) => {
        if (e.direction === 'up') select(state.index - 1);
        if (e.direction === 'down') select(state.index + 1);
    });
});

// Home's exit overlay takes the buttons while it is shown.
Axis.addEventListener('exit:attempted', () => { state.isExitOverlayOpen = true; });
Axis.addEventListener('exit:canceled', () => { state.isExitOverlayOpen = false; });

// The machine class lands at DOMContentLoaded, the IPC right after.
onIpc(render);
window.addEventListener('DOMContentLoaded', render);

build();
render();
