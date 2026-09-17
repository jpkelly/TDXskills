# ═══════════════════════════════════════════════════════════════════
# TouchDesigner Bridge Server — Text DAT
# ═══════════════════════════════════════════════════════════════════
# Paste this entire script into a Text DAT in TouchDesigner.
# Then right-click the DAT → "Run" or pulse the "Run" parameter.
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
                if b'\r\n\r\n' in data:
                    # Check if we have the full body
                    header_end = data.index(b'\r\n\r\n') + 4
                    headers = data[:header_end].decode('utf-8', errors='replace')
                    content_length = 0
                    for line in headers.split('\r\n'):
                        if line.lower().startswith('content-length:'):
                            content_length = int(line.split(':')[1].strip())
                    body = data[header_end:]
                    if len(body) >= content_length:
                        break

            # Parse body
            header_end = data.index(b'\r\n\r\n') + 4
            body = data[header_end:]
            payload = json.loads(body.decode('utf-8'))

            code = payload.get('code', '')
            mode = payload.get('mode', 'exec')

            # Capture stdout (Textport output)
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
                f'HTTP/1.1 200 OK\r\n'
                f'Content-Type: application/json\r\n'
                f'Content-Length: {len(resp_json)}\r\n'
                f'Access-Control-Allow-Origin: *\r\n'
                f'Connection: close\r\n'
                f'\r\n'
            ).encode('utf-8')
            conn.sendall(resp_headers + resp_json)

        except Exception as e:
            try:
                err_resp = json.dumps({'stdout': '', 'result': '', 'error': str(e)}).encode('utf-8')
                resp = (
                    f'HTTP/1.1 500 Internal Server Error\r\n'
                    f'Content-Type: application/json\r\n'
                    f'Content-Length: {len(err_resp)}\r\n'
                    f'\r\n'
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