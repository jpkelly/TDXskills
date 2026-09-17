import { TDBridgeClient } from './bridgeClient';

export interface TDNodeSnapshot {
    name: string;
    type: string;
    path: string;
    nodeX: number;
    nodeY: number;
    color: number[] | null;
    pars: Record<string, unknown>;
    text: string | null;
    children: TDNodeSnapshot[];
}

/** Visual/functional parameters worth capturing — not every par on a node. */
const SAVE_PAR_NAMES = [
    'x', 'y', 'w', 'h', 'layer',
    'bgcolorr', 'bgcolorg', 'bgcolorb', 'bgalpha',
    'colorr', 'colorg', 'colorb',
    'fontcolorr', 'fontcolorg', 'fontcolorb', 'fontalpha',
    'fontsize', 'fontsizey', 'fontsizex',
    'opacity', 'borderaalpha', 'borderbalpha',
    'borderbr', 'borderbg', 'borderbb',
    'leftborder', 'rightborder', 'bottomborder', 'topborder',
    'text', 'label', 'buttontype', 'value0',
    'display', 'enable',
    'resolutionw', 'resolutionh',
    'alignx', 'aligny', 'justifyh', 'justifyv',
    'color',
];

/** Read-only or auto-managed parameters that must never be written back. */
const SKIP_PAR_NAMES = [
    'pageindex', 'opviewer', 'nodeview', 'clone', 'relpath',
    'enableexternaltox', 'enableexternaltoxpulse', 'externaltox',
    'savebackup', 'subcompname', 'loadondemand', 'keepmemory',
    'enablecloning', 'enablecloningpulse', 'reloadcustom', 'reloadbuiltin',
    'parmcolorspace', 'parmreferencewhite',
];

/**
 * JSON string syntax is a subset of Python's, so a JSON-encoded string is a
 * safe Python literal. This is what keeps the old double-encoding bug away.
 */
function pyLiteral(value: string): string {
    return JSON.stringify(value);
}

function buildSerializeCode(rootPath: string): string {
    return `
import json as _json

_SAVE_PARS = set(_json.loads(${pyLiteral(JSON.stringify(SAVE_PAR_NAMES))}))
_SKIP_PARS = set(_json.loads(${pyLiteral(JSON.stringify(SKIP_PAR_NAMES))}))

def _tdx_serialize(node):
    info = {
        'name': node.name,
        'type': type(node).__name__,
        'path': node.path,
        'nodeX': node.nodeX,
        'nodeY': node.nodeY,
        'color': [node.color[0], node.color[1], node.color[2]] if hasattr(node, 'color') else None,
        'pars': {},
        'text': None,
        'children': [],
    }
    if hasattr(node, 'text') and node.isDAT:
        try:
            info['text'] = node.text
        except Exception:
            pass
    for p in node.pars():
        pname = p.name.lower()
        if pname in _SKIP_PARS:
            continue
        if pname in _SAVE_PARS:
            try:
                info['pars'][p.name] = p.eval()
            except Exception:
                pass
    for c in node.children:
        if hasattr(c, 'name') and hasattr(c, 'nodeX'):
            info['children'].append(_tdx_serialize(c))
    return info

_tdx_root = op(${pyLiteral(rootPath)})
if _tdx_root is None:
    raise ValueError('Node not found: ' + ${pyLiteral(rootPath)})
print(_json.dumps(_tdx_serialize(_tdx_root), default=str))
`;
}

function buildRestoreCode(snapshot: TDNodeSnapshot, targetPath: string): string {
    return `
import json as _json

_tdx_snap = _json.loads(${pyLiteral(JSON.stringify(snapshot))})
_tdx_missing = []
_tdx_applied = [0]

def _tdx_restore(info, path):
    n = op(path)
    if n is None:
        _tdx_missing.append(path)
        return
    if 'nodeX' in info:
        n.nodeX = info['nodeX']
    if 'nodeY' in info:
        n.nodeY = info['nodeY']
    if info.get('color') and hasattr(n, 'color'):
        try:
            n.color = tuple(info['color'])
        except Exception:
            pass
    if info.get('text') is not None and hasattr(n, 'text'):
        try:
            n.text = info['text']
        except Exception:
            pass
    for pname, pval in info.get('pars', {}).items():
        try:
            par = getattr(n.par, pname, None)
            if par is not None:
                par.val = pval
        except Exception:
            pass
    _tdx_applied[0] += 1
    for child in info.get('children', []):
        _tdx_restore(child, path + '/' + child['name'])

_tdx_restore(_tdx_snap, ${pyLiteral(targetPath)})
print(_json.dumps({'restored': _tdx_applied[0], 'missing': _tdx_missing}))
`;
}

export async function serializeNode(client: TDBridgeClient, rootPath: string): Promise<TDNodeSnapshot> {
    const resp = await client.execute(buildSerializeCode(rootPath), 'exec');
    if (resp.error) {
        throw new Error(resp.error);
    }
    return JSON.parse(resp.stdout.trim()) as TDNodeSnapshot;
}

export interface RestoreResult {
    restored: number;
    missing: string[];
}

export async function restoreNode(
    client: TDBridgeClient,
    snapshot: TDNodeSnapshot,
    targetPath: string
): Promise<RestoreResult> {
    const resp = await client.execute(buildRestoreCode(snapshot, targetPath), 'exec');
    if (resp.error) {
        throw new Error(resp.error);
    }
    return JSON.parse(resp.stdout.trim()) as RestoreResult;
}

export function countNodes(node: TDNodeSnapshot): number {
    return 1 + (node.children || []).reduce((sum, c) => sum + countNodes(c), 0);
}

export function diffSnapshots(saved: TDNodeSnapshot, current: TDNodeSnapshot): string[] {
    const diffs: string[] = [];

    const compare = (a: TDNodeSnapshot, b: TDNodeSnapshot, prefix: string) => {
        const label = prefix + a.name;

        if (a.nodeX !== b.nodeX || a.nodeY !== b.nodeY) {
            diffs.push(`${label}: position (${a.nodeX},${a.nodeY}) -> (${b.nodeX},${b.nodeY})`);
        }
        if (JSON.stringify(a.color) !== JSON.stringify(b.color)) {
            diffs.push(`${label}: color ${JSON.stringify(a.color)} -> ${JSON.stringify(b.color)}`);
        }

        const aPars = a.pars || {};
        const bPars = b.pars || {};
        for (const pname of [...new Set([...Object.keys(aPars), ...Object.keys(bPars)])].sort()) {
            if (JSON.stringify(aPars[pname]) !== JSON.stringify(bPars[pname])) {
                diffs.push(`${label}.${pname}: ${aPars[pname]} -> ${bPars[pname]}`);
            }
        }

        if (a.text !== b.text) {
            diffs.push(`${label}: text changed`);
        }

        const aKids = new Map((a.children || []).map((c) => [c.name, c]));
        const bKids = new Map((b.children || []).map((c) => [c.name, c]));
        for (const name of [...new Set([...aKids.keys(), ...bKids.keys()])].sort()) {
            const inA = aKids.get(name);
            const inB = bKids.get(name);
            if (!inB) {
                diffs.push(`${label}/${name}: REMOVED`);
            } else if (!inA) {
                diffs.push(`${label}/${name}: ADDED`);
            } else {
                compare(inA, inB, `${label}/`);
            }
        }
    };

    compare(saved, current, '');
    return diffs;
}
