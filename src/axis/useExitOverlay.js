import { Axis } from './axis.js';
import { useAxisEvents } from './useAxisEvents.js';

/**
 * Whether axis-api's exit overlay (Home on the hub) is showing. While it is,
 * the A / X buttons belong to the overlay, but axis-api still dispatches them
 * as ordinary `keydown` events: views must ignore them, including the press
 * that confirms or cancels (hence the reset on the next tick).
 *
 *   const exitOverlay = useExitOverlay();
 *   on(Axis, 'keydown', (e) => { if (exitOverlay.isOpen()) return; ... });
 */
export function useExitOverlay() {
    const { on } = useAxisEvents();
    let open = false;

    on(Axis, 'exit:attempted', () => { open = true; });
    const close = () => { setTimeout(() => { open = false; }, 0); };
    on(Axis, 'exit:canceled', close);
    // On the machine the launcher reloads the window; in a browser the page
    // stays, so the buttons must work again.
    on(Axis, 'exit:completed', close);

    return { isOpen: () => open };
}
