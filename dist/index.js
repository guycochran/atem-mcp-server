#!/usr/bin/env node
// Redirect all console.log to stderr so stdout stays clean for MCP JSON-RPC
const originalLog = console.log;
console.log = console.error;
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerConnectionTools } from './tools/connection.js';
import { registerSwitchingTools } from './tools/switching.js';
import { registerTransitionTools } from './tools/transitions.js';
import { registerRoutingTools } from './tools/routing.js';
import { registerMacroTools, registerRecordingStreamingTools } from './tools/macros-recording.js';
import { registerAudioTools } from './tools/audio.js';
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
const autoHost = process.env.ATEM_HOST;
if (autoHost) {
    const autoPort = process.env.ATEM_PORT ? parseInt(process.env.ATEM_PORT) : undefined;
    import('./services/atem-connection.js').then(({ connectAtem }) => {
        connectAtem(autoHost, autoPort)
            .then((msg) => console.error(`[atem-mcp] Auto-connected: ${msg}`))
            .catch((err) => console.error(`[atem-mcp] Auto-connect failed: ${err}`));
    });
}
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[atem-mcp] ATEM MCP Server running on stdio');
}
main().catch((error) => {
    console.error('[atem-mcp] Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map