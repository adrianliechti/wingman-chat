#!/usr/bin/env node

// Stands in for a real local Wingman companion during development: answers the
// auto-discovery probe (`/.well-known/wingman-configuration`) and exposes one
// dummy tool over MCP, so `bridge.url` in public/config.json resolves to a
// genuinely running companion instead of a dead URL.
//
// Usage: node scripts/mock-companion.mjs (or `npm run mock:companion`)
// Then point public/config.json's `bridge.url` at this port (default 8787).

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.MOCK_COMPANION_PORT) || 8787;

function buildServer() {
  const mcpServer = new McpServer({ name: "wingman-mock-companion", version: "0.0.0" });

  mcpServer.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Returns pong. Only tool this dummy companion exposes.",
      inputSchema: { message: z.string().optional() },
    },
    async ({ message }) => ({
      content: [{ type: "text", text: message ? `pong: ${message}` : "pong" }],
    }),
  );

  return mcpServer;
}

// One MCP session per client connection: `StreamableHTTPServerTransport` only
// ever completes a single initialize handshake, so each browser tab/retry needs
// its own transport, looked up by the `Mcp-Session-Id` header on later requests.
const transports = new Map();

async function handleMcpRequest(req, res) {
  const sessionId = req.headers["mcp-session-id"];
  let transport = typeof sessionId === "string" ? transports.get(sessionId) : undefined;

  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => transports.set(id, transport),
      onsessionclosed: (id) => transports.delete(id),
    });
    await buildServer().connect(transport);
  }

  await transport.handleRequest(req, res);
}

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

const server = createServer(async (req, res) => {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname === "/.well-known/wingman-configuration" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify({ name: "Mock Companion" }));
    return;
  }

  if (url.pathname === "/mcp") {
    await handleMcpRequest(req, res);
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Mock companion running at http://localhost:${PORT}`);
  console.log(`Set "bridge": { "url": "http://localhost:${PORT}" } in public/config.json to use it.`);
});
