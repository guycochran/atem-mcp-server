#!/usr/bin/env node

// IMPORTANT: Redirect console.log to stderr so stdout stays clean for MCP JSON-RPC.
console.log = console.error;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

import { registerConnectionTools } from './tools/connection.js';
import { registerSwitchingTools } from './tools/switching.js';
import { registerTransitionTools } from './tools/transitions.js';
import { registerRoutingTools } from './tools/routing.js';
import { registerMacroTools, registerRecordingStreamingTools } from './tools/macros-recording.js';
import { registerAudioTools } from './tools/audio.js';

function createServer(): McpServer {
  const server = new McpServer({
    name: 'atem-mcp-server',
    version: '1.0.0'
  });

  registerConnectionTools(server);
  registerSwitchingTools(server);
  registerTransitionTools(server);
  registerRoutingTools(server);
  registerMacroTools(server);
  registerRecordingStreamingTools(server);
  registerAudioTools(server);

  return server;
}

function autoConnect(): void {
  const autoHost = process.env.ATEM_HOST;
  if (autoHost) {
    const autoPort = process.env.ATEM_PORT ? parseInt(process.env.ATEM_PORT) : undefined;
    import('./services/atem-connection.js').then(({ connectAtem }) => {
      connectAtem(autoHost, autoPort)
        .then((msg) => console.error(`[atem-mcp] Auto-connected: ${msg}`))
        .catch((err) => console.error(`[atem-mcp] Auto-connect failed: ${err}`));
    });
  }
}

async function runStdio(): Promise<void> {
  const server = createServer();
  autoConnect();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[atem-mcp] ATEM MCP Server running on stdio');
}

async function runHTTP(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', server: 'atem-mcp-server', version: '1.1.0' });
  });

  app.post('/mcp', async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', async (_req, res) => {
    res.writeHead(405, { Allow: 'POST' }).end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST.' },
      id: null
    }));
  });

  app.delete('/mcp', async (_req, res) => {
    res.writeHead(405, { Allow: 'POST' }).end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Session termination not supported in stateless mode.' },
      id: null
    }));
  });

  autoConnect();

  const port = parseInt(process.env.PORT || '3000');
  app.listen(port, () => {
    console.error(`[atem-mcp] ATEM MCP Server running on http://localhost:${port}/mcp`);
    console.error(`[atem-mcp] Health check: http://localhost:${port}/health`);
  });
}

const transport = process.env.TRANSPORT || 'stdio';
if (transport === 'http') {
  runHTTP().catch(error => {
    console.error('[atem-mcp] Fatal error:', error);
    process.exit(1);
  });
} else {
  runStdio().catch(error => {
    console.error('[atem-mcp] Fatal error:', error);
    process.exit(1);
  });
}
