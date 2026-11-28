// The one axis-api instance of the app, set up once in main.js.
//
// The site is loaded by the launcher like any game. axis-api gets the
// launcher's ipcRenderer through window.__axis__.set_ipc_renderer (called by
// the launcher preload, see the shim in index.html). On top of that:
//
//   - keeps a handle on the raw ipcRenderer for the tools that talk to the
//     launcher directly (calibration:*, alternative:*, joystick:raw...);
//   - exit gate: inside a tool, Home -> exit overlay -> confirm goes back to
//     the hub instead of the launcher menu. axis-api's `exit` IPC is dropped
//     while the current route is a tool, and the router goes to the hub;
//   - registers the keyboard emulation and one gamepad emulator for the
//     whole app (axis-api accepts a single emulator per joystick / button).
//
// Listeners added by views go through useAxisEvents / useIpc so they are
// removed when the view unmounts.

import Axis from 'axis-api';
import 'axis-api/build/bundle.css';

let ipc = null;
const ipcWaiters = [];
let router = null;

/** @param {{ router: import('vue-router').Router }} options */
export function setupAxis(options) {
    router = options.router;

    const setIpcRenderer = window.__axis__.set_ipc_renderer;

    window.__axis__.set_ipc_renderer = (raw) => {
        if (ipc || !raw) return;
        ipc = raw;
        setIpcRenderer(withExitGate(raw));
        ipcWaiters.splice(0).forEach((fn) => fn(raw));
    };

    // The preload ran before this module: the <head> shim kept the ipcRenderer.
    if (window.__axis_pending_ipc__) {
        window.__axis__.set_ipc_renderer(window.__axis_pending_ipc__);
        delete window.__axis_pending_ipc__;
    }

    // Dispatched by axis-api right before it sends `exit`. Only reachable on
    // the hub now (see routeHome), but kept as a safety net: inside a tool
    // the gate drops that `exit` (the route is still the tool: navigation is
    // async) and we go back to the hub. In a browser there is no IPC at all.
    Axis.addEventListener('exit:completed', () => {
        const tool = currentTool();
        if (tool) router.push({ name: 'hub', query: { from: tool } });
    });

    routeHome();
    registerKeyboard();
    registerGamepad();

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

/** Tool id of the current route, or null on the hub. */
function currentTool() {
    return (router && router.currentRoute.value.meta.tool) || null;
}

// Home (Escape on a keyboard):
//   - inside a tool: straight back to the hub, reselecting the tool. No exit
//     overlay, no `exit` IPC;
//   - on the hub: axis-api's exit overlay, as in any game (confirm = back to
//     the launcher menu).
//
// axis-api's ExitOverlay listens to Home itself and has no public switch, so
// its two listeners (buttonManager `home:keyup`, window `keydown` Escape)
// are swapped for one that routes. It also never resets its state after a
// confirm (a game reloads at that point, this app does not): left as is,
// the next Home would skip the overlay and quit at once. Both rely on
// private fields of the pinned build; if they ever disappear, the stock
// behaviour stays (overlay everywhere, exit gate above).
function routeHome() {
    const overlay = Axis._exitOverlay;
    if (!overlay || typeof overlay._homeKeyupHandler !== 'function' || typeof overlay._keydownHandler !== 'function') {
        console.warn('[axis-tools] axis-api ExitOverlay internals changed: Home shows the exit overlay in tools too');
        return;
    }

    Axis.buttonManager.removeEventListener('home:keyup', overlay._homeKeyupHandler);
    window.removeEventListener('keydown', overlay._keydownHandler);

    function home() {
        const tool = currentTool();
        if (tool) router.push({ name: 'hub', query: { from: tool } });
        else overlay._homeKeyupHandler();
    }

    Axis.buttonManager.addEventListener('home:keyup', home);
    window.addEventListener('keydown', (e) => {
        // A held Escape must not reopen the overlay once back on the hub.
        if (e.key === 'Escape' && !e.repeat) home();
    });

    overlay.addEventListener('exit:completed', () => { overlay._active = false; });
}

// Same ipcRenderer, minus the `exit` message while a tool is shown: the
// launcher keeps this site loaded and the router goes back to the hub.
function withExitGate(raw) {
    return new Proxy(raw, {
        get(target, prop) {
            if (prop === 'send') {
                return (channel, ...args) => {
                    if (channel === 'exit' && currentTool()) return;
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

// Gamepad 0, set up as the axis-api README describes: left stick =
// joystick 1, right stick = joystick 2, buttons 0-3 = A X I S of group 1,
// 4-7 = group 2, d-pad left / right = W1 / W2. Does nothing on the machine
// (no gamepad found).
function registerGamepad() {
    const gamepadEmulator = Axis.createGamepadEmulator(0);
    Axis.joystick1.setGamepadEmulatorJoystick(gamepadEmulator, 0);
    Axis.joystick2.setGamepadEmulatorJoystick(gamepadEmulator, 1);
    ['a', 'x', 'i', 's'].forEach((key, i) => {
        Axis.registerGamepadEmulatorKeys(gamepadEmulator, i, key, 1);
        Axis.registerGamepadEmulatorKeys(gamepadEmulator, i + 4, key, 2);
    });
    Axis.registerGamepadEmulatorKeys(gamepadEmulator, 14, 'w', 1);
    Axis.registerGamepadEmulatorKeys(gamepadEmulator, 15, 'w', 2);

    // Scheduled first so one failing update (axis-api's emulator throws after
    // a second gamepadconnected for the same index) doesn't stop the loop.
    function update() {
        requestAnimationFrame(update);
        gamepadEmulator.update();
    }
    update();
}

export { Axis };
