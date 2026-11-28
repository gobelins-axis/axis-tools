import { Axis } from './axis.js';
import { useAxisEvents } from './useAxisEvents.js';

/**
 * Whether axis-api's exit overlay (Home) is showing. While it is, the A / X
 * buttons belong to the overlay, but axis-api still dispatches them as
 * ordinary `keydown` events: views must ignore them, including the press
 * that confirms or cancels (hence the reset on the next tick).
 *
 *   const exitOverlay = useExitOverlay();
 *   on(Axis, 'keydown', (e) => { if (exitOverlay.isOpen()) return; ... });
 */
export function useExitOverlay() {
    const { on } = useAxisEvents();
    let open = false;

    on(Axis, 'exit:attempted', () => { open = true; });
    on(Axis, 'exit:canceled', () => { setTimeout(() => { open = false; }, 0); });
    // Completed: the page is being left (hub) or the window reloads (launcher).

    return { isOpen: () => open };
}
