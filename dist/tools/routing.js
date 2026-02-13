import { z } from 'zod';
import { getAtem, getInputName } from '../services/atem-connection.js';
export function registerRoutingTools(server) {
    server.registerTool('atem_set_aux_source', {
        title: 'Set Aux Output Source',
        description: `Route an input source to an auxiliary output.

Args:
  - aux (number): Aux output number (0-based, so aux 0 = Aux 1 on the switcher)
  - input (number): Input source number to route to this aux

Common uses: sending a clean feed to a recorder, routing a specific camera to a confidence monitor, etc.`,
        inputSchema: {
            aux: z.number().int().min(0).describe('Aux output number (0-based)'),
            input: z.number().int().describe('Input source number to route')
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
        }
    }, async ({ aux, input }) => {
        const atem = getAtem();
        await atem.setAuxSource(input, aux);
        const name = getInputName(input);
        return { content: [{ type: 'text', text: `Aux ${aux + 1} set to input ${input} (${name})` }] };
    });
    server.registerTool('atem_get_aux_source', {
        title: 'Get Aux Output Sources',
        description: `Get the current source routing for all auxiliary outputs.

Returns: JSON object mapping each aux output to its current source input.`,
        inputSchema: {},
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
        }
    }, async () => {
        const atem = getAtem();
        const auxes = atem.state?.video?.auxilliaries ?? [];
        const result = {};
        auxes.forEach((inputId, index) => {
            if (inputId !== undefined) {
                result[`Aux ${index + 1}`] = {
                    inputId,
                    inputName: getInputName(inputId)
                };
            }
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    // --- Downstream Keyers ---
    server.registerTool('atem_set_dsk_on_air', {
        title: 'Set Downstream Key On Air',
        description: `Put a downstream keyer on or off air. DSKs overlay graphics (logos, lower thirds, etc.) on top of the program output.

Args:
  - dsk (number): Downstream keyer number (0-based, 0 = DSK1, 1 = DSK2)
  - onAir (boolean): true to put on air, false to take off air`,
        inputSchema: {
            dsk: z.number().int().min(0).max(3).describe('Downstream keyer number (0-based)'),
            onAir: z.boolean().describe('true = on air, false = off air')
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
        }
    }, async ({ dsk, onAir }) => {
        const atem = getAtem();
        await atem.setDownstreamKeyOnAir(onAir, dsk);
        return { content: [{ type: 'text', text: `DSK${dsk + 1} ${onAir ? 'ON AIR' : 'OFF AIR'}` }] };
    });
    server.registerTool('atem_auto_dsk', {
        title: 'Auto Downstream Key Transition',
        description: `Trigger an auto transition for a downstream keyer (mix on/off air).

Args:
  - dsk (number): Downstream keyer number (0-based)`,
        inputSchema: {
            dsk: z.number().int().min(0).max(3).describe('Downstream keyer number (0-based)')
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false
        }
    }, async ({ dsk }) => {
        const atem = getAtem();
        await atem.autoDownstreamKey(dsk);
        return { content: [{ type: 'text', text: `DSK${dsk + 1} auto transition triggered` }] };
    });
    server.registerTool('atem_set_dsk_sources', {
        title: 'Set DSK Fill and Key Sources',
        description: `Set the fill and/or key (cut) sources for a downstream keyer.

Args:
  - dsk (number): Downstream keyer number (0-based)
  - fillSource (number, optional): Input to use as fill source
  - cutSource (number, optional): Input to use as key/cut source`,
        inputSchema: {
            dsk: z.number().int().min(0).max(3).describe('Downstream keyer number (0-based)'),
            fillSource: z.number().int().optional().describe('Fill source input number'),
            cutSource: z.number().int().optional().describe('Key/cut source input number')
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
        }
    }, async ({ dsk, fillSource, cutSource }) => {
        const atem = getAtem();
        const results = [];
        if (fillSource !== undefined) {
            await atem.setDownstreamKeyFillSource(fillSource, dsk);
            results.push(`fill source = ${fillSource} (${getInputName(fillSource)})`);
        }
        if (cutSource !== undefined) {
            await atem.setDownstreamKeyCutSource(cutSource, dsk);
            results.push(`key source = ${cutSource} (${getInputName(cutSource)})`);
        }
        if (results.length === 0) {
            return { content: [{ type: 'text', text: 'No sources specified. Provide fillSource and/or cutSource.' }] };
        }
        return { content: [{ type: 'text', text: `DSK${dsk + 1}: ${results.join(', ')}` }] };
    });
    // --- Upstream Keyers ---
    server.registerTool('atem_set_usk_on_air', {
        title: 'Set Upstream Key On Air',
        description: `Put an upstream keyer on or off air on a specific ME bus. USKs are used for picture-in-picture, chroma key, luma key, DVE effects, etc.

Args:
  - me (number, optional): Mix Effect bus (default: 0 for ME1)
  - usk (number): Upstream keyer number (0-based, 0 = Key 1)
  - onAir (boolean): true to put on air, false to take off air`,
        inputSchema: {
            me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus (0=ME1)'),
            usk: z.number().int().min(0).max(3).describe('Upstream keyer number (0-based)'),
            onAir: z.boolean().describe('true = on air, false = off air')
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
        }
    }, async ({ me, usk, onAir }) => {
        const atem = getAtem();
        await atem.setUpstreamKeyerOnAir(onAir, me, usk);
        return { content: [{ type: 'text', text: `ME${me + 1} USK${usk + 1} ${onAir ? 'ON AIR' : 'OFF AIR'}` }] };
    });
    server.registerTool('atem_set_usk_sources', {
        title: 'Set Upstream Key Sources',
        description: `Set the fill and/or cut sources for an upstream keyer.

Args:
  - me (number, optional): Mix Effect bus (default: 0 for ME1)
  - usk (number): Upstream keyer number (0-based)
  - fillSource (number, optional): Input to use as fill
  - cutSource (number, optional): Input to use as key/cut`,
        inputSchema: {
            me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus'),
            usk: z.number().int().min(0).max(3).describe('Upstream keyer number (0-based)'),
            fillSource: z.number().int().optional().describe('Fill source input number'),
            cutSource: z.number().int().optional().describe('Key/cut source input number')
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
        }
    }, async ({ me, usk, fillSource, cutSource }) => {
        const atem = getAtem();
        const results = [];
        if (fillSource !== undefined) {
            await atem.setUpstreamKeyerFillSource(fillSource, me, usk);
            results.push(`fill = ${fillSource} (${getInputName(fillSource)})`);
        }
        if (cutSource !== undefined) {
            await atem.setUpstreamKeyerCutSource(cutSource, me, usk);
            results.push(`cut = ${cutSource} (${getInputName(cutSource)})`);
        }
        if (results.length === 0) {
            return { content: [{ type: 'text', text: 'No sources specified.' }] };
        }
        return { content: [{ type: 'text', text: `ME${me + 1} USK${usk + 1}: ${results.join(', ')}` }] };
    });
}
//# sourceMappingURL=routing.js.map