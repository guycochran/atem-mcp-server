// IMPORTANT: Redirect console.log to stderr so stdout stays clean for MCP JSON-RPC.
console.log = console.error;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import { connectAtem } from './services/atem-connection.js';
import { registerConnectionTools } from './tools/connection.js';
import { registerSwitchingTools } from './tools/switching.js';
import { registerTransitionTools } from './tools/transitions.js';
import { registerRoutingTools } from './tools/routing.js';
import { registerMacroTools, registerRecordingStreamingTools } from './tools/macros-recording.js';
import { registerAudioTools } from './tools/audio.js';
import { registerSuperSourceTools } from './tools/supersource.js';

const validTokens = new Set<string>();

function createServer(): McpServer {
  const server = new McpServer({ name: 'atem-mcp-server', version: '1.4.0' });
  registerConnectionTools(server);
  registerSwitchingTools(server);
  registerTransitionTools(server);
  registerRoutingTools(server);
  registerMacroTools(server);
  registerRecordingStreamingTools(server);
  registerAudioTools(server);
  registerSuperSourceTools(server);
  return server;
}

function autoConnect(): void {
  const host = process.env.ATEM_HOST;
  if (host) {
    const port = process.env.ATEM_PORT ? parseInt(process.env.ATEM_PORT) : undefined;
    connectAtem(host, port)
      .then((msg: string) => console.error(`[atem-mcp] Auto-connected: ${msg}`))
      .catch((err: Error) => console.error(`[atem-mcp] Auto-connect failed: ${err}`));
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
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || '3000'}`;

  const httpServer = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
    console.error(`[REQ] ${req.method} ${req.url?.split('?')[0]} auth=${req.headers.authorization ? req.headers.authorization.substring(0, 25) + '...' : 'none'}`);

    // Fix Accept header for POST /mcp at raw level
    if (req.method === 'POST' && (req.url === '/mcp' || req.url?.startsWith('/mcp?'))) {
      const accept = req.headers.accept || '';
      if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
        req.headers.accept = 'application/json, text/event-stream';
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          if (req.rawHeaders[i].toLowerCase() === 'accept') {
            req.rawHeaders[i + 1] = 'application/json, text/event-stream';
            break;
          }
        }
        console.error(`[FIX] Accept → application/json, text/event-stream`);
      }
    }

    // Response logging
    const origEnd = res.end.bind(res);
    const chunks: Buffer[] = [];
    const origWrite = res.write.bind(res);
    res.write = function(chunk: any, ...args: any[]): boolean {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return origWrite(chunk, ...args);
    } as any;
    res.end = function(chunk: any, ...args: any[]): any {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString('utf8').substring(0, 300);
      console.error(`[RESP] ${req.method} ${req.url?.split('?')[0]} => ${res.statusCode} body=${body}`);
      return origEnd(chunk, ...args);
    } as any;

    app(req, res);
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ── CORS ──
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, HEAD, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
    res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version');
    next();
  });
  app.options('*', (_req: express.Request, res: express.Response) => { res.sendStatus(204); });

  // ══════════════════════════════════════════════════════════════════════════
  // OAuth 2.0
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/.well-known/oauth-protected-resource/mcp', (_req: express.Request, res: express.Response) => {
    res.json({ resource: `${baseUrl}/mcp`, authorization_servers: [baseUrl], bearer_methods_supported: ['header'] });
  });
  app.get('/.well-known/oauth-protected-resource', (_req: express.Request, res: express.Response) => {
    res.json({ resource: baseUrl, authorization_servers: [baseUrl], bearer_methods_supported: ['header'] });
  });
  app.get('/.well-known/oauth-authorization-server', (_req: express.Request, res: express.Response) => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp:tools']
    });
  });

  // Dynamic registration — accept anything
  app.post('/register', (req: express.Request, res: express.Response) => {
    const clientId = req.body?.client_id || crypto.randomUUID();
    console.error(`[OAUTH] register: ${clientId}`);
    res.status(201).json({
      client_id: clientId,
      client_secret: req.body?.client_secret || crypto.randomUUID(),
      client_name: req.body?.client_name || 'claude',
      redirect_uris: req.body?.redirect_uris || [],
      grant_types: req.body?.grant_types || ['authorization_code'],
      response_types: req.body?.response_types || ['code'],
      token_endpoint_auth_method: req.body?.token_endpoint_auth_method || 'client_secret_post',
      scope: req.body?.scope || 'mcp:tools'
    });
  });

  app.get('/authorize', (req: express.Request, res: express.Response) => {
    const redirectUri = req.query.redirect_uri as string;
    const state = req.query.state as string;
    const code = crypto.randomUUID();
    console.error(`[OAUTH] authorize → code=${code.substring(0, 8)}...`);
    if (!redirectUri) { res.status(400).json({ error: 'missing redirect_uri' }); return; }
    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    res.redirect(302, url.toString());
  });

  // Token endpoint — accept ANY credentials, always issue token
  app.post('/token', (req: express.Request, res: express.Response) => {
    const grantType = req.body?.grant_type;
    const clientId = req.body?.client_id;
    // Log what Claude actually sends (for debugging)
    console.error(`[OAUTH] token: grant=${grantType} client_id=${clientId} client_secret=${req.body?.client_secret ? req.body.client_secret.substring(0, 8) + '...' : 'none'}`);
    console.error(`[OAUTH] token body keys: ${Object.keys(req.body || {}).join(', ')}`);

    const token = crypto.randomUUID();
    const refreshToken = crypto.randomUUID();
    validTokens.add(token);
    console.error(`[OAUTH] ISSUED token=${token.substring(0, 8)}... (${validTokens.size} active)`);

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 86400,
      refresh_token: refreshToken,
      scope: 'mcp:tools'
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // MCP endpoints — require Bearer token
  // ══════════════════════════════════════════════════════════════════════════

  app.head('/mcp', (_req: express.Request, res: express.Response) => {
    res.setHeader('MCP-Protocol-Version', '2025-03-26');
    res.setHeader('Content-Type', 'application/json');
    res.sendStatus(200);
  });

  app.get('/health', (_req: express.Request, res: express.Response) => {
    res.json({ status: 'ok', server: 'atem-mcp-server', version: '1.4.0' });
  });

  app.post('/mcp', async (req: express.Request, res: express.Response) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      console.error('[AUTH] 401 — no Bearer token');
      res.status(401)
        .header('WWW-Authenticate', `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp"`)
        .json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: req.body?.id || null });
      return;
    }

    const token = auth.substring(7);
    // Accept ANY bearer token (don't validate — just log)
    console.error(`[AUTH] ✓ Bearer ${token.substring(0, 8)}... known=${validTokens.has(token)}`);

    try {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[ERROR] POST /mcp:', err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });

  app.get('/mcp', (_req: express.Request, res: express.Response) => {
    res.writeHead(405, { Allow: 'POST' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
  });
  app.delete('/mcp', (_req: express.Request, res: express.Response) => {
    res.writeHead(405, { Allow: 'POST' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Not supported.' }, id: null }));
  });

  app.use((req: express.Request, res: express.Response) => {
    console.error(`[404] ${req.method} ${req.path}`);
    res.status(404).json({ error: 'not found' });
  });

  autoConnect();
  const port = parseInt(process.env.PORT || '3000');
  httpServer.listen(port, () => {
    console.error(`[atem-mcp] v1.4.0 | http://localhost:${port}/mcp | OAuth: ${baseUrl}`);
  });
}

const transport = process.env.TRANSPORT || 'stdio';
if (transport === 'http') { runHTTP().catch(console.error); } else { runStdio().catch(console.error); }
