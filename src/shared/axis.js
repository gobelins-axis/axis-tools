// Shared bootstrap for every page of axis-tools.
//
// The site is loaded by the launcher like any game. axis-api gets the
// launcher's ipcRenderer through window.__axis__.set_ipc_renderer (called by
// the launcher preload, see the shim in each page's <head>). On top of that
// this module:
//
//   - keeps a handle on the raw ipcRenderer for the tools that talk to the
//     launcher directly (calibration:*, alternative:list, joystick:raw...);
//   - on tool pages, turns Home -> exit into "back to the hub" instead of
//     "back to the menu", by swallowing axis-api's `exit` IPC;
//   - registers the shared keyboard emulation for laptop development.

import Axis from 'axis-api';
import 'axis-api/build/bundle.css';

export const HUB_URL = '/';

let ipc = null;
const ipcWaiters = [];

/**
 * @param {object} [options]
 * @param {string} [options.tool] Tool id. When set, confirming the exit
 *   overlay goes back to the hub (selecting this tool) instead of quitting.
 */
export function setupAxis(options = {}) {
    const { tool } = options;

    const setIpcRenderer = window.__axis__.set_ipc_renderer;

    window.__axis__.set_ipc_renderer = (raw) => {
        if (ipc || !raw) return;
        ipc = raw;
        setIpcRenderer(tool ? withoutExit(raw) : raw);
        ipcWaiters.splice(0).forEach((fn) => fn(raw));
    };

    // The preload ran before this module: the <head> shim kept the ipcRenderer.
    if (window.__axis_pending_ipc__) {
        window.__axis__.set_ipc_renderer(window.__axis_pending_ipc__);
        delete window.__axis_pending_ipc__;
    }

    if (tool) {
        // Dispatched by axis-api right before it sends `exit`, which
        // withoutExit() drops. In a browser there is no IPC at all.
        Axis.addEventListener('exit:completed', () => goToHub(tool));
    }

    registerKeyboard();

    return Axis;
}

/** Calls fn(ipcRenderer) once the launcher hands it over. Never called in a browser. */
export function onIpc(fn) {
    if (ipc) fn(ipc);
    else ipcWaiters.push(fn);
}

export function getIpc() {
    return ipc;
}

export function isMachine() {
    return document.documentElement.classList.contains('is-axis-machine') || Boolean(ipc);
}

export function goToHub(fromTool) {
    window.location.href = fromTool ? `${HUB_URL}?from=${encodeURIComponent(fromTool)}` : HUB_URL;
}

// Same ipcRenderer, minus the `exit` message: the launcher keeps this site
// loaded and the page navigates back to the hub on its own.
function withoutExit(raw) {
    return new Proxy(raw, {
        get(target, prop) {
            if (prop === 'send') {
                return (channel, ...args) => {
                    if (channel === 'exit') return;
                    target.send(channel, ...args);
                };
            }
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

// Keyboard emulation, same mapping as the other Axis projects.
// Escape opens the exit overlay (built into axis-api).
function registerKeyboard() {
    Axis.registerKeys('q', 'a', 1);
    Axis.registerKeys('d', 'x', 1);
    Axis.registerKeys('z', 'i', 1);
    Axis.registerKeys('s', 's', 1);
    Axis.registerKeys(' ', 'w', 1);

    Axis.registerKeys('ArrowLeft', 'a', 2);
    Axis.registerKeys('ArrowRight', 'x', 2);
    Axis.registerKeys('ArrowUp', 'i', 2);
    Axis.registerKeys('ArrowDown', 's', 2);
    Axis.registerKeys('Enter', 'w', 2);
}

export { Axis };
