# axis-tools

Maintenance tools for the Axis cabinet, packaged as **one game**: uploaded to the hub
database like any game, launched from the menu, Home quits. Inside, a tool picker (the
hub page) opens each tool. See `../CLAUDE.md` for the ecosystem and the IPC contracts.

- Vite 6 multi-page site, plain JS/CSS, Node 22 (`.nvmrc`). `npm run dev` (port 8090),
  `npm run build` → `dist/`, deployed on Netlify (`netlify.toml`).
- axis-api from GitHub (`github:gobelins-axis/axis-api`, pinned by the lockfile).
  With npm ≥ 11 git deps are refused by default: `npm install --allow-git=all`.

## Layout

- `index.html` + `src/hub/`: the tool picker. Joystick up/down or keyboard arrows to move, A (Enter or A on a keyboard) to
  open, Home quits to the launcher menu. `?from=<id>` reselects the tool you came from.
- `src/tools.js`: list of tools (id, name, description). Adding a tool =
  page under `tools/<id>/` + entry here + input in `vite.config.js`.
- `src/shared/axis.js`: bootstrap every page calls first (`setupAxis({ tool })`):
  - keeps the raw `ipcRenderer` (`onIpc(fn)`, `getIpc()`) for launcher-specific channels;
  - on tool pages, wraps the ipcRenderer handed to axis-api so its `exit` message is
    dropped, and navigates to the hub on `exit:completed` instead. Home in a tool = back
    to the hub, the launcher never sees an exit. On the hub, `exit` goes through;
  - registers the keyboard emulation (Q D Z S Space / ← → ↑ ↓ Enter, Escape = Home).
- `src/shared/base.css`, `src/shared/inputs.js`: cabinet design system (copied from
  axis-launcher-front: palette, Darker Grotesque, 1rem = 1vw at 2560, InputIndicator)
  and the bottom-right input indicators. Fonts and icons in `public/`.
- Every page keeps the `window.__axis__` shim in `<head>`: the launcher preload checks
  for it at DOMContentLoaded and may run before the module.
- Each tool is its own page on purpose: switching tools is a full load, so axis-api,
  IPC listeners and LEDs start clean (the launcher clears LEDs on every load).

## Tools

| id | Origin | Talks to the launcher with |
|---|---|---|
| `calibration` | `axis-launcher-electron/src/calibration` (removed there) | `joystick:raw`, `calibration:get` (invoke), `calibration:apply/save/discard` |
| `inputs` | the `debugger/` project (gobelins-axis/joystick-debugger) | raw `joystick:move` via `Axis.ipcRenderer`; keeps its own light dev-tool CSS, no base.css |
| `led` | `axis-launcher-electron/src/led-debug` (removed there); 3D machine from `axis-launcher-front`'s MachineComponent | axis-api LED API only, `led:clear` on unload |
| `alternative` | `axis-launcher-electron/src/alternative-debug` (removed there) | `alternative:list` (invoke), `alternative:connected/disconnected/message/raw` |

The launcher has no tool pages anymore: this site is the only way to reach the tools
(through the menu, as a game). The launcher drops calibration drafts whenever the window
starts loading a page, so an unsaved preview never survives leaving the calibration page.

## LED check 3D scene (`tools/led/machine.js`)

three.js (pinned `0.170.0`) scene of the machine, model and matcaps copied from
`axis-launcher-front/static/webgl` (`axis-machine-v7.glb` → `public/models/axis-machine.glb`).
Same material assignment as the front's MachineComponent, matcaps used for their
brightness only (they are photos and tint the body brown). Colour management is off
(`ColorManagement.enabled = false`, linear output) like the front's three r140. Glow is
the front's selective bloom ported in `tools/led/selectiveBloom.js` (same settings:
strength 0.7, radius 0.53, threshold 0.9, 20% buffers, 6 blur passes); a mesh glows when
its material has `userData.bloom = true` (strips and buttons). The machine stands on a
procedural checker floor (`FLOOR` in machine.js) that fades to black like fog; tiles are
sized from the `borne` mesh's outline at floor level so the base covers exactly 2 x 2.
The screen (`écran`, a double-sided quad) shows a digital-rain canvas texture
(`tools/led/matrixScreen.js`) that also glows. Matrix atmosphere: `BACKGROUND` (clear colour and floor fog), a green
light pool on the floor (`FLOOR.lightColor`) and a faint `MACHINE_TINT` on the matcaps. The
machine faces +x; the strips (`LED_gauche` z+, `LED_droite` z−) sit on the front corners
of the lower body facing sideways, so `setFocus` orbits the camera towards the side
being swept. Joysticks also orbit the camera (`setOrbit`: full left shows the right
side, up/down rise 12° / dip 5° (`PITCH_UP/DOWN`), centred = rest view); a held W sweep wins, then hands back after `FOCUS_RETURN_DELAY_MS`.
The page sets up axis-api gamepad emulation (gamepad 0: sticks = joysticks, buttons 0–3 /
4–7 = A X I S of groups 1 / 2, d-pad left/right = W1 / W2) to test without the machine. `STRIP_FLIP` picks which end of each strip mesh is LED 0. Mouse orbit is on
(OrbitControls). In dev, `window.__machine` exposes the scene.

