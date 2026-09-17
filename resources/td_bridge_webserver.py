# ═══════════════════════════════════════════════════════════════════
# TD Bridge — Web Server DAT Callbacks
# ═══════════════════════════════════════════════════════════════════
# SETUP (takes 30 seconds):
#   1. In TD, press Tab → type "Web Server" → create a Web Server DAT
#   2. Set its "Port" parameter to 9981 (or any free port)
#   3. Set the "Callbacks DAT" parameter to link to this file
#   4. The server starts automatically
#
# From VS Code: select Python code, run the "TD Bridge: Send Selection" task
# ═══════════════════════════════════════════════════════════════════

import json
import io
import traceback

# Store references to stdlib modules under private names so they can't be
# clobbered by user code exec'd in globals() (e.g. `sys = op('/sys')`)
_sys = __import__('sys')

def onHTTPRequest(webServerDAT, request, response):
    """Called by the Web Server DAT on TD's main thread. Safe to use op()."""
    # Restore sys in globals in case user code overwrote it
    globals()['sys'] = _sys
    try:
        # Request body is in request['data'] (bytes)
        body = request.get('data', b'')
        if isinstance(body, bytes):
            body_str = body.decode('utf-8')
        else:
            body_str = str(body)

        payload = json.loads(body_str)
        code = payload.get('code', '')
        mode = payload.get('mode', 'exec')

        # Capture stdout — use _sys (private ref) so user code can't break this
        old_stdout = _sys.stdout
        captured = io.StringIO()
        _sys.stdout = captured

        result = None
        error = None

        try:
            if mode == 'eval':
                result = eval(code, globals())
            else:
                exec(code, globals())
        except Exception:
            error = traceback.format_exc().strip()

        _sys.stdout = old_stdout
        stdout_text = captured.getvalue()

        response_data = {
            'stdout': stdout_text,
            'result': repr(result) if result is not None else '',
            'error': error,
        }

        response['statusCode'] = 200
        response['statusReason'] = 'OK'
        response['Content-Type'] = 'application/json'
        response['data'] = json.dumps(response_data)

    except Exception as e:
        err_data = json.dumps({'stdout': '', 'result': '', 'error': str(e)})
        response['statusCode'] = 500
        response['statusReason'] = 'Internal Server Error'
        response['Content-Type'] = 'application/json'
        response['data'] = err_data

    return response