# axis-tools

Maintenance tools for the Axis cabinet, packaged as **one game**: uploaded to the hub
database like any game, launched from the menu, Home quits. Inside, a tool picker (the
hub page) opens each tool. See `../CLAUDE.md` for the ecosystem and the IPC contracts.

- Vite 6 multi-page site, plain JS/CSS, Node 22 (`.nvmrc`). `npm run dev` (port 8090),
  `npm run build` → `dist/`, deployed on Netlify (`netlify.toml`).
- axis-api from GitHub (`github:gobelins-axis/axis-api`, pinned by the lockfile).
  With npm ≥ 11 git deps are refused by default: `npm install --allow-git=all`.

## Layout

- `index.html` + `src/hub/`: the tool picker. Joystick up/down or I/S to move, A to
  open, Home quits to the launcher menu. `?from=<id>` reselects the tool you came from.
- `src/tools.js`: list of tools (id, name, description, requirement tags). Adding a tool =
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
| `calibration` | `axis-launcher-electron/src/calibration` | `joystick:raw`, `calibration:get` (invoke), `calibration:apply/save/discard` |
| `inputs` | the `debugger/` project (gobelins-axis/joystick-debugger) | raw `joystick:move` via `Axis.ipcRenderer`; keeps its own light dev-tool CSS, no base.css |
| `led` | `axis-launcher-electron/src/led-debug` | axis-api LED API only, `led:clear` on unload |
| `alternative` | `axis-launcher-electron/src/alternative-debug` | `alternative:list` (invoke), `alternative:connected/disconnected/message/raw` |

The launcher copies still exist and are still what its dev toggles and the W+S combo
open; this project is the replacement. Calibration drafts are dropped by the launcher on
any page load that is not its own calibration URL, which is also true for this site, so
an unsaved preview never survives leaving the page.
