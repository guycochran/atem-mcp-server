import { z } from 'zod';
import { connectAtem, disconnectAtem, isAtemConnected, getAtem, getInputName } from '../services/atem-connection.js';
export function registerConnectionTools(server) {
    server.registerTool('atem_connect', {
        title: 'Connect to ATEM Switcher',
        description: `Connect to a Blackmagic ATEM video switcher on the network.

Args:
  - host (string): IP address of the ATEM switcher (e.g., "192.168.1.100")
  - port (number, optional): Port number (default: 9910)

Returns: Connection confirmation with ATEM model info.`,
        inputSchema: {
            host: z.string().describe('IP address of the ATEM switcher'),
            port: z.number().int().optional().describe('Port number (default: 9910)')
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true
        }
    }, async ({ host, port }) => {
        const result = await connectAtem(host, port);
        return { content: [{ type: 'text', text: result }] };
    });
    server.registerTool('atem_disconnect', {
        title: 'Disconnect from ATEM',
        description: 'Disconnect from the currently connected ATEM switcher.',
        inputSchema: {},
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
        }
    }, async () => {
        const result = await disconnectAtem();
        return { content: [{ type: 'text', text: result }] };
    });
    server.registerTool('atem_get_status', {
        title: 'Get ATEM Status',
        description: `Get current ATEM switcher status including model info, current program/preview inputs, and connection state.

Returns: JSON object with model, firmware version, current program input, current preview input, and available inputs.`,
        inputSchema: {},
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
        }
    }, async () => {
        if (!isAtemConnected()) {
            return { content: [{ type: 'text', text: 'Not connected to any ATEM switcher.' }] };
        }
        const atem = getAtem();
        const state = atem.state;
        const me0 = state?.video?.mixEffects?.[0];
        const programInput = me0?.programInput ?? 0;
        const previewInput = me0?.previewInput ?? 0;
        const inputs = {};
        if (state?.inputs) {
            for (const [id, input] of Object.entries(state.inputs)) {
                if (input) {
                    inputs[id] = input.longName ?? input.shortName ?? `Input ${id}`;
                }
            }
        }
        const status = {
            connected: true,
            model: state?.info?.model ?? 'Unknown',
            productId: state?.info?.productIdentifier ?? 'Unknown',
            programInput: { id: programInput, name: getInputName(programInput) },
            previewInput: { id: previewInput, name: getInputName(previewInput) },
            inputs
        };
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    });
}
//# sourceMappingURL=connection.js.map