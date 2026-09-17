# TDXskills Extension Portability Plan

> **Created:** 2026-09-16
> **Goal:** Transform TDXskills from a workspace-folder-based toolkit into a published VS Code extension that any TouchDesigner + VS Code user can install and use with minimal configuration.
> **Status:** Phase 1 complete and verified against live TD — ready to begin Phase 2

---

## Decisions

| Topic | Decision |
|---|---|
| **MCP server** | Extension bundles compiled MCP JS, writes `.vscode/mcp.json` on activation. No separate npm install. Standard Node process spawned by VS Code. |
| **Snapshot storage** | Workspace-level, configurable via `tdBridge.snapshotDir` setting. Default: `${workspaceFolder}/snapshots/`. Git-friendly, per-project. |
| **TD Python path** | Auto-detect common TD install paths (macOS/Windows) on first activation, offer to set `python.defaultInterpreterPath`. Fallback to `tdBridge.tdPythonPath` setting. |
| **Bridge setup** | "Generate Bridge" command: opens callback Python in editor AND offers to save to a file. User points TD's Callbacks DAT at it (sync on). Uses the working Web Server DAT callback, NOT the dead socket-thread version. |
| **Workspace rules** | Ship as skills installed to `~/.copilot/skills/`. Skill list grows over time as new needs are discovered. |
| **Release staging** | Phased milestones. Each phase is independently testable and publishable. Not rushed. |

---

## Architecture: What the Extension Replaces

| Current (workspace-based) | Extension equivalent |
|---|---|
| `.vscode/td_send.py` + `tasks.json` | `tdBridge.sendSelection`, `tdBridge.sendFile`, `tdBridge.sendLine`, `tdBridge.evalExpression` commands + keybindings |
| `.vscode/td_snapshot.py` + tasks.json | `tdBridge.snapshotSave`, `tdBridge.snapshotRestore`, `tdBridge.snapshotDiff`, `tdBridge.snapshotList` commands |
| `mcp/index.js` + `.vscode/mcp.json` | Bundled MCP server, auto-writes mcp.json on activation |
| `touchdesigner/td_bridge_webserver.py` | "Generate Bridge" command opens the callback in editor / saves to file |
| `.vscode/settings.json` (TDI path) | Auto-detect on first activation, writes `python.defaultInterpreterPath` |
| `.github/copilot-instructions.md` | Skills installed to `~/.copilot/skills/td-bridge/`, `~/.copilot/skills/td-snapshot/`, etc. |
| `README.md` setup instructions | Extension README on marketplace + "Show Setup" command |

### What stays the same (the protocol)

- HTTP POST to `localhost:9980` with `{"code": "...", "mode": "exec"|"eval"}`
- Web Server DAT in TD as the listener (NOT raw socket threads)
- Response format: `{"stdout": "...", "result": "...", "error": null|"..."}`

---

## Phased Plan

### Phase 0: Repository Reorganization (prerequisite)

**Goal:** Clean up the repo structure for extension development.

**Tasks:**
- [x] Move `touchdesigner/td_bridge_webserver.py` → `resources/td_bridge_webserver.py` (bundled as extension resource)
- [x] `mcp/index.js` + `mcp/package.json` stay in `mcp/` — compiled/bundled during extension build (Phase 3)
- [x] Move `.vscode/td_snapshot.py` → `legacy/td_snapshot.py` as the tracked source for the Phase 2 TypeScript port
- [x] Move `snapshots/` demo files → `snapshots/examples/`
- [x] Untrack `.vscode/tasks.json`, `.vscode/settings.json`, `.vscode/mcp.json` (extension-generated later; reference copies in `legacy/`)
- [x] Untrack `.vscode/td_send.py` and `.vscode/td_snapshot.py` (logic moves into extension; reference copies in `legacy/`)
- [x] Keep `.github/copilot-instructions.md` in repo as the source-of-truth for skill content
- [x] Update `.gitignore` for `node_modules/`, `out/`, `*.vsix`, live `.vscode/` tooling, dev snapshots
- [x] Update `.vscodeignore` so `legacy/`, `snapshots/`, `touchdesigner/`, `.github/`, `PLAN.md` are excluded from the `.vsix`

**Deliverable:** Clean repo structure ready for extension development.
**Test:** Repo builds with `npm run compile`, no leftover workspace-specific files.

**Outcome:** `npm run compile` passes. The live `.vscode/` scripts remain on disk (untracked + gitignored) so the current
task-based workflow keeps working until Phases 1–2 replace it. `legacy/` holds the tracked reference copies, which also
become the Phase 6 fallback for users who cannot install the extension. `legacy/td_bridge_server_socket.py` is the dead
socket-thread bridge, kept only as a record of the approach that caused the TD thread-conflict dialog — do not revive it.

**New structure:**

| Path | Purpose |
|---|---|
| `resources/td_bridge_webserver.py` | Working Web Server DAT callback, shipped in the `.vsix` |
| `legacy/` | Tracked reference copies of the workspace scripts + configs (Phase 2 port source, Phase 6 fallback) |
| `snapshots/examples/` | Demo snapshots from the UI build, tracked as examples |
| `snapshots/*.json` | Dev snapshots, gitignored |
| `.vscode/` | JP's live working tooling — untracked except `launch.json` |

---

### Phase 1: Fix the Extension Core (v0.2.0)

**Goal:** Working extension that replaces td_send.py + tasks.json. Send Python to TD, see output, connection status.

**Tasks:**
- [x] Replace `getBridgePythonCode()` in `extension.ts` — now reads the bundled `resources/td_bridge_webserver.py` at runtime instead of embedding the dead socket-thread server as a string
- [x] Fix `testConnection()` in `bridgeClient.ts` — replaced the nonexistent `td.version()` with a single defensive probe expression
- [x] Wire up output channel: send commands print stdout, result, errors to "TouchDesigner Bridge" output channel
- [x] Implement auto-connect on first send if not connected (lazy connection)
- [x] Add `tdBridge.snapshotDir` and `tdBridge.tdPythonPath` to configuration schema (empty defaults, filled by later phases)
- [x] Contribute `tdBridge.generateBridge` as a palette command (was registered but not exposed)
- [x] Change activation to `onLanguage:python` so the status bar appears without running a command first
- [x] Pass the `tdBridge.timeout` setting through to the client; reset the client when host/port/timeout change
- [x] Verify keybindings work (⌘+enter, shift+enter, ⌘+shift+enter — already in package.json)
- [x] Test: bridge client verified against a mock Web Server DAT (probe parsing, exec, eval, connection refused)
- [x] Test: compiled client verified against a **live TD 2025.33230** — probe, exec + stdout, eval, Python error, offline path
- [x] Test: extension dev host — status bar states, keybindings, output channel formatting, end-to-end send returning `=> 1848.5166666666667`
- [x] Add `auto` execution mode so expressions return values without the caller choosing eval vs exec

**Deliverable:** `.vsix` that provides send-to-TD functionality with keybindings + status bar.
**Test:** Install in a clean VS Code, connect to running TD, send code, see output.
**Handoff note:** F5 dev host in Insiders needs `runtimeExecutable: /Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders` in launch.json.

**Probe expression** (in `bridgeClient.ts`) — returns `python|build|product`:

```python
__import__('sys').version.split()[0]
  + '|' + str(getattr(__import__('td').app, 'build', ''))
  + '|' + str(getattr(__import__('td').app, 'product', ''))
```

Verified live: `3.11.15|2025.33230|TouchDesigner`.

**Gotcha found during live testing:** a first attempt used `globals().get('app')` and silently returned empty fields.
TD's DAT module `globals()` contains only `op`, `ops`, `opex`, `me`, `mod`, `parent`, `ext`, `iop`, `ipar` plus whatever
the file imports — **not** `app` or `absTime`. Bare `absTime` still evaluates, so TD resolves those names outside the
globals dict. Never probe TD globals with `globals().get(...)`; import the `td` module instead.

Note `app.version` is the series string (`'099'`), not the build. Use `app.build` for the version users recognise.

**Known non-issue:** the editor may report `Cannot find name 'Buffer'` in `extension.ts`. `npx tsc -p ./` passes —
it is a stale TS server cache. "TypeScript: Restart TS Server" clears it.

**`auto` execution mode.** The first live test sent `absTime.frame` and printed nothing, because send commands used
`exec`, which discards the value. `td_send.py` had papered over this with a string heuristic (no newline, no `=`, does
not start with `import`/`def`/...), which misclassifies things like `a == b`. Instead the bridge now accepts
`mode: "auto"` and lets Python decide:

```python
try:
    expr = compile(code, '<vscode>', 'eval')
except SyntaxError:
    expr = None
result = eval(expr, globals()) if expr is not None else exec(code, globals())
```

One round trip, no heuristics. `eval` and `exec` still work explicitly. All send commands use `auto`; only
`tdBridge.evalExpression` forces `eval`.

**Dev host notes for whoever picks this up:**

- F5 fails on this machine with "Extension host did not start in 10 seconds". Launching from the CLI works:
  `"/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code" --new-window --extensionDevelopmentPath=<repo> <some-other-folder>`
- Pass a folder **other than the repo** — VS Code refuses to open a folder already open in another window and you get an
  empty dev host instead.
- `runtimeExecutable` was removed from `launch.json`; `extensionHost` launches use the running app and never needed it.
- After recompiling, the dev host must be reloaded ("Developer: Reload Window") or it keeps running the old build.

---

### Phase 1.5: UI polish (v0.2.1)

The dev host round trip proved too confusing to work in day to day, so the extension is now installed locally from a
`.vsix` instead. That made the unfinished presentation obvious, so this pass covered it.

- [x] Extension icon — `resources/icon.svg` is the editable source, `resources/icon.png` the 128px build
- [x] Listing metadata — display name, description, license, repository, bugs, keywords, gallery banner, categories
- [x] Getting-started walkthrough with 4 steps and markdown media in `resources/walkthrough/`
- [x] Send-file button in the editor title bar for Python files
- [ ] Sidebar view container — deferred to Phase 2, when snapshots give it something to show
- [ ] Editor context menu entries — deferred

**Icon build** (no SVG converter installed; macOS Quick Look does the job):

```bash
cd resources && mkdir -p .iconwork
qlmanage -t -s 512 -o .iconwork icon.svg
sips -z 128 128 .iconwork/icon.svg.png --out icon.png
rm -rf .iconwork
```

The SVG declares `width/height` of 512 with a `viewBox` of 128 on purpose. Quick Look renders at the intrinsic size and
pads to the requested canvas rather than scaling, so a 128px SVG lands in the top-left corner of a 512px PNG.

**Local install loop** — the extension is installed from a `.vsix`, not run in a dev host:

```bash
npm run compile
npx @vscode/vsce package
"/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code" \
  --install-extension tdx-skills-<version>.vsix --force
```

Then reload the window. Bump `version` in `package.json` or the filename will not change.

---

### Phase 2: Snapshot Commands (v0.3.0)

**Goal:** Snapshot save/restore/diff from extension commands, replacing td_snapshot.py tasks.

**Decision point:** Port td_snapshot.py to TypeScript (native, no Python dependency) OR bundle the Python script and call it via child_process.
- **TypeScript port** is cleaner (no external Python needed for snapshots, works on machines without TD's Python on PATH). Recommended.
- The serialization logic (which pars to save, skip list) ports directly. The TD communication uses the same HTTP bridge.

**Tasks:**
- [ ] Create `src/snapshot.ts` — port serialize_node, restore_node, diff_snapshots from td_snapshot.py
- [ ] Register commands: `tdBridge.snapshotSave`, `tdBridge.snapshotSaveScoped`, `tdBridge.snapshotRestore`, `tdBridge.snapshotDiff`, `tdBridge.snapshotList`
- [ ] Snapshot dir: use `tdBridge.snapshotDir` setting, default `${workspaceFolder}/snapshots`
- [ ] Use QuickPick or InputBox for snapshot name and root path prompts (replacing tasks.json `${input:}`)
- [ ] Add keybinding or command palette entries for snapshot commands
- [ ] Test: save a snapshot of /project1, verify JSON file created
- [ ] Test: restore from snapshot, verify nodes restored
- [ ] Test: diff against saved snapshot, verify output
- [ ] Test: list snapshots

**Deliverable:** Snapshot functionality fully in the extension, no external Python scripts needed.
**Test:** Save/restore/diff cycle on a real TD project.

---

### Phase 3: MCP Server Bundling (v0.4.0)

**Goal:** Copilot Chat tools (td_execute, td_eval, td_inspect) work automatically after extension install. No manual mcp.json setup.

**Tasks:**
- [ ] Ensure `mcp/index.js` is self-contained (no external deps beyond MCP SDK — already true)
- [ ] Add build step: `npm run compile` compiles `mcp/index.js` and copies to `out/mcp/index.js` (or bundle with esbuild)
- [ ] On extension activation: write `.vscode/mcp.json` to the workspace pointing to the bundled MCP server path (`${extensionPath}/out/mcp/index.js`)
- [ ] Add `tdBridge.enableMcpServer` setting (default: true) — user can disable
- [ ] Handle the case where mcp.json already exists (don't overwrite, offer to merge)
- [ ] MCP server reads host/port from env vars — extension passes `TD_BRIDGE_HOST` and `TD_BRIDGE_PORT` when writing mcp.json (or the MCP server reads VS Code settings — needs investigation)
- [ ] Test: install extension, open workspace, reload window, verify MCP tools appear in Copilot Chat
- [ ] Test: td_execute, td_eval, td_inspect all work against running TD
- [ ] Test: disabling `tdBridge.enableMcpServer` removes the tools

**Deliverable:** Zero-config MCP integration. One extension install = Copilot Chat can control TD.
**Test:** Fresh workspace, no prior mcp.json, verify tools appear and work after reload.

---

### Phase 4: Setup Assistant (v0.5.0)

**Goal:** Guided first-run experience. TDI autocomplete, bridge setup, all automated.

**Tasks:**
- [ ] **TDI auto-detect:** On first activation (or when no `python.defaultInterpreterPath` is set), probe:
  - macOS: `/Applications/TouchDesigner.app/Contents/Frameworks/Python.framework/Versions/*/bin/python3.*`
  - Windows: `C:\Program Files\Derivative\TouchDesigner\bin\python*.exe` (verify actual path)
  - If found: offer to set `python.defaultInterpreterPath` + `python.analysis.extraPaths`
  - If not found: show "Browse..." file picker, store in `tdBridge.tdPythonPath`
- [ ] **"Generate Bridge" command** (already scaffolded, needs fixing):
  - Opens the Web Server DAT callback Python in a new editor
  - Shows an information message with step-by-step instructions
  - Offers "Save to file..." button → saves to a user-chosen location
  - Instructions: create Web Server DAT in TD, set port to 9980, set Callbacks DAT to the saved file, enable sync
- [ ] **"Setup Wizard" command** (`tdBridge.setup`): walks through all setup steps in sequence:
  1. Detect TD install → configure Python path
  2. Generate bridge callback → user sets it up in TD
  3. Test connection
  4. Write mcp.json (if not done in Phase 3 activation)
  5. Install skills (Phase 5)
  6. Show "You're ready!" summary
- [ ] Add a "Show Setup" command accessible from error dialogs and command palette
- [ ] Test: fresh machine with TD installed, run setup wizard, verify all steps complete
- [ ] Test: machine without TD, verify graceful failure with helpful message

**Deliverable:** Guided setup that a new user can follow without reading docs.
**Test:** Simulate first-run on a clean VS Code profile.

---

### Phase 5: Skills Installation (v0.6.0)

**Goal:** TD workspace rules and workflows are available as Copilot skills, installed by the extension.

**Tasks:**
- [ ] Define skills as extension resources in `resources/skills/`:
  - `td-bridge/SKILL.md` — HTTP bridge protocol, commands, how to write Python for the bridge
  - `td-snapshot/SKILL.md` — save/restore/diff procedures
  - `td-python/SKILL.md` — TD Python patterns, probing, callback rules (from copilot-instructions.md)
  - `td-glsl/SKILL.md` — GLSL shader writing for TD
  - (Future skills added as discovered/needed)
- [ ] "Install Skills" command (`tdBridge.installSkills`): copies skill folders to `~/.copilot/skills/`
  - Check if skill already exists, offer to update
  - Show which skills were installed/updated
- [ ] Call during setup wizard (Phase 4)
- [ ] Add `tdBridge.autoInstallSkills` setting (default: true on first run, false after)
- [ ] Keep `.github/copilot-instructions.md` in the repo as the canonical source — skills are generated/derived from it + additional content
- [ ] Test: run install skills, verify SKILL.md files appear in `~/.copilot/skills/`
- [ ] Test: verify Copilot Chat recognizes and triggers the skills

**Deliverable:** TD-specific knowledge available to Copilot Chat out of the box.
**Test:** Ask Copilot Chat a TD question, verify the relevant skill triggers.

---

### Phase 6: Polish & Marketplace (v1.0.0)

**Goal:** Public-ready extension on the VS Code Marketplace.

**Tasks:**
- [ ] Write extension `README.md` (marketplace listing page):
  - Hero GIF: sending code from VS Code to TD, seeing output
  - Feature list with screenshots
  - Quick start (install → setup wizard → send code)
  - Configuration reference
  - Troubleshooting section
- [ ] Add `icon.png` (128x128) — TD + VS Code themed
- [ ] Add `CHANGELOG.md` with v1.0.0 entry
- [ ] Add repository field, license field, keywords to package.json
- [ ] Test on Windows (if possible — at least verify no macOS-specific code paths in the core)
- [ ] Test on VS Code Stable (not just Insiders)
- [ ] `vsce package` → produce `.vsix`
- [ ] `vsce publish` → marketplace
- [ ] Update TDXskills repo README to point to the marketplace extension
- [ ] Consider: keep `.vscode/td_send.py` and `.vscode/td_snapshot.py` as legacy fallback for users who can't install the extension

**Deliverable:** Published extension on VS Code Marketplace.
**Test:** Install from marketplace on a clean machine, run setup wizard, send code to TD.

---

## Technical Notes for Handoff

### Build & Dev
- `npm run compile` — TypeScript → `out/`
- `npm run watch` — watch mode
- F5 to launch extension dev host (Insiders needs custom `runtimeExecutable` in launch.json)
- `vsce package` to produce `.vsix`
- TD must be running with Web Server DAT on port 9980 for integration tests

### Key Files to Modify
- `src/extension.ts` — main entry point, command registration, activation logic
- `src/bridgeClient.ts` — HTTP client for TD bridge
- `package.json` — commands, keybindings, configuration, activation events
- `tsconfig.json` — already configured, may need `resources` in includes if embedding files

### Key Files to Create
- `src/snapshot.ts` — snapshot logic (Phase 2)
- `src/mcpSetup.ts` — MCP server bundling/writing mcp.json (Phase 3)
- `src/tdDetect.ts` — TD install path detection (Phase 4)
- `src/skillsInstaller.ts` — skill installation (Phase 5)
- `resources/td_bridge_webserver.py` — the working bridge callback (moved from `touchdesigner/`)
- `resources/skills/` — skill definitions (Phase 5)

### Critical Gotchas (from project experience)
- **Web Server DAT approach ONLY** — never raw socket threads (causes THREAD CONFLICT dialog)
- **`td.version()` doesn't exist** — use `absTime.frame` for connection test
- **`op.type` returns a string** — use `type(c).__name__` for the Python class name
- **panelexecuteDAT callback names depend on `panelvalue` setting** — `select` → `onSelectOn/onSelectOff`, `state` → `onValueChange`
- **buttonCOMP has built-in `panelexec1`** — don't create external ones, modify the built-in one
- **Don't modify widget COMP internals** — use external parameters only
- **Snapshot restore had JSON double-encoding bug** — use `json.dumps(snapshot, default=str)`
- **Never do `sys = op('/sys')` in bridge exec** — clobbers the sys module. Bridge uses `_sys = __import__('sys')`
- **Palette `.tox` files create containerCOMP wrappers** when loaded via externaltox — must use temp container + copyOPs method

### Current Working Versions (reference)
- `td_send.py`: uses `TD_BRIDGE_HOST`/`TD_BRIDGE_PORT` env vars, auto-detects eval vs exec
- `td_bridge_webserver.py`: Web Server DAT callback, `_sys` protection, stdout capture, JSON response
- `mcp/index.js`: `td_execute`, `td_eval`, `td_inspect` tools, same env var pattern
- `td_snapshot.py`: serialize/restore/diff, `SAVE_PAR_PATTERNS` + `SKIP_PAR_NAMES`, `snapshots/` dir

---

## Progress Log

| Date | Phase | Summary |
|---|---|---|
| 2026-09-16 | — | Plan drafted and approved. Decisions made via interactive Q&A. |
| 2026-09-16 | 0 | Repo reorganized: `resources/`, `legacy/`, `snapshots/examples/` created; `.vscode/` tooling untracked but left working; ignore files updated; `npm run compile` passes. |
| 2026-09-16 | 1 | Extension core fixed: dead socket bridge removed, probe-based `testConnection()`, lazy connect, config plumbing, v0.2.0. Added `auto` exec mode. Verified end-to-end in the dev host against live TD 2025.33230. |
| 2026-09-16 | 1.5 | Packaged and installed locally as `jp.tdx-skills@0.2.1`. Added icon, listing metadata, 4-step walkthrough, editor title button. Dev host abandoned in favour of the vsix install loop. |