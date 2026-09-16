#!/usr/bin/env node

/**
 * TD MCP Server — exposes TouchDesigner's Python environment to VS Code Copilot Chat.
 *
 * Tools provided:
 *   td_execute  — run Python code (exec mode) in TD, return stdout + errors
 *   td_eval     — evaluate a Python expression (eval mode) in TD, return the result
 *   td_inspect  — inspect a node by path, return its type, parameters, and children
 *
 * Prerequisites:
 *   - Web Server DAT running in TD on localhost:9980
 *   - td_bridge_webserver.py as the callback
 *
 * VS Code config (.vscode/mcp.json):
 *   {
 *     "servers": {
 *       "td-bridge": {
 *         "command": "node",
 *         "args": ["${workspaceFolder}/mcp/index.js"]
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import http from "node:http";

const TD_HOST = process.env.TD_BRIDGE_HOST || "127.0.0.1";
const TD_PORT = parseInt(process.env.TD_BRIDGE_PORT || "9980", 10);

// ─── HTTP client for the TD bridge ──────────────────────────────────────────

function sendToTD(code, mode) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ code, mode });
    const req = http.request(
      {
        hostname: TD_HOST,
        port: TD_PORT,
        path: "/",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 10000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Invalid JSON from TD: ${data.substring(0, 200)}`));
          }
        });
      }
    );
    req.on("error", (err) => {
      reject(
        new Error(
          err.code === "ECONNREFUSED"
            ? `Cannot reach TouchDesigner at ${TD_HOST}:${TD_PORT}. Is the Web Server DAT running?`
            : err.message
        )
      );
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out (10s)"));
    });
    req.write(payload);
    req.end();
  });
}

// ─── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "td_execute",
    description:
      "Execute Python code in TouchDesigner's running environment (exec mode). " +
      "Use for statements, multi-line scripts, function defs, assignments, print statements. " +
      "All TD globals are available: op(), me, parent(), absTime, td, tdu. " +
      "Variables persist between calls. Returns stdout, result (empty for exec), and any error traceback.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Python code to execute. Can be multi-line.",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "td_eval",
    description:
      "Evaluate a single Python expression in TouchDesigner (eval mode). " +
      "Returns the repr() of the result. Use for inspecting values: op('/project1').name, absTime.frame, etc. " +
      "Must be a single expression, not a statement (no =, no print, no def).",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "A single Python expression to evaluate.",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "td_inspect",
    description:
      "Inspect a TouchDesigner node by path. Returns its type, path, all parameters with values, " +
      "and a list of children. Useful for understanding the project structure before making changes.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "OP path to inspect, e.g. '/project1', '/project1/geo1', '/'.",
          default: "/",
        },
      },
      required: ["path"],
    },
  },
];

// ─── Tool handlers ──────────────────────────────────────────────────────────

async function handleToolCall(name, args) {
  try {
    if (name === "td_execute") {
      const resp = await sendToTD(args.code, "exec");
      const parts = [];
      if (resp.stdout) parts.push(`stdout:\n${resp.stdout.trim()}`);
      if (resp.result) parts.push(`result: ${resp.result}`);
      if (resp.error) parts.push(`error:\n${resp.error}`);
      return { content: [{ type: "text", text: parts.join("\n\n") || "(no output)" }] };
    }

    if (name === "td_eval") {
      const resp = await sendToTD(args.code, "eval");
      if (resp.error) {
        return { content: [{ type: "text", text: `Error: ${resp.error}` }] };
      }
      const text = resp.result || resp.stdout.trim() || "(None)";
      return { content: [{ type: "text", text }] };
    }

    if (name === "td_inspect") {
      const path = args.path || "/";
      const inspectCode = `
import json as _json
_n = op(${JSON.stringify(path)})
if _n is None:
    print("ERROR: No operator found at path: ${path}")
else:
    _info = {
        'path': _n.path,
        'name': _n.name,
        'type': _n.type.name if hasattr(_n, 'type') else 'unknown',
        'family': _n.family if hasattr(_n, 'family') else 'unknown',
        'parameters': {},
        'children': [c.name for c in (_n.children if hasattr(_n, 'children') else [])],
    }
    for p in (_n.pars() if hasattr(_n, 'pars') else []):
        try:
            _info['parameters'][p.name] = p.eval()
        except:
            _info['parameters'][p.name] = '<error>'
    print(_json.dumps(_info, indent=2, default=str))
`;
      const resp = await sendToTD(inspectCode, "exec");
      if (resp.error) {
        return { content: [{ type: "text", text: `Error: ${resp.error}` }] };
      }
      return { content: [{ type: "text", text: resp.stdout.trim() || "(no output)" }] };
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }] };
  }
}

// ─── Server setup ───────────────────────────────────────────────────────────

const server = new Server(
  { name: "td-bridge", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return await handleToolCall(name, args || {});
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[TD MCP Server] Running on stdio (→ TD at " + TD_HOST + ":" + TD_PORT + ")\n");