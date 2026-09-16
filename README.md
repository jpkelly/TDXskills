# TDXskills — TouchDesigner + VS Code Integration

A portable toolkit for working with TouchDesigner from VS Code. Write Python in VS Code, execute it in a live TD instance, and see results instantly — no copy-paste to the Text Port.

## What This Gives You

- **Send Python to TD from VS Code** — select code, press ⌘+Shift+B, see output in the terminal
- **Copilot Chat integration** — any model in the chat picker can inspect and modify your TD project directly (via MCP server)
- **Autocomplete for TD's Python API** — TDI Library provides type hints, popup docs, and error checking
- **Snapshot/restore node state** — save your manual TD layout work to JSON, restore it if something goes wrong, diff to see what changed
- **Git-friendly** — snapshots are JSON files, everything is text-based and version-controllable

## Setup (5 minutes)

### 1. TouchDesigner side

1. Create a **Web Server DAT** (Tab → "Web Server")
2. Set **Port** to `9980`
3. Set the **Callbacks DAT** to link to `touchdesigner/td_bridge_webserver.py` (enable sync)
4. Make sure **Active** is on

### 2. VS Code side

1. Open this workspace folder in VS Code
2. Install the **Python** and **Pylance** extensions (for TDI autocomplete)
3. Reload the window (⌘+Shift+P → "Developer: Reload Window") to load MCP server and settings

### 3. Verify

- Select some Python code in a `.py` file → press **⌘+Shift+B** → "TD Bridge: Send Selection"
- Output appears in the terminal

## Daily Workflow

| Action | How |
|---|---|
| **Send code to TD** | Select Python → ⌘+Shift+B → "TD Bridge: Send Selection" |
| **Send entire file** | ⌘+Shift+B → "TD Bridge: Send File" |
| **Ask Copilot to modify TD** | Use Copilot Chat — it can call `td_execute`, `td_eval`, `td_inspect` directly |
| **Save your TD layout** | ⌘+Shift+B → "TD Snapshot: Save Scoped" → enter path and name |
| **Restore a layout** | ⌘+Shift+B → "TD Snapshot: Restore" → enter name and path |
| **Compare to saved state** | ⌘+Shift+B → "TD Snapshot: Diff" → enter name and path |
| **List snapshots** | ⌘+Shift+B → "TD Snapshot: List" |

## Project Structure

```
TDXskills/
├── .github/copilot-instructions.md   # 6 workspace rules (always active)
├── .vscode/
│   ├── settings.json                  # Python interpreter → TD's Python (TDI Library)
│   ├── tasks.json                     # ⌘+Shift+B tasks (send + snapshot)
│   ├── mcp.json                       # MCP server config for Copilot Chat
│   ├── td_send.py                     # Sender script (stdin → TD via HTTP)
│   └── td_snapshot.py                 # Snapshot/restore/diff tool
├── mcp/
│   ├── package.json                   # MCP server deps
│   └── index.js                       # MCP server (td_execute, td_eval, td_inspect)
├── touchdesigner/
│   └── td_bridge_webserver.py         # Web Server DAT callback (paste into TD)
├── snapshots/                         # Saved node state (JSON, git-friendly)
├── src/                               # VS Code extension source (for future publishing)
├── package.json                       # Extension manifest
├── tsconfig.json
├── README.md                          # This file
└── LICENSE                            # MIT
```

## Using in Another Project

1. Copy this folder into your project (or add as a workspace folder)
2. In TD, create a Web Server DAT on port 9980, link callbacks to `touchdesigner/td_bridge_webserver.py`
3. Open the workspace in VS Code — tasks, MCP server, and TDI settings load automatically
4. The `.github/copilot-instructions.md` rules apply to any workspace that includes this folder

## MCP Server Tools (for Copilot Chat)

After a window reload, any model in the chat picker can use these:

| Tool | Description |
|---|---|
| `td_execute` | Run multi-line Python in TD (statements, defs, prints) |
| `td_eval` | Evaluate a single expression and return the result |
| `td_inspect` | Inspect a node by path — returns type, parameters, children |

## Workspace Rules

1. **Node layout** — set `nodeX`/`nodeY` on every node, never stack them
2. **No guessing** — probe TD APIs with `pars()` or check docs before writing code
3. **Use built-in callbacks** — modify existing `panelexec1` DATs, don't create external ones
4. **Write Python to files** — never inline complex Python in curl commands
5. **Snapshot before modifying** — always save node state before programmatic changes
6. **Don't modify widget internals** — use external parameters only on widgetCOMPs

## Skills

Two skills are installed at `~/.copilot/skills/`:

- **td-bridge** — HTTP bridge protocol, commands, how to write Python for the bridge
- **td-snapshot** — save/restore/diff procedures, path-scoped workflow

## How It Works

```
VS Code                          TouchDesigner
┌─────────────┐    HTTP POST     ┌──────────────────┐
│  td_send.py │  ──────────────► │  Web Server DAT   │
│  or MCP     │   localhost:9980 │  callback runs    │
│             │  ◄────────────── │  on TD main thread│
│  Output in  │   JSON response  │  exec()/eval()    │
│  terminal   │                  │  → stdout capture │
└─────────────┘                  └──────────────────┘
```

The Web Server DAT receives Python code via HTTP POST, executes it on TD's main thread (so `op()`, `parent()`, `me` all work), captures `stdout`, and returns the result as JSON.

## License

MIT