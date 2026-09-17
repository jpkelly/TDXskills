import * as vscode from 'vscode';
import { Buffer } from 'buffer';
import { TDBridgeClient } from './bridgeClient';

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

    // Auto-connect if configured
    if (vscode.workspace.getConfiguration('tdBridge').get<boolean>('autoConnect', false)) {
        vscode.commands.executeCommand('tdBridge.connect');
    }
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