// Every tool of the site, in hub order. Adding a tool = a page under
// tools/<id>/, an entry here, and an input in vite.config.js.

export const TOOLS = [
    {
        id: 'calibration',
        name: 'Joystick calibration',
        description: 'Check both joysticks as games see them, then calibrate centre, range and direction. Saved on this machine.',
    },
    {
        id: 'inputs',
        name: 'Input debugger',
        description: 'Live joysticks, buttons and alternative controllers with charts, rates and raw values.',
    },
    {
        id: 'led',
        name: 'LED check',
        description: 'Light every button and sweep both side strips through axis-api, like a game would.',
    },
    {
        id: 'alternative',
        name: 'Alternative controllers',
        description: 'Every USB board the launcher sees, its handshake state, slot, last message and raw lines.',
    },
];

export function toolUrl(id) {
    return `/tools/${id}/`;
}
