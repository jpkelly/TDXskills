import * as vscode from 'vscode';
import { Buffer } from 'buffer';
import { TDBridgeClient } from './bridgeClient';
import { TDNodeSnapshot, countNodes, diffSnapshots, restoreNode, serializeNode } from './snapshot';

let bridgeClient: TDBridgeClient | undefined;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem | undefined;
let extensionUri: vscode.Uri;

function createClient(): TDBridgeClient {
    const config = vscode.workspace.getConfiguration('tdBridge');
    return new TDBridgeClient(
        config.get<string>('host', '127.0.0.1'),
        config.get<number>('port', 9980),
        config.get<number>('timeout', 10000)
    );
}

export function activate(context: vscode.ExtensionContext) {
    extensionUri = context.extensionUri;
    outputChannel = vscode.window.createOutputChannel('TouchDesigner Bridge');
    context.subscriptions.push(outputChannel);

    // A stale client would keep talking to the old host/port.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('tdBridge.host') || e.affectsConfiguration('tdBridge.port') || e.affectsConfiguration('tdBridge.timeout')) {
                bridgeClient = undefined;
                updateStatusBar('disconnected');
            }
        })
    );

    // Status bar item
    const showStatusBar = vscode.workspace.getConfiguration('tdBridge').get<boolean>('showStatusBar', true);
    if (showStatusBar) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.command = 'tdBridge.connect';
        statusBarItem.text = '$(debug-disconnect) TD: Disconnected';
        statusBarItem.tooltip = 'Click to connect to TouchDesigner';
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);
    }

    // --- Connect ---
    context.subscriptions.push(
        vscode.commands.registerCommand('tdBridge.connect', async () => {
            const client = createClient();
            updateStatusBar('connecting');

            try {
                const result = await client.testConnection();
                bridgeClient = client;
                updateStatusBar('connected');
                outputChannel.appendLine(`[Connected] TouchDesigner at ${client.endpoint}`);
                outputChannel.appendLine(`  ${result.product || 'TouchDesigner'} ${result.version || '(version unknown)'}`);
                outputChannel.appendLine(`  Python: ${result.python || 'unknown'}`);
                outputChannel.appendLine('');
                vscode.window.showInformationMessage(
                    `TouchDesigner Bridge: Connected — ${result.product || 'TouchDesigner'} ${result.version || ''}`.trim()
                );
            } catch (err) {
                bridgeClient = undefined;
                updateStatusBar('disconnected');
                await reportConnectionFailure(err, client.endpoint);
            }
        })
    );

    // --- Disconnect ---
    context.subscriptions.push(
        vscode.commands.registerCommand('tdBridge.disconnect', () => {
            bridgeClient = undefined;
            updateStatusBar('disconnected');
            outputChannel.appendLine('[Disconnected]');
            vscode.window.showInformationMessage('TouchDesigner Bridge: Disconnected');
        })
    );

    // --- Send Selection ---
    context.subscriptions.push(
        vscode.commands.registerCommand('tdBridge.sendSelection', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            const code = editor.selection.isEmpty
                ? editor.document.lineAt(editor.selection.active.line).text
                : editor.document.getText(editor.selection);

            if (!code.trim()) {
                vscode.window.showWarningMessage('Nothing to send — select code or place cursor on a line');
                return;
            }

            await sendCode(code, editor.selection.isEmpty ? 'line' : 'selection');
        })
    );

    // --- Send Current Line ---
    context.subscriptions.push(
        vscode.commands.registerCommand('tdBridge.sendLine', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const line = editor.document.lineAt(editor.selection.active.line).text;
            if (!line.trim()) return;
            await sendCode(line, 'line');
        })
    );

    // --- Send File ---
    context.subscriptions.push(
        vscode.commands.registerCommand('tdBridge.sendFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }
            const code = editor.document.getText();
            if (!code.trim()) return;
            await sendCode(code, 'file');
        })
    );

    // --- Evaluate Expression ---
    context.subscriptions.push(
        vscode.commands.registerCommand('tdBridge.evalExpression', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }
            const code = editor.selection.isEmpty
                ? editor.document.lineAt(editor.selection.active.line).text
                : editor.document.getText(editor.selection);
            if (!code.trim()) return;
            await sendCode(code, 'eval');
        })
    );

    // --- Generate Bridge Callback (opens the Web Server DAT callback code) ---
    context.subscriptions.push(
        vscode.commands.registerCommand('tdBridge.generateBridge', async () => {
            const port = vscode.workspace.getConfiguration('tdBridge').get<number>('port', 9980);
            const doc = await vscode.workspace.openTextDocument({
                content: await getBridgePythonCode(),
                language: 'python'
            });
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(
                `Save this file, then in TouchDesigner create a Web Server DAT with Port ${port} ` +
                'and point its "Callbacks DAT" at the saved file (sync on).'
            );
        })
    );

    registerSnapshotCommands(context);
    registerMcpServer(context);

    // Auto-connect if configured
    if (vscode.workspace.getConfiguration('tdBridge').get<boolean>('autoConnect', false)) {
        vscode.commands.executeCommand('tdBridge.connect');
    }
}

// ─── MCP ─────────────────────────────────────────────────────────────────

function registerMcpServer(context: vscode.ExtensionContext): void {
    const didChange = new vscode.EventEmitter<void>();
    context.subscriptions.push(didChange);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (
                e.affectsConfiguration('tdBridge.host') ||
                e.affectsConfiguration('tdBridge.port') ||
                e.affectsConfiguration('tdBridge.enableMcpServer')
            ) {
                didChange.fire();
            }
        })
    );

    context.subscriptions.push(
        vscode.lm.registerMcpServerDefinitionProvider('tdx-skills.td-bridge', {
            onDidChangeMcpServerDefinitions: didChange.event,
            provideMcpServerDefinitions: () => {
                const config = vscode.workspace.getConfiguration('tdBridge');
                if (!config.get<boolean>('enableMcpServer', true)) {
                    return [];
                }

                const server = vscode.Uri.joinPath(context.extensionUri, 'out', 'mcp', 'server.mjs').fsPath;

                return [
                    new vscode.McpStdioServerDefinition(
                        'TouchDesigner Bridge',
                        // Electron-as-node avoids depending on `node` being on PATH.
                        process.execPath,
                        [server],
                        {
                            ELECTRON_RUN_AS_NODE: '1',
                            TD_BRIDGE_HOST: config.get<string>('host', '127.0.0.1'),
                            TD_BRIDGE_PORT: String(config.get<number>('port', 9980)),
                        },
                        context.extension.packageJSON.version
                    ),
                ];
            },
        })
    );
}

// ─── Snapshots ───────────────────────────────────────────────────────────

function snapshotDir(): vscode.Uri | undefined {
    const configured = vscode.workspace.getConfiguration('tdBridge').get<string>('snapshotDir', '').trim();
    if (configured) {
        return vscode.Uri.file(configured);
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? vscode.Uri.joinPath(folder.uri, 'snapshots') : undefined;
}

async function listSnapshotFiles(): Promise<vscode.Uri[]> {
    const dir = snapshotDir();
    if (!dir) {
        return [];
    }
    try {
        const entries = await vscode.workspace.fs.readDirectory(dir);
        return entries
            .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
            .map(([name]) => vscode.Uri.joinPath(dir, name))
            .sort((a, b) => a.path.localeCompare(b.path));
    } catch {
        return [];
    }
}

async function pickSnapshot(placeHolder: string): Promise<{ uri: vscode.Uri; data: TDNodeSnapshot } | undefined> {
    const files = await listSnapshotFiles();
    if (files.length === 0) {
        vscode.window.showWarningMessage(`No snapshots found in ${snapshotDir()?.fsPath ?? 'the snapshot folder'}.`);
        return undefined;
    }

    const picked = await vscode.window.showQuickPick(
        files.map((uri) => ({ label: uri.path.split('/').pop()!.replace(/\.json$/, ''), uri })),
        { placeHolder }
    );
    if (!picked) {
        return undefined;
    }

    const bytes = await vscode.workspace.fs.readFile(picked.uri);
    return { uri: picked.uri, data: JSON.parse(Buffer.from(bytes).toString('utf8')) as TDNodeSnapshot };
}

async function requireClient(): Promise<TDBridgeClient | undefined> {
    if (bridgeClient) {
        return bridgeClient;
    }
    const client = createClient();
    updateStatusBar('connecting');
    try {
        await client.testConnection();
        bridgeClient = client;
        updateStatusBar('connected');
        return client;
    } catch (err) {
        updateStatusBar('disconnected');
        await reportConnectionFailure(err, client.endpoint);
        return undefined;
    }
}

function registerSnapshotCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('tdBridge.snapshotSave', async () => {
            const dir = snapshotDir();
            if (!dir) {
                vscode.window.showErrorMessage('Open a folder, or set tdBridge.snapshotDir, before saving snapshots.');
                return;
            }

            const root = await vscode.window.showInputBox({
                prompt: 'Node path to capture',
                value: context.workspaceState.get<string>('tdBridge.lastRoot', '/project1'),
                validateInput: (v) => (v.startsWith('/') ? undefined : 'Path must be absolute, e.g. /project1'),
            });
            if (!root) {
                return;
            }

            const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
            const name = await vscode.window.showInputBox({ prompt: 'Snapshot name', value: stamp });
            if (!name) {
                return;
            }

            const client = await requireClient();
            if (!client) {
                return;
            }

            try {
                const data = await serializeNode(client, root);
                const target = vscode.Uri.joinPath(dir, `${name}.json`);
                await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(data, null, 2), 'utf8'));
                await context.workspaceState.update('tdBridge.lastRoot', root);

                outputChannel.appendLine(`[Snapshot] saved ${target.fsPath}`);
                outputChannel.appendLine(`  Root: ${root}   Nodes: ${countNodes(data)}`);
                outputChannel.appendLine('');
                vscode.window.showInformationMessage(`Snapshot "${name}" saved — ${countNodes(data)} nodes from ${root}.`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                outputChannel.appendLine(`[Snapshot ERROR] ${msg}`);
                outputChannel.show(true);
                vscode.window.showErrorMessage(`Snapshot failed: ${msg}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tdBridge.snapshotRestore', async () => {
            const picked = await pickSnapshot('Snapshot to restore');
            if (!picked) {
                return;
            }

            const target = await vscode.window.showInputBox({
                prompt: 'Restore into which node path?',
                value: picked.data.path,
                validateInput: (v) => (v.startsWith('/') ? undefined : 'Path must be absolute, e.g. /project1'),
            });
            if (!target) {
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Restore ${countNodes(picked.data)} nodes into ${target}? This overwrites current positions, colours, parameters and DAT text.`,
                { modal: true },
                'Restore'
            );
            if (confirm !== 'Restore') {
                return;
            }

            const client = await requireClient();
            if (!client) {
                return;
            }

            try {
                const result = await restoreNode(client, picked.data, target);
                outputChannel.appendLine(`[Snapshot] restored ${result.restored} node(s) into ${target}`);
                for (const missing of result.missing) {
                    outputChannel.appendLine(`  missing: ${missing}`);
                }
                outputChannel.appendLine('');
                if (result.missing.length > 0) {
                    outputChannel.show(true);
                    vscode.window.showWarningMessage(
                        `Restored ${result.restored} node(s); ${result.missing.length} not found. See the output channel.`
                    );
                } else {
                    vscode.window.showInformationMessage(`Restored ${result.restored} node(s) into ${target}.`);
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                outputChannel.appendLine(`[Snapshot ERROR] ${msg}`);
                outputChannel.show(true);
                vscode.window.showErrorMessage(`Restore failed: ${msg}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tdBridge.snapshotDiff', async () => {
            const picked = await pickSnapshot('Snapshot to compare against');
            if (!picked) {
                return;
            }

            const client = await requireClient();
            if (!client) {
                return;
            }

            try {
                const current = await serializeNode(client, picked.data.path);
                const diffs = diffSnapshots(picked.data, current);

                outputChannel.appendLine(`[Snapshot] diff against ${picked.uri.fsPath}`);
                if (diffs.length === 0) {
                    outputChannel.appendLine('  no differences');
                } else {
                    for (const d of diffs) {
                        outputChannel.appendLine(`  ${d}`);
                    }
                }
                outputChannel.appendLine('');
                outputChannel.show(true);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                outputChannel.appendLine(`[Snapshot ERROR] ${msg}`);
                outputChannel.show(true);
                vscode.window.showErrorMessage(`Diff failed: ${msg}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tdBridge.snapshotList', async () => {
            const dir = snapshotDir();
            const files = await listSnapshotFiles();

            outputChannel.appendLine(`[Snapshot] ${dir?.fsPath ?? '(no folder)'}`);
            if (files.length === 0) {
                outputChannel.appendLine('  no snapshots yet');
            } else {
                for (const uri of files) {
                    const stat = await vscode.workspace.fs.stat(uri);
                    outputChannel.appendLine(`  ${uri.path.split('/').pop()}  (${stat.size} bytes)`);
                }
            }
            outputChannel.appendLine('');
            outputChannel.show(true);
        })
    );
}

async function reportConnectionFailure(err: unknown, endpoint: string): Promise<void> {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[Connection failed] ${msg}`);
    outputChannel.appendLine('');
    outputChannel.show(true);

    const action = await vscode.window.showErrorMessage(
        `Cannot reach TouchDesigner at ${endpoint}. Is the Web Server DAT active?`,
        'Retry',
        'Show Bridge Code'
    );
    if (action === 'Retry') {
        await vscode.commands.executeCommand('tdBridge.connect');
    } else if (action === 'Show Bridge Code') {
        await vscode.commands.executeCommand('tdBridge.generateBridge');
    }
}

async function sendCode(code: string, mode: 'line' | 'selection' | 'file' | 'eval'): Promise<void> {
    // Lazy connect: the first send doubles as the connection attempt.
    if (!bridgeClient) {
        const client = createClient();
        updateStatusBar('connecting');
        try {
            await client.testConnection();
            bridgeClient = client;
            updateStatusBar('connected');
        } catch (err) {
            updateStatusBar('disconnected');
            await reportConnectionFailure(err, client.endpoint);
            return;
        }
    }

    const modeTag = mode === 'file' ? 'FILE' : mode === 'selection' ? 'SEL' : mode === 'eval' ? 'EVAL' : 'LINE';

    outputChannel.appendLine(`>>> [${modeTag}] ${code.split('\n').length} line(s) sent`);
    outputChannel.show(true);

    try {
        const response = await bridgeClient!.execute(code, mode === 'eval' ? 'eval' : 'auto');
        if (response.stdout) {
            outputChannel.appendLine(response.stdout.trimEnd());
        }
        if (response.result !== undefined && response.result !== null && response.result !== '') {
            outputChannel.appendLine(`=> ${response.result}`);
        }
        if (response.error) {
            outputChannel.appendLine(`[ERROR] ${response.error}`);
        }
        outputChannel.appendLine(''); // blank line separator
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine(`[ERROR] ${msg}`);
        outputChannel.show(true);
        updateStatusBar('disconnected');
        bridgeClient = undefined;
    }
}

function updateStatusBar(state: 'connected' | 'disconnected' | 'connecting'): void {
    if (!statusBarItem) return;
    switch (state) {
        case 'connected':
            statusBarItem.text = '$(debug-start) TD: Connected';
            statusBarItem.tooltip = 'TouchDesigner Bridge: Connected — click to disconnect';
            statusBarItem.command = 'tdBridge.disconnect';
            statusBarItem.backgroundColor = undefined;
            break;
        case 'connecting':
            statusBarItem.text = '$(loading~spin) TD: Connecting...';
            statusBarItem.tooltip = 'Connecting to TouchDesigner...';
            break;
        case 'disconnected':
            statusBarItem.text = '$(debug-disconnect) TD: Disconnected';
            statusBarItem.tooltip = 'TouchDesigner Bridge: Disconnected — click to connect';
            statusBarItem.command = 'tdBridge.connect';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            break;
    }
}

export function deactivate() {
    bridgeClient = undefined;
}

// ─── TD Bridge callback code (shipped as an extension resource) ───────────
async function getBridgePythonCode(): Promise<string> {
    const resource = vscode.Uri.joinPath(extensionUri, 'resources', 'td_bridge_webserver.py');
    const bytes = await vscode.workspace.fs.readFile(resource);
    return Buffer.from(bytes).toString('utf8');
}