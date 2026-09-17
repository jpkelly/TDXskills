#!/usr/bin/env python3
"""TD Snapshot — save, restore, and diff TouchDesigner node state.

Usage:
    python3 td_snapshot.py --save [path] [--root /project1]
    python3 td_snapshot.py --restore <file> [--root /project1]
    python3 td_snapshot.py --diff <file> [--root /project1]
    python3 td_snapshot.py --list

Saves node positions, colors, and key parameters to JSON.
Snapshots are stored in snapshots/ and are git-friendly.
"""

import json
import sys
import os
import urllib.request
import argparse
from datetime import datetime

TD_HOST = os.environ.get("TD_BRIDGE_HOST", "127.0.0.1")
TD_PORT = int(os.environ.get("TD_BRIDGE_PORT", "9980"))

# Parameters worth saving (not every par — just the visual/functional ones)
SAVE_PAR_PATTERNS = [
    # Layout
    "x", "y", "w", "h", "layer",
    # Appearance
    "bgcolorr", "bgcolorg", "bgcolorb", "bgalpha",
    "colorr", "colorg", "colorb",
    "fontcolorr", "fontcolorg", "fontcolorb", "fontalpha",
    "fontsize", "fontsizey", "fontsizex",
    "opacity", "borderaalpha", "borderbalpha",
    "borderbr", "borderbg", "borderbb",
    "leftborder", "rightborder", "bottomborder", "topborder",
    # Text/labels
    "text", "label", "buttontype", "value0",
    # Display/enable
    "display", "enable",
    # Resolution
    "resolutionw", "resolutionh",
    # Alignment
    "alignx", "aligny", "justifyh", "justifyv",
    # Node color (network editor)
    "color",
]

# Parameters that are read-only or auto-managed and should be skipped
SKIP_PAR_NAMES = {
    "pageindex", "opviewer", "nodeview", "clone", "relpath",
    "enableexternaltox", "enableexternaltoxpulse", "externaltox",
    "savebackup", "subcompname", "loadondemand", "keepmemory",
    "enablecloning", "enablecloningpulse", "reloadcustom", "reloadbuiltin",
    "parmcolorspace", "parmreferencewhite",
}


def send_to_td(code, mode="exec"):
    """Send Python code to TD bridge and return the response."""
    payload = json.dumps({"code": code, "mode": mode}).encode("utf-8")
    req = urllib.request.Request(
        f"http://{TD_HOST}:{TD_PORT}/",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"Error: Cannot reach TD at {TD_HOST}:{TD_PORT} — {e}", file=sys.stderr)
        sys.exit(1)


def serialize_node(root_path):
    """Ask TD to serialize a node tree to a dict."""
    code = f"""
import json as _json
import sys

_result = {{}}

def _serialize(node, path):
    info = {{
        'name': node.name,
        'type': type(node).__name__,
        'path': node.path,
        'nodeX': node.nodeX,
        'nodeY': node.nodeY,
        'color': [node.color[0], node.color[1], node.color[2]] if hasattr(node, 'color') else None,
        'pars': {{}},
        'text': None,
        'children': [],
    }}
    # Save text content for DATs
    if hasattr(node, 'text') and node.isDAT:
        try:
            info['text'] = node.text
        except:
            pass
    # Save key parameters
    for p in node.pars():
        pname = p.name.lower()
        if pname in _SKIP_PAR_NAMES:
            continue
        if pname in _SAVE_PAR_NAMES:
            try:
                info['pars'][p.name] = p.eval()
            except:
                pass
    # Recurse into children
    for c in node.children:
        if hasattr(c, 'name') and hasattr(c, 'nodeX'):
            info['children'].append(_serialize(c, c.path))
    return info

_SAVE_PAR_NAMES = {SAVE_PAR_PATTERNS!r}
_SKIP_PAR_NAMES = {SKIP_PAR_NAMES!r}

_result = _json.dumps(_serialize(op({root_path!r}), {root_path!r}), indent=2, default=str)
print(_result)
"""
    resp = send_to_td(code, "exec")
    if resp.get("error"):
        print(f"TD error: {resp['error']}", file=sys.stderr)
        sys.exit(1)
    return json.loads(resp["stdout"].strip())


def restore_node(snapshot, root_path):
    """Send restore commands to TD."""
    code = f"""
import json as _json

_snapshot = _json.loads({json.dumps(snapshot, default=str)!r})

def _restore(node_info, parent_path):
    name = node_info['name']
    full_path = parent_path + '/' + name
    n = op(full_path)
    if n is None:
        print(f"WARNING: Node not found: {{full_path}}")
        return
    # Restore position
    if 'nodeX' in node_info:
        n.nodeX = node_info['nodeX']
    if 'nodeY' in node_info:
        n.nodeY = node_info['nodeY']
    # Restore color
    if node_info.get('color') and hasattr(n, 'color'):
        try:
            n.color = tuple(node_info['color'])
        except:
            pass
    # Restore text
    if node_info.get('text') is not None and hasattr(n, 'text'):
        try:
            n.text = node_info['text']
        except:
            pass
    # Restore parameters
    for pname, pval in node_info.get('pars', {{}}).items():
        try:
            par = n.par(pname)
            if par is not None:
                par.val = pval
        except:
            pass
    # Recurse
    for child_info in node_info.get('children', []):
        _restore(child_info, full_path)

_restore(_snapshot, {root_path!r})
print("Restore complete")
"""
    resp = send_to_td(code, "exec")
    if resp.get("error"):
        print(f"TD error: {resp['error']}", file=sys.stderr)
        sys.exit(1)
    print(resp["stdout"].strip())


def diff_snapshots(saved, current, path=""):
    """Compare two snapshots and print differences."""
    diffs = []
    
    def compare(saved_node, current_node, prefix):
        name = saved_node.get("name", "?")
        
        # Position changes
        if saved_node.get("nodeX") != current_node.get("nodeX") or saved_node.get("nodeY") != current_node.get("nodeY"):
            diffs.append(f"  {prefix}{name}: position ({saved_node.get('nodeX')},{saved_node.get('nodeY')}) → ({current_node.get('nodeX')},{current_node.get('nodeY')})")
        
        # Color changes
        if saved_node.get("color") != current_node.get("color"):
            diffs.append(f"  {prefix}{name}: color {saved_node.get('color')} → {current_node.get('color')}")
        
        # Parameter changes
        saved_pars = saved_node.get("pars", {})
        current_pars = current_node.get("pars", {})
        all_par_names = set(list(saved_pars.keys()) + list(current_pars.keys()))
        for pname in sorted(all_par_names):
            sv = saved_pars.get(pname)
            cv = current_pars.get(pname)
            if sv != cv:
                diffs.append(f"  {prefix}{name}.{pname}: {sv} → {cv}")
        
        # Text changes
        if saved_node.get("text") != current_node.get("text"):
            diffs.append(f"  {prefix}{name}: text changed")
        
        # Children
        saved_children = {c["name"]: c for c in saved_node.get("children", []) if "name" in c}
        current_children = {c["name"]: c for c in current_node.get("children", []) if "name" in c}
        
        for child_name in sorted(set(list(saved_children.keys()) + list(current_children.keys()))):
            if child_name not in current_children:
                diffs.append(f"  {prefix}{name}/{child_name}: REMOVED")
            elif child_name not in saved_children:
                diffs.append(f"  {prefix}{name}/{child_name}: ADDED")
            else:
                compare(saved_children[child_name], current_children[child_name], f"{prefix}{name}/")
    
    compare(saved, current, path + "/")
    return diffs


def main():
    parser = argparse.ArgumentParser(description="TD Snapshot — save/restore/diff node state")
    parser.add_argument("--save", action="store_true", help="Save current state to a snapshot file")
    parser.add_argument("--restore", metavar="FILE", help="Restore state from a snapshot file")
    parser.add_argument("--diff", metavar="FILE", help="Compare current state to a saved snapshot")
    parser.add_argument("--list", action="store_true", help="List saved snapshots")
    parser.add_argument("--root", default="/project1", help="Root node path (default: /project1)")
    parser.add_argument("--name", default=None, help="Snapshot name (default: timestamp)")
    args = parser.parse_args()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    snapshots_dir = os.path.join(repo_root, "snapshots")
    
    if args.list:
        if not os.path.isdir(snapshots_dir):
            print("No snapshots yet.")
            return
        files = sorted(f for f in os.listdir(snapshots_dir) if f.endswith(".json"))
        if not files:
            print("No snapshots yet.")
            return
        print(f"Snapshots in {snapshots_dir}/:")
        for f in files:
            size = os.path.getsize(os.path.join(snapshots_dir, f))
            print(f"  {f}  ({size} bytes)")
        return

    if args.save:
        os.makedirs(snapshots_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        name = args.name or timestamp
        filepath = os.path.join(snapshots_dir, f"{name}.json")
        data = serialize_node(args.root)
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2, default=str)
        print(f"Snapshot saved: {filepath}")
        print(f"  Root: {args.root}")
        print(f"  Nodes: {count_nodes(data)}")
        return

    if args.restore:
        if not os.path.isfile(args.restore):
            # Try as a name in snapshots dir
            candidate = os.path.join(snapshots_dir, args.restore if args.restore.endswith(".json") else f"{args.restore}.json")
            if os.path.isfile(candidate):
                args.restore = candidate
            else:
                print(f"Error: File not found: {args.restore}", file=sys.stderr)
                sys.exit(1)
        with open(args.restore) as f:
            data = json.load(f)
        print(f"Restoring from: {args.restore}")
        restore_node(data, args.root)
        return

    if args.diff:
        if not os.path.isfile(args.diff):
            candidate = os.path.join(snapshots_dir, args.diff if args.diff.endswith(".json") else f"{args.diff}.json")
            if os.path.isfile(candidate):
                args.diff = candidate
            else:
                print(f"Error: File not found: {args.diff}", file=sys.stderr)
                sys.exit(1)
        with open(args.diff) as f:
            saved = json.load(f)
        current = serialize_node(args.root)
        diffs = diff_snapshots(saved, current, args.root)
        if not diffs:
            print("No differences — current state matches snapshot.")
        else:
            print(f"Differences from {args.diff}:")
            for d in diffs:
                print(d)
        return

    parser.print_help()


def count_nodes(data):
    """Count total nodes in a snapshot tree."""
    count = 1
    for child in data.get("children", []):
        count += count_nodes(child)
    return count


if __name__ == "__main__":
    main()