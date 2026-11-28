# 🛠️ Axis Tools

Calibration and debugging tools for the Axis arcade machine, bundled as a single game.
Launch it from the menu, pick a tool with the joystick, press Home to come back to the
list, press Home again to quit.

| Tool | What it does | Needs |
|---|---|---|
| Joystick calibration | Live check of both joysticks, then guided calibration (centre, range, direction), saved on the machine | Machine, main board |
| Input debugger | Joysticks, buttons and alternative controllers with charts, raw values and live settings | Works in a browser too |
| LED check | 3D machine mirroring the real one: a held button moves in and lights, W1 / W2 sweep the left / right strip in red / green / blue | Machine, V6-LED firmware |
| Alternative controllers | Every USB board the launcher sees, handshake state, last message, raw lines | Machine |

## Run locally

```bash
nvm use
npm install --allow-git=all   # axis-api comes from GitHub
npm run dev                   # http://localhost:8090
```

Keyboard emulation: controller 1 = Q D Z S Space, controller 2 = ← → ↑ ↓ Enter,
Escape = Home. On the hub, ↑ / ↓ move, Enter or A opens. A gamepad works too: sticks =
joysticks, buttons 0–3 / 4–7 = A X I S of controllers 1 / 2, d-pad ← → = W1 / W2.

Vue 3 single-page app (vue-router): `/` is the tool picker, each tool lives at
`/tools/<id>/`. See `CLAUDE.md` for the structure.

`npm run build` writes the static site to `dist/` (Netlify config included, with the
SPA rewrite).

## On the machine

Deploy the site, then add it as a game in the hub database with the deployed URL.
The tools that need the launcher (calibration, LEDs, alternative controllers) only show
data when loaded by the launcher.
