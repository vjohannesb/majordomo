#!/usr/bin/env node
/**
 * Majordomo MCP Server
 *
 * Exposes Slack, Email, Calendar, Discord, Linear, and Notion tools
 * via the Model Context Protocol (stdio transport).
 */

import { createToolContext, type ToolContext } from './core/accounts.js';
import { AVAILABLE_TOOLS, executeTool, type Tool } from './core/tools.js';

// MCP protocol types
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// Convert our tool format to MCP tool format
function convertToolsToMCP() {
  return AVAILABLE_TOOLS.map((tool: Tool) => ({
    name: `majordomo_${tool.name}`,
    description: tool.description,
    inputSchema: {
      type: 'object' as const,
      properties: Object.fromEntries(
        Object.entries(tool.parameters).map(([name, param]) => [
          name,
          {
            type: param.type,
            description: param.description,
          },
        ])
      ),
      required: Object.entries(tool.parameters)
        .filter(([_, param]) => param.required)
        .map(([name]) => name),
    },
  }));
}

let toolContext: ToolContext | null = null;

async function getToolContext(): Promise<ToolContext> {
  if (!toolContext) {
    toolContext = await createToolContext();
  }
  return toolContext;
}

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'majordomo',
              version: '0.1.0',
            },
          },
        };
      }

      case 'notifications/initialized': {
        // Client acknowledged initialization - no response needed for notifications
        return { jsonrpc: '2.0', id, result: null };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: convertToolsToMCP(),
          },
        };
      }

      case 'tools/call': {
        const { name, arguments: args } = params as { name: string; arguments: Record<string, unknown> };

        // Strip majordomo_ prefix
        const toolName = name.replace(/^majordomo_/, '');

        const ctx = await getToolContext();
        const result = await executeTool({ tool: toolName, params: args }, ctx);

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: result }],
          },
        };
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
      }
    }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// Stdio transport
async function main() {
  let buffer = '';

  process.stdin.setEncoding('utf8');

  process.stdin.on('data', async (chunk: string) => {
    buffer += chunk;

    // Process complete messages (newline-delimited JSON)
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const request = JSON.parse(line) as JsonRpcRequest;
        const response = await handleRequest(request);

        // Don't send response for notifications (no id)
        if (request.id !== undefined) {
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (err) {
        // Parse error
        const errorResponse: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: 0,
          error: { code: -32700, message: 'Parse error' },
        };
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
