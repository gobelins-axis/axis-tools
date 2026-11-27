// Hub: the tool picker, first page of the site.
//
// Joystick up/down (either one) or I / S move the selection, A opens the
// tool, Home quits to the launcher menu like any game. Coming back from a
// tool (?from=<id>) reselects it.

import '../shared/base.css';
import './hub.css';
import { setupAxis, onIpc, isMachine } from '../shared/axis.js';
import { createInputs } from '../shared/inputs.js';
import { TOOLS, REQUIREMENT_LABELS, toolUrl } from '../tools.js';

const Axis = setupAxis();

const els = {
    tools: document.querySelector('.js-tools'),
    source: document.querySelector('.js-source'),
    footnote: document.querySelector('.js-footnote'),
};

const setInputs = createInputs(document.querySelector('.js-inputs'));

const from = new URLSearchParams(window.location.search).get('from');
const state = {
    index: Math.max(0, TOOLS.findIndex((tool) => tool.id === from)),
    isOpening: false,
};

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function build() {
    TOOLS.forEach((tool, index) => {
        const item = document.createElement('li');
        item.className = 'tool';

        const tags = tool.requires
            .map((req) => `<span class="tag tag--dim">${REQUIREMENT_LABELS[req]}</span>`)
            .join('');

        item.innerHTML = `
            <span class="tool-number">${String(index + 1).padStart(2, '0')}</span>
            <div class="tool-body">
                <h2 class="tool-name">${tool.name}</h2>
                <p class="tool-description">${tool.description}</p>
            </div>
            <div class="tool-tags">${tags}</div>
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

    els.source.textContent = isMachine() ? 'On the machine' : 'Browser, keyboard emulation';
    els.footnote.textContent = isMachine() ? '' : 'Keyboard: Z / S or ↑ / ↓ to move, Q or ← to open, Escape to exit';

    setInputs([
        { key: 'i', label: 'Up' },
        { key: 's', label: 'Down' },
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
    if (state.isOpening) return;
    state.isOpening = true;
    state.index = index;
    els.tools.children[index].classList.add('is-opening');
    window.location.href = toolUrl(TOOLS[index].id);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

Axis.addEventListener('keydown', (e) => {
    if (e.key === 'i') select(state.index - 1);
    if (e.key === 's') select(state.index + 1);
    if (e.key === 'a') open();
});

[Axis.joystick1, Axis.joystick2].forEach((joystick) => {
    joystick.addEventListener('joystick:quickmove', (e) => {
        if (e.direction === 'up') select(state.index - 1);
        if (e.direction === 'down') select(state.index + 1);
    });
});

// The machine class lands at DOMContentLoaded, the IPC right after.
onIpc(render);
window.addEventListener('DOMContentLoaded', render);

build();
render();
