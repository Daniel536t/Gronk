// MCP over HTTP (Streamable HTTP). One StreamableHTTPServerTransport handles
// all incoming MCP sessions — the transport has built-in session management
// (sessionIdGenerator → session tracking → per-session state in memory).
// Every session routes to the same McpServer (which is stateless across
// sessions except for the per-MCP-session room context tracked by mcp.ts).
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface McpHttpHandler {
  handle(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void>;
}

export function createMcpHttpBridge(serverFactory: () => McpServer): McpHttpHandler {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  // Connect the transport to a fresh McpServer. All sessions share this one
  // server; per-session room context is tracked by sessionId in mcp.ts ctxOf.
  const server = serverFactory();
  void server.connect(transport);

  return {
    async handle(
      req: IncomingMessage,
      res: ServerResponse,
      body: unknown,
    ): Promise<void> {
      await transport.handleRequest(req, res, body);
    },
  };
}