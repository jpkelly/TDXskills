# TDskills Workspace Rules

## TouchDesigner Node Layout

When creating nodes in the TouchDesigner network editor via the bridge, always position them in a logical, non-overlapping layout:

- **Set node positions** using `node.nodeX` and `node.nodeY` after creation
- **Never stack nodes on top of each other** — every node must have a unique position
- **Left-to-right data flow**: sources on the left, operators in the middle, outputs on the right
- **Vertical spacing**: ~100 TD units between parallel nodes
- **Horizontal spacing**: ~200 TD units between sequential nodes in a chain
- **Group related nodes**: callbacks and DATs that belong to a COMP should be placed inside or directly below their parent
- **Clean as you go**: if you create duplicate or failed nodes, delete them before finishing

### Example pattern

```python
# Create and position nodes in a grid
nodes = [
    ("buttonCOMP", "Button1",   0,    0),
    ("containerCOMP", "Modal",  300,  0),
    ("panelexecuteDAT", "CB1",  0,   -200),
]
for typ, name, x, y in nodes:
    n = parent.create(eval(typ), name)
    n.nodeX = x
    n.nodeY = y
```

### Why
TD's network editor shows node positions visually. Stacked nodes are invisible and make it impossible to understand the network at a glance. Always set `nodeX`/`nodeY`.

## No Guessing About TouchDesigner

When working with TouchDesigner APIs, parameters, DAT callbacks, operator types, or workflows:

- **Never guess parameter names** — probe the actual operator with `pars()` in the Textport
- **Never assume callback function names** — check the DAT's `par.panelvalue` and test which callback method fires
- **Never assume OP type names** — use `type(c).__name__` or probe with `dir(td)` to confirm
- **Always verify behavior** with a small test through the bridge before applying it to the user's project
- **Reference official docs first** — docs.derivative.ca or derivative.ca/UserGuide
- **If unsure and unable to verify**: stop and tell the user exactly what is blocked and what you tried

### Probing pattern (use whenever possible)

```python
# Parameter names
[p.name for p in op('/path/to/op').pars()]

# Available module / class names
import td; print([x for x in dir(td) if 'execute' in x.lower()])

# Callback functions — set all candidates and see which fires
op('/path/to/callback').text = '''
def onSelectOn(panelValue):
    print('onSelectOn fired')
def onOffToOn(panelValue):
    print('onOffToOn fired')
'''
```

### Why
TouchDesigner's Python API has many subtle inconsistencies (e.g. `panelexecuteDAT` uses `onSelectOn` when `panelvalue=select`, `op.type` returns a string). Guessing causes broken callbacks, incorrect parameter assignments, and wasted time. Probing is fast and reliable.

## Use Built-in Callbacks, Don't Create External Ones

When you need to respond to button presses, panel interactions, or parameter changes in TouchDesigner:

- **Always check if the operator already has a built-in callback DAT** before creating a new one. Button COMPs, for example, auto-generate an internal `panelexec1` that uses `panelvalue=state` and `onValueChange` — this is the one that actually fires.
- **Never create an external `panelexecuteDAT` for a button** — it likely won't fire because the button's internal callback already handles the panel value.
- **Modify the existing built-in callback's text** instead of creating a new DAT. Probe the operator's children first: `[c.name for c in op('button1').children if hasattr(c, 'name')]`
- **The callback function name depends on the `panelvalue` setting**: `panelvalue=state` uses `onValueChange`, `panelvalue=select` uses `onSelectOn`/`onSelectOff`. Always check `par.panelvalue` before writing callback code.
- **If a callback isn't firing**, compare it to a TD-generated one: right-click the operator in TD → "Add Panel Execute DAT" and inspect what TD creates automatically.

### Why
TD operators come with pre-wired internal callback DATs that are already configured with the correct `panelvalue`, `fromop`, and function names. Creating external callbacks that duplicate this wiring leads to silent failures — the callback looks correct but never fires because the internal one handles the event first. This cost significant debugging time on the modal dialog feature.

## Don't Modify UI Widget Internals

TouchDesigner widget COMPs (sliders, buttons, etc.) are complex components with internal nodes, extensions, and callback DATs. Only use their **external parameters** to configure behavior.

- **Use external parameters only** — e.g. `Onvaluechangescript0`, `Value0`, `label`, `display`, `x`, `y`, `w`, `h`
- **Never modify internal children** — don't change the text of internal `panelexec1` DATs, don't delete internal nodes, don't modify `SliderExt` or `SubWidgetExt` extensions
- **Only modify internals in edge cases** — if a widget truly can't do what's needed via external pars, explain why and get user approval first
- **When probing a widget**, inspect its external pars first; only look at children to understand structure, not to modify it

### Why
Widget COMPs are designed to be configured via their promoted parameters. Modifying internals can break the widget's internal logic, extensions, and update mechanisms. Changes to internals may also be lost when the widget is reinitialized or the tox is reloaded.

## Sending Python to TD — Always Write to a File

Never try to inject Python code into the TD bridge via complex inline JSON, shell escaping, or multi-line curl commands. The shell will choke on quotes, backslashes, and special characters.

- **Always write the Python script to a `.py` file first**, then send it via `cat file.py | python3 .vscode/td_send.py --file`
- For short one-liners (a single `eval` or a quick probe), inline curl is fine
- For anything more than 2-3 lines, use a file
- Keep temporary scripts in `.vscode/` (e.g. `.vscode/td_fix_ui.py`)

### Why
Shell quoting and JSON escaping are fundamentally incompatible with Python code that contains quotes, f-strings, triple-quoted blocks, backslashes, and newlines. Writing to a file eliminates an entire class of bugs and makes the code readable and reusable.

## Snapshot Before Modifying TD Nodes

Before making ANY programmatic changes to TD nodes (creating, deleting, moving, changing parameters), always snapshot the subtree you're about to modify:

```bash
python3 .vscode/td_snapshot.py --save --root /project1/MyUI --name "before-<change-description>"
```

- **Scope to the subtree** — don't snapshot the whole project if you're only changing one component
- **Name it descriptively** — `before-modal-fix`, `before-color-tweaks`, etc.
- **After changes, snapshot again** — `after-<change-description>` so the user can diff
- **If the user asks to restore**, use: `python3 .vscode/td_snapshot.py --restore "<name>" --root /project1/MyUI`
- **Never modify TD nodes without snapshoting first** — this is the user's safety net

### Why
TD has no undo for programmatic changes. The snapshot system preserves the user's manual work so it can be restored if something goes wrong. Skipping this step means potentially destroying hours of manual layout work.

## Palette Widgets: Always Direct widgetCOMP, Never Container-Wrapped

When adding a palette widget (header, label, footer, slider, button, etc.) to a container, always create it as a **direct widgetCOMP child** — never as a containerCOMP wrapper. A widget inside a container wrapper will not work correctly with the parent's panel layout, anchoring, or layer system.

Palette widget `.tox` files live at:
`/Applications/TouchDesigner.app/Contents/Resources/tfs/Samples/Palette/UI/Basic Widgets/`

Available widgets: `header`, `footer`, `label`, `sliderHorz`, `sliderVert`, `buttonMomentary`, `buttonToggle`, `fieldString`, `knobFixed`, `section`, `windowHeader`, etc.

### Correct method — "temp container + copyOPs"

```python
modal = op('/project1/MyUI/ModalDialog')
tox_path = '/Applications/TouchDesigner.app/.../Basic Widgets/header.tox'

# 1. Create a TEMP container and load the palette .tox into it
temp = modal.create(containerCOMP, 'TempHeader')
temp.par.enableexternaltox = True
temp.par.externaltox = tox_path
temp.par.enableexternaltoxpulse.pulse()

# 2. Find the inner widgetCOMP child (it has Widgettox set)
temp2 = op(f'{modal.path}/TempHeader')
inner = None
for c in temp2.children:
    if type(c).__name__ == 'widgetCOMP':
        inner = c
        break

# 3. copyOPs the inner widgetCOMP into the target parent (creates a DIRECT child)
new_ops = modal.copyOPs([inner])
header = new_ops[0]
header.name = 'Header'

# 4. Destroy the temp container
temp2.destroy()
```

### What NOT to do

- **Never load a palette `.tox` via `externaltox` on the target widgetCOMP** — this replaces it with a containerCOMP wrapper
- **Never use `loadTox()` with a palette `.tox`** — same problem: creates a container wrapper with the widget as a child
- **Never use `reload()` with a palette `.tox`** — also converts the node to a containerCOMP
- **Never change `Widgettox` and pulse `reloadbuiltin`** — this does NOT transform the widget content

### Why
Palette `.tox` files are designed for drag-and-drop from the TD palette UI, which creates a containerCOMP + inner widgetCOMP. When loaded programmatically via `externaltox`, `loadTox`, or `reload`, they always produce this wrapper structure. The `copyOPs` method copies the inner widgetCOMP as a direct child, preserving the `Widgettox` parameter and all widget internals — matching the structure of widgets created via the palette UI.