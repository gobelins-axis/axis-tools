import { onBeforeUnmount } from 'vue';

/**
 * Event listeners tied to the calling component: removed on unmount.
 *
 * Works with anything that has addEventListener / removeEventListener:
 * the Axis singleton, Axis.joystick1/2, Axis.buttonManager.buttonHome,
 * Axis.alternativeControllerManager (axis-api's EventDispatcher), window...
 *
 *   const { on } = useAxisEvents();
 *   on(Axis, 'keydown', (e) => ...);
 */
export function useAxisEvents() {
    const subscriptions = [];

    function on(target, name, listener) {
        if (!target) return;
        target.addEventListener(name, listener);
        subscriptions.push([target, name, listener]);
    }

    onBeforeUnmount(() => {
        subscriptions.splice(0).forEach(([target, name, listener]) => target.removeEventListener(name, listener));
    });

    return { on };
}
