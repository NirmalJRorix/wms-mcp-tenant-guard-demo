import { McpServer } from '@modelcontextprotocol/server';
import type { Principal } from '../auth/principal.ts';
import { tools } from '../tools/definitions.ts';
import { runTool, type Deps } from '../tools/runTool.ts';

/**
 * Builds a fresh MCP server for ONE request, already bound to the verified principal.
 * Tool callbacks never see a tenant from the model; they close over `principal`.
 */
export function buildMcpServer(deps: Deps, principal: Principal): McpServer {
  const server = new McpServer({ name: 'wms-mcp-tenant-guard-demo', version: '0.1.0' });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      async (args: unknown) => {
        const out = await runTool(deps, principal, tool.name, args);
        return {
          isError: out.isError,
          structuredContent: out.body,
          content: [{ type: 'text' as const, text: JSON.stringify(out.body) }],
        };
      },
    );
  }
  return server;
}
