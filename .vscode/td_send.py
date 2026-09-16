#!/usr/bin/env python3
"""TD Bridge sender — reads the active editor's selection/file and sends it to TouchDesigner.

Usage:
    python3 td_send.py --selection    # send selected text (or current line)
    python3 td_send.py --file         # send entire file

In VS Code, this is invoked via tasks.json. The selected text is passed
via stdin. The response from TD is pretty-printed to stdout.
"""

import sys
import json
import urllib.request
import argparse
import os

TD_HOST = os.environ.get("TD_BRIDGE_HOST", "127.0.0.1")
TD_PORT = int(os.environ.get("TD_BRIDGE_PORT", "9980"))


def send_code(code: str, mode: str = "exec") -> dict:
    payload = json.dumps({"code": code, "mode": mode}).encode("utf-8")
    url = f"http://{TD_HOST}:{TD_PORT}/"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as e:
        return {"stdout": "", "result": "", "error": f"Cannot reach TD at {TD_HOST}:{TD_PORT} — {e.reason}"}
    except Exception as e:
        return {"stdout": "", "result": "", "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Send Python to TouchDesigner")
    parser.add_argument("--selection", action="store_true", help="Send selection from stdin")
    parser.add_argument("--file", action="store_true", help="Send file from stdin")
    args = parser.parse_args()

    # Read code from stdin (VS Code passes selected text or file content here)
    code = sys.stdin.read().strip()
    if not code:
        print("No code to send.")
        return

    # If it's a single expression (no newlines, no =, no import, no def/class/for/if)
    # use eval mode to get a result back
    is_expr = (
        "\n" not in code
        and "=" not in code
        and not code.startswith(("import ", "from ", "def ", "class ", "for ", "if ", "while ", "print"))
        and not code.startswith(("#", "//"))
    )

    mode = "eval" if is_expr else "exec"
    result = send_code(code, mode)

    print("─" * 60)
    if result.get("stdout"):
        print(result["stdout"].rstrip())
    if result.get("result"):
        print(f"=> {result['result']}")
    if result.get("error"):
        print(f"❌ {result['error']}")
    if not any(result.values()):
        print("(no output)")
    print("─" * 60)


if __name__ == "__main__":
    main()