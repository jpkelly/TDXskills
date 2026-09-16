import * as vscode from 'vscode';
import { TDBridgeClient } from './bridgeClient';

let bridgeClient: TDBridgeClient | undefined;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('TouchDesigner Bridge');
    context.subscriptions.push(outputChannel);

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
            const config = vscode.workspace.getConfiguration('tdBridge');
            const host = config.get<string>('host', '127.0.0.1');
            const port = config.get<number>('port', 9980);

            bridgeClient = new TDBridgeClient(host, port);
            updateStatusBar('connecting');

            try {
                const result = await bridgeClient.testConnection();
                if (result.connected) {
                    updateStatusBar('connected');
                    outputChannel.appendLine(`[Connected] TouchDesigner at ${host}:${port}`);
                    outputChannel.appendLine(`  TD version: ${result.version || 'unknown'}`);
                    outputChannel.appendLine(`  Python: ${result.python || 'unknown'}`);
                    outputChannel.show(true);
                    vscode.window.showInformationMessage(`TouchDesigner Bridge: Connected (${result.version || 'TD'})`);
                }
            } catch (err) {
                updateStatusBar('disconnected');
                const msg = err instanceof Error ? err.message : String(err);
                outputChannel.appendLine(`[Connection failed] ${msg}`);
                outputChannel.show(true);
                const action = await vscode.window.showErrorMessage(
                    `Cannot reach TouchDesigner at ${host}:${port}. Is the bridge running?`,
                    'Retry',
                    'Show Setup'
                );
                if (action === 'Retry') {
                    vscode.commands.executeCommand('tdBridge.connect');
                } else if (action === 'Show Setup') {
                    vscode.commands.executeCommand('tdBridge.generateBridge');
                }
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

    // --- Generate Bridge Component (outputs TD Python to a new editor) ---
    context.subscriptions.push(
        vscode.commands.registerCommand('tdBridge.generateBridge', async () => {
            const bridgeCode = getBridgePythonCode();
            const doc = await vscode.workspace.openTextDocument({
                content: bridgeCode,
                language: 'python'
            });
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(
                'Paste this into a Text DAT in TouchDesigner, then pulse the "Start" parameter. See README for details.'
            );
        })
    );

    // Auto-connect if configured
    if (vscode.workspace.getConfiguration('tdBridge').get<boolean>('autoConnect', false)) {
        vscode.commands.executeCommand('tdBridge.connect');
    }
}

async function sendCode(code: string, mode: 'line' | 'selection' | 'file' | 'eval'): Promise<void> {
    // Ensure we have a client — try to connect if not
    if (!bridgeClient) {
        const config = vscode.workspace.getConfiguration('tdBridge');
        const host = config.get<string>('host', '127.0.0.1');
        const port = config.get<number>('port', 9980);
        bridgeClient = new TDBridgeClient(host, port);
        try {
            await bridgeClient.testConnection();
            updateStatusBar('connected');
        } catch {
            updateStatusBar('disconnected');
            const action = await vscode.window.showErrorMessage(
                'Not connected to TouchDesigner. Connect first?',
                'Connect',
                'Generate Bridge'
            );
            if (action === 'Connect') {
                await vscode.commands.executeCommand('tdBridge.connect');
                if (!bridgeClient) return;
            } else if (action === 'Generate Bridge') {
                await vscode.commands.executeCommand('tdBridge.generateBridge');
                return;
            } else {
                bridgeClient = undefined;
                return;
            }
        }
    }

    const modeLabel = mode === 'eval' ? 'eval' : 'exec';
    const modeTag = mode === 'file' ? 'FILE' : mode === 'selection' ? 'SEL' : mode === 'eval' ? 'EVAL' : 'LINE';

    outputChannel.appendLine(`>>> [${modeTag}] ${code.split('\n').length} line(s) sent`);
    outputChannel.show(true);

    try {
        const response = await bridgeClient!.execute(code, mode === 'eval');
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

// ─── TD Bridge Python code (generated for the user) ───────────────────────
function getBridgePythonCode(): string {
    return `# ═══════════════════════════════════════════════════════════════════
# TouchDesigner Bridge Server — Text DAT
# ═══════════════════════════════════════════════════════════════════
# Paste this entire script into a Text DAT in TouchDesigner.
# Then create a pulse parameter (or just run the DAT) to call onStart().
# The server listens on 127.0.0.1:9980 and accepts JSON POST requests
# with {"code": "...", "mode": "exec"|"eval"}.
#
# Usage from VS Code: use the "TD Bridge" extension commands.
# ═══════════════════════════════════════════════════════════════════

import socket
import json
import sys
import io
import traceback
import threading

_server = None

def onStart():
    """Call this from a Pulse parameter or DAT Execute to start the server."""
    global _server
    if _server is not None:
        print('[TD Bridge] Server already running')
        return
    _server = BridgeServer(host='127.0.0.1', port=9980)
    _server.start()
    print('[TD Bridge] Listening on 127.0.0.1:9980')

def onStop():
    """Call this to stop the server."""
    global _server
    if _server is not None:
        _server.stop()
        _server = None
        print('[TD Bridge] Server stopped')

class BridgeServer:
    def __init__(self, host='127.0.0.1', port=9980):
        self.host = host
        self.port = port
        self._sock = None
        self._running = False
        self._thread = None

    def start(self):
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind((self.host, self.port))
        self._sock.listen(5)
        self._sock.settimeout(0.5)
        self._running = True
        self._thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._sock:
            try:
                self._sock.close()
            except:
                pass

    def _accept_loop(self):
        while self._running:
            try:
                conn, addr = self._sock.accept()
                threading.Thread(target=self._handle, args=(conn,), daemon=True).start()
            except socket.timeout:
                continue
            except OSError:
                break

    def _handle(self, conn):
        try:
            # Read the full request
            data = b''
            conn.settimeout(5.0)
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                data += chunk
                if b'\\r\\n\\r\\n' in data:
                    # Check if we have the full body
                    header_end = data.index(b'\\r\\n\\r\\n') + 4
                    headers = data[:header_end].decode('utf-8', errors='replace')
                    content_length = 0
                    for line in headers.split('\\r\\n'):
                        if line.lower().startswith('content-length:'):
                            content_length = int(line.split(':')[1].strip())
                    body = data[header_end:]
                    if len(body) >= content_length:
                        break

            # Parse body
            header_end = data.index(b'\\r\\n\\r\\n') + 4
            body = data[header_end:]
            payload = json.loads(body.decode('utf-8'))

            code = payload.get('code', '')
            mode = payload.get('mode', 'exec')

            # Capture stdout
            old_stdout = sys.stdout
            captured = io.StringIO()
            sys.stdout = captured

            result = None
            error = None

            try:
                if mode == 'eval':
                    result = eval(code, globals())
                else:
                    exec(code, globals())
            except Exception as e:
                error = traceback.format_exc().strip()

            sys.stdout = old_stdout
            stdout_text = captured.getvalue()

            # Prepare response
            response = {
                'stdout': stdout_text,
                'result': repr(result) if result is not None else '',
                'error': error,
            }

            resp_json = json.dumps(response).encode('utf-8')
            resp_headers = (
                f'HTTP/1.1 200 OK\\r\\n'
                f'Content-Type: application/json\\r\\n'
                f'Content-Length: {len(resp_json)}\\r\\n'
                f'Access-Control-Allow-Origin: *\\r\\n'
                f'Connection: close\\r\\n'
                f'\\r\\n'
            ).encode('utf-8')
            conn.sendall(resp_headers + resp_json)

        except Exception as e:
            try:
                err_resp = json.dumps({'stdout': '', 'result': '', 'error': str(e)}).encode('utf-8')
                resp = (
                    f'HTTP/1.1 500 Internal Server Error\\r\\n'
                    f'Content-Type: application/json\\r\\n'
                    f'Content-Length: {len(err_resp)}\\r\\n'
                    f'\\r\\n'
                ).encode('utf-8') + err_resp
                conn.sendall(resp)
            except:
                pass
        finally:
            try:
                conn.close()
            except:
                pass

# Auto-start when this DAT is run / pulsed
onStart()
`;
}