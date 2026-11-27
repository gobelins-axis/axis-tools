// Every tool of the site, in hub order. Adding a tool = a page under
// tools/<id>/, an entry here, and an input in vite.config.js.
//
// `requires` is shown as tags on the hub:
//   machine     needs the launcher (IPC), nothing useful in a browser
//   main-board  needs the cabinet's input board (Teensy)
//   led         needs the V6-LED firmware and the strips connected

export const TOOLS = [
    {
        id: 'calibration',
        name: 'Joystick calibration',
        description: 'Check both joysticks as games see them, then calibrate centre, range and direction. Saved on this machine.',
        requires: ['machine', 'main-board'],
    },
    {
        id: 'inputs',
        name: 'Input debugger',
        description: 'Live joysticks, buttons and alternative controllers with charts, rates and raw values. Works with keyboard and gamepad too.',
        requires: [],
    },
    {
        id: 'led',
        name: 'LED check',
        description: 'Light every button and sweep both side strips through axis-api, like a game would.',
        requires: ['machine', 'led'],
    },
    {
        id: 'alternative',
        name: 'Alternative controllers',
        description: 'Every USB board the launcher sees, its handshake state, slot, last message and raw lines.',
        requires: ['machine'],
    },
];

export const REQUIREMENT_LABELS = {
    'machine': 'Machine only',
    'main-board': 'Main board',
    'led': 'LED firmware',
};

export function toolUrl(id) {
    return `/tools/${id}/`;
}
