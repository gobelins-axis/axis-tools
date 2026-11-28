# axis-tools

Maintenance tools for the Axis cabinet, packaged as **one game**: uploaded to the hub
database like any game, launched from the menu, Home quits. Inside, a tool picker (the
hub page) opens each tool. See `../CLAUDE.md` for the ecosystem and the IPC contracts.

- Vue 3 single-page app (vue-router 4, history mode), plain JS, Vite 6, Node 22 (`.nvmrc`).
  `npm run dev` (port 8090), `npm run build` → `dist/`, deployed on Netlify (`netlify.toml`
  rewrites every path to `index.html`). vue-router 5 needs Vite 7: stay on 4 until Vite moves.
- axis-api from GitHub (`github:gobelins-axis/axis-api`, pinned by the lockfile).
  With npm ≥ 11 git deps are refused by default: `npm install --allow-git=all`.

## Layout

- `index.html`: the only page. Keeps the `window.__axis__` shim in `<head>` (the launcher
  preload checks for it at DOMContentLoaded and may run before the app).
- `src/main.js` → `setupAxis({ router })`, then mounts `App.vue` (a `<RouterView>` keyed by
  path, so every tool mounts fresh).
- `src/router.js`: `/` = hub, `/tools/<id>/` = each tool (same URLs as the old multi-page
  site), unknown paths → `/`. Route meta: `tool` (id), `theme` (`cabinet` | `dev`, set on
  `<html data-theme>`), `title`. Tool views are lazy chunks (three.js only loads with the LED check).
- `src/tools.js`: list of tools (id, name, description). Adding a tool = view under
  `src/views/<id>/` + entry here + entry in `VIEWS` in `router.js`.
- `src/axis/axis.js`: the one axis-api setup, run once:
  - keeps the raw `ipcRenderer` (`onIpc(fn)`, `getIpc()`) for launcher-specific channels;
  - Home (Escape on a keyboard): inside a tool, straight back to the hub (`?from=<id>`),
    no exit overlay; on the hub, axis-api's exit overlay as in any game (confirm =
    launcher menu). axis-api's ExitOverlay has no public switch: `routeHome()` swaps its
    two private listeners for one that routes, and resets its `_active` flag after a
    confirm (axis-api never does, a game reloads there; left alone, the next Home on the
    hub would quit without the overlay);
  - exit gate (safety net): the ipcRenderer handed to axis-api drops `exit` while the
    current route is a tool;
  - keyboard emulation (Q D Z S Space / ← → ↑ ↓ Enter, Escape = Home) and **one** gamepad
    emulator for the whole app (axis-api accepts a single emulator per joystick / button):
    sticks = joysticks, buttons 0–3 / 4–7 = A X I S of groups 1 / 2, d-pad ← → = W1 / W2.
- `src/axis/useAxisEvents.js` (`on(target, name, fn)`), `useIpc.js` (`ready`, `listen`, `send`),
  `useExitOverlay.js` (`isOpen()`): composables whose listeners are removed on unmount.
  **Views never call `addEventListener` / `ipc.on` directly**, or listeners pile up across
  route changes.
- `src/styles/base.css`: cabinet design system (copied from axis-launcher-front: palette,
  Darker Grotesque, 1rem = 1vw at 2560). Scoped to `html[data-theme="cabinet"]` inside
  `:where()`, so it never reaches the input debugger and view `<style scoped>` rules
  override it. `src/components/`: `AppHeader`, `InputIndicators` (bottom-right glyphs,
  same fade as the front). Fonts and icons in `public/`.
- While axis-api's exit overlay is open (hub only), its Yes / Back (A / X) still arrive as
  ordinary `keydown` events: views that act on A / X check `useExitOverlay().isOpen()` (hub,
  and calibration as a fallback).

### What page loads used to do (keep this in mind when changing a view)

Switching tools was a full page load in the multi-page version; route changes are not, so:

- **Calibration drafts**: the launcher only discards them on `did-start-loading`.
  `CalibrationView` sends `calibration:discard` for every applied, unsaved draft on unmount
  and on `beforeunload`.
- **LEDs**: the launcher only clears them on page loads. `router.afterEach` sends
  `led:clear` on every route change, `LedView` stops its sweeps and clears on unmount.
- **axis-api config**: the input debugger writes joystick `deadzone` / `threshold`; it
  restores the previous values on unmount.
- **Resources**: `MachineScene.dispose()` frees the WebGL context; frame loops, timers
  and intervals are cleared on unmount.
- Reactive objects cannot go through Electron IPC (structured clone): send plain data
  (`calibration.js` copies every payload).

## Tools

| id | Origin | Talks to the launcher with |
|---|---|---|
| `calibration` | `axis-launcher-electron/src/calibration` (removed there) | `joystick:raw`, `calibration:get` (invoke), `calibration:apply/save/discard` |
| `inputs` | the `debugger/` project (gobelins-axis/joystick-debugger) | raw `joystick:move`; keeps its own light dev-tool look (`inputs.css` under `.debugger`, theme `dev`), canvas drawing in `draw.js` |
| `led` | `axis-launcher-electron/src/led-debug` (removed there); 3D machine from `axis-launcher-front`'s MachineComponent | axis-api LED API only, `led:clear` on unmount / unload |
| `alternative` | `axis-launcher-electron/src/alternative-debug` (removed there) | `alternative:list` (invoke), `alternative:connected/disconnected/message/raw` |

The launcher has no tool pages anymore: this site is the only way to reach the tools
(through the menu, as a game). Calibration logic (steps, thresholds, formulas, IPC) is in
`src/views/calibration/calibration.js`, ported line for line from the pre-Vue page and
checked against it with a scripted run (same screen texts and IPC payloads at every step).

## LED check 3D scene (`src/views/led/machine.js`)

three.js (pinned `0.170.0`) scene of the machine, model and matcaps copied from
`axis-launcher-front/static/webgl` (`axis-machine-v7.glb` → `public/models/axis-machine.glb`).
Same material assignment as the front's MachineComponent, matcaps used for their
brightness only (they are photos and tint the body brown). Colour management is off
(`ColorManagement.enabled = false`, linear output) like the front's three r140. Glow is
the front's selective bloom ported in `selectiveBloom.js` (same settings:
strength 0.7, radius 0.53, threshold 0.9, 20% buffers, 6 blur passes); a mesh glows when
its material has `userData.bloom = true` (strips and buttons). The machine stands on a
procedural checker floor (`FLOOR` in machine.js) that fades to black like fog; tiles are
sized from the `borne` mesh's outline at floor level so the base covers exactly 2 x 2.
The screen (`écran`, a double-sided quad) shows a digital-rain canvas texture
(`matrixScreen.js`) that also glows. Matrix atmosphere: `BACKGROUND` (clear colour and floor fog), a green
light pool on the floor (`FLOOR.lightColor`) and a faint `MACHINE_TINT` on the matcaps. The
machine faces +x; the strips (`LED_gauche` z+, `LED_droite` z−) sit on the front corners
of the lower body facing sideways, so `setFocus` orbits the camera towards the side
being swept. Joysticks also orbit the camera (`setOrbit`: full left shows the right
side, up/down rise 12° / dip 5° (`PITCH_UP/DOWN`), centred = rest view); a held W sweep wins, then hands back after `FOCUS_RETURN_DELAY_MS`.
Test without the machine with the app-wide gamepad emulation (see Layout). `STRIP_FLIP` picks which end of each strip mesh is LED 0. Mouse orbit is on
(OrbitControls). `dispose()` frees everything when the route is left. In dev, `window.__machine` exposes the scene.

