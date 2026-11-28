import { onBeforeUnmount } from 'vue';
import { onIpc, getIpc } from './axis.js';

/**
 * Launcher IPC tied to the calling component. Nothing happens in a browser
 * (no ipcRenderer); on the machine, listeners are removed on unmount.
 *
 *   const { ready, listen, send } = useIpc();
 *   listen('joystick:raw', (event, data) => ...);
 *   ready((ipc) => ipc.invoke('calibration:get').then(...));
 */
export function useIpc() {
    let unmounted = false;
    const subscriptions = [];

    /** fn(ipcRenderer) once the launcher hands it over, unless unmounted by then. */
    function ready(fn) {
        onIpc((ipc) => {
            if (!unmounted) fn(ipc);
        });
    }

    function listen(channel, listener) {
        ready((ipc) => {
            ipc.on(channel, listener);
            subscriptions.push([ipc, channel, listener]);
        });
    }

    function send(channel, data) {
        const ipc = getIpc();
        if (ipc) ipc.send(channel, data);
    }

    onBeforeUnmount(() => {
        unmounted = true;
        subscriptions.splice(0).forEach(([ipc, channel, listener]) => ipc.removeListener(channel, listener));
    });

    return { ready, listen, send };
}
