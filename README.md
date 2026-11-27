# 🛠️ Axis Tools

Calibration and debugging tools for the Axis arcade machine, bundled as a single game.
Launch it from the menu, pick a tool with the joystick, press Home to come back to the
list, press Home again to quit.

| Tool | What it does | Needs |
|---|---|---|
| Joystick calibration | Live check of both joysticks, then guided calibration (centre, range, direction), saved on the machine | Machine, main board |
| Input debugger | Joysticks, buttons and alternative controllers with charts, raw values and live settings | Works in a browser too |
| LED check | Lights each button while held, sweeps both side strips in red / green / blue | Machine, V6-LED firmware |
| Alternative controllers | Every USB board the launcher sees, handshake state, last message, raw lines | Machine |

## Run locally

```bash
nvm use
npm install --allow-git=all   # axis-api comes from GitHub
npm run dev                   # http://localhost:8090
```

Keyboard emulation: controller 1 = Q D Z S Space, controller 2 = ← → ↑ ↓ Enter,
Escape = Home. On the hub, Z / S or ↑ / ↓ move, Q or ← opens.

`npm run build` writes the static site to `dist/` (Netlify config included).

## On the machine

Deploy the site, then add it as a game in the hub database with the deployed URL.
The tools that need the launcher (calibration, LEDs, alternative controllers) only show
data when loaded by the launcher.
