import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAtem, getInputName } from '../services/atem-connection.js';
import { Enums } from 'atem-connection';

export function registerRoutingTools(server: McpServer): void {

  server.registerTool(
    'atem_set_aux_source',
    {
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
    },
    async ({ aux, input }) => {
      const atem = getAtem();
      await atem.setAuxSource(input, aux);
      const name = getInputName(input);
      return { content: [{ type: 'text', text: `Aux ${aux + 1} set to input ${input} (${name})` }] };
    }
  );

  server.registerTool(
    'atem_get_aux_source',
    {
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
    },
    async () => {
      const atem = getAtem();
      const auxes = atem.state?.video?.auxilliaries ?? [];
      const result: Record<string, { inputId: number; inputName: string }> = {};

      auxes.forEach((inputId, index) => {
        if (inputId !== undefined) {
          result[`Aux ${index + 1}`] = {
            inputId,
            inputName: getInputName(inputId)
          };
        }
      });

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Downstream Keyers ---

  server.registerTool(
    'atem_set_dsk_on_air',
    {
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
    },
    async ({ dsk, onAir }) => {
      const atem = getAtem();
      await atem.setDownstreamKeyOnAir(onAir, dsk);
      return { content: [{ type: 'text', text: `DSK${dsk + 1} ${onAir ? 'ON AIR' : 'OFF AIR'}` }] };
    }
  );

  server.registerTool(
    'atem_auto_dsk',
    {
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
    },
    async ({ dsk }) => {
      const atem = getAtem();
      await atem.autoDownstreamKey(dsk);
      return { content: [{ type: 'text', text: `DSK${dsk + 1} auto transition triggered` }] };
    }
  );

  server.registerTool(
    'atem_set_dsk_sources',
    {
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
    },
    async ({ dsk, fillSource, cutSource }) => {
      const atem = getAtem();
      const results: string[] = [];

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
    }
  );

  // --- Upstream Keyers ---

  server.registerTool(
    'atem_set_usk_on_air',
    {
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
    },
    async ({ me, usk, onAir }) => {
      const atem = getAtem();
      await atem.setUpstreamKeyerOnAir(onAir, me, usk);
      return { content: [{ type: 'text', text: `ME${me + 1} USK${usk + 1} ${onAir ? 'ON AIR' : 'OFF AIR'}` }] };
    }
  );

  server.registerTool(
    'atem_set_usk_sources',
    {
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
    },
    async ({ me, usk, fillSource, cutSource }) => {
      const atem = getAtem();
      const results: string[] = [];

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
    }
  );

  // --- Upstream Keyer Type ---

  server.registerTool(
    'atem_set_usk_type',
    {
      title: 'Set Upstream Key Type',
      description: `Set the type of an upstream keyer (Luma, Chroma, Pattern, or DVE) and whether fly key is enabled.

Args:
  - me (number, optional): Mix Effect bus (default: 0 for ME1)
  - usk (number): Upstream keyer number (0-based, 0 = Key 1)
  - keyType (string): Key type — "luma", "chroma", "pattern", or "dve"
  - flyEnabled (boolean, optional): Enable fly key (required for DVE positioning)

For DVE picture-in-picture effects, set keyType="dve" and flyEnabled=true, then use atem_set_usk_dve to position/size.`,
      inputSchema: {
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus (0=ME1)'),
        usk: z.number().int().min(0).max(3).describe('Upstream keyer number (0-based)'),
        keyType: z.enum(['luma', 'chroma', 'pattern', 'dve']).describe('Key type'),
        flyEnabled: z.boolean().optional().describe('Enable fly key (default: true for DVE, false otherwise)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ me, usk, keyType, flyEnabled }) => {
      const atem = getAtem();
      const typeMap: Record<string, Enums.MixEffectKeyType> = {
        luma: Enums.MixEffectKeyType.Luma,
        chroma: Enums.MixEffectKeyType.Chroma,
        pattern: Enums.MixEffectKeyType.Pattern,
        dve: Enums.MixEffectKeyType.DVE,
      };
      const fly = flyEnabled ?? (keyType === 'dve');
      await atem.setUpstreamKeyerType({ mixEffectKeyType: typeMap[keyType], flyEnabled: fly }, me, usk);
      return { content: [{ type: 'text', text: `ME${me + 1} USK${usk + 1}: type=${keyType}, flyEnabled=${fly}` }] };
    }
  );

  // --- Upstream Keyer DVE Settings ---

  server.registerTool(
    'atem_set_usk_dve',
    {
      title: 'Set Upstream Key DVE Settings',
      description: `Set DVE (Digital Video Effects) properties for an upstream keyer — position, size, rotation, border, mask, shadow.

Use this for picture-in-picture overlays. First set the key type to DVE with atem_set_usk_type, then use this tool to position and size the DVE box.

All values are passed directly to the ATEM protocol (raw units):
  - sizeX, sizeY: 0 to 1.0 (fraction of full frame, e.g. 0.5 = half, 0.33 = third)
  - positionX: -1.0 to 1.0 (horizontal position, -1=left edge, 0=center, 1=right edge)
  - positionY: -1.0 to 1.0 (vertical position, -1=bottom, 0=center, 1=top)
  - rotation: 0-35999 (hundredths of degrees, e.g. 9000 = 90°)
  - crop: 0 to 1.0 (fraction of image to crop from each edge)

Args:
  - me (number, optional): Mix Effect bus (default: 0)
  - usk (number): Upstream keyer number (0-based)
  - sizeX (number, optional): Horizontal size 0-1.0
  - sizeY (number, optional): Vertical size 0-1.0
  - positionX (number, optional): Horizontal position -1.0 to 1.0
  - positionY (number, optional): Vertical position -1.0 to 1.0
  - rotation (number, optional): Rotation 0-35999 (hundredths of degrees)
  - borderEnabled (boolean, optional): Show border
  - borderOuterWidth (number, optional): Outer border width 0-1600
  - borderInnerWidth (number, optional): Inner border width 0-1600
  - borderHue (number, optional): Border hue 0-3599
  - borderSaturation (number, optional): Border saturation 0-1000
  - borderLuma (number, optional): Border luminance 0-1000
  - borderOpacity (number, optional): Border opacity 0-100
  - shadowEnabled (boolean, optional): Show drop shadow
  - maskEnabled (boolean, optional): Enable mask
  - maskTop (number, optional): Mask top 0-38000
  - maskBottom (number, optional): Mask bottom 0-38000
  - maskLeft (number, optional): Mask left 0-52000
  - maskRight (number, optional): Mask right 0-52000

Example — 3x2 grid element at top-left, 1/3 size:
  sizeX=0.33, sizeY=0.33, positionX=-0.33, positionY=0.25`,
      inputSchema: {
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus'),
        usk: z.number().int().min(0).max(3).describe('Upstream keyer number (0-based)'),
        sizeX: z.number().optional().describe('Horizontal size (0-1.0, raw ATEM units)'),
        sizeY: z.number().optional().describe('Vertical size (0-1.0, raw ATEM units)'),
        positionX: z.number().optional().describe('X position (raw ATEM units)'),
        positionY: z.number().optional().describe('Y position (raw ATEM units)'),
        rotation: z.number().min(0).max(35999).optional().describe('Rotation in hundredths of degrees'),
        borderEnabled: z.boolean().optional().describe('Show border'),
        borderOuterWidth: z.number().min(0).max(1600).optional().describe('Outer border width'),
        borderInnerWidth: z.number().min(0).max(1600).optional().describe('Inner border width'),
        borderHue: z.number().min(0).max(3599).optional().describe('Border hue'),
        borderSaturation: z.number().min(0).max(1000).optional().describe('Border saturation'),
        borderLuma: z.number().min(0).max(1000).optional().describe('Border luminance'),
        borderOpacity: z.number().min(0).max(100).optional().describe('Border opacity'),
        shadowEnabled: z.boolean().optional().describe('Show drop shadow'),
        maskEnabled: z.boolean().optional().describe('Enable mask'),
        maskTop: z.number().min(0).max(38000).optional().describe('Mask top edge'),
        maskBottom: z.number().min(0).max(38000).optional().describe('Mask bottom edge'),
        maskLeft: z.number().min(0).max(52000).optional().describe('Mask left edge'),
        maskRight: z.number().min(0).max(52000).optional().describe('Mask right edge')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ me, usk, sizeX, sizeY, positionX, positionY, rotation, borderEnabled, borderOuterWidth, borderInnerWidth, borderHue, borderSaturation, borderLuma, borderOpacity, shadowEnabled, maskEnabled, maskTop, maskBottom, maskLeft, maskRight }) => {
      const atem = getAtem();

      // Build the DVE settings object — only include properties that were provided
      // Values are passed directly to the ATEM protocol (raw units, no scaling)
      const props: Record<string, unknown> = {};
      if (sizeX !== undefined) props.sizeX = sizeX;
      if (sizeY !== undefined) props.sizeY = sizeY;
      if (positionX !== undefined) props.positionX = positionX;
      if (positionY !== undefined) props.positionY = positionY;
      if (rotation !== undefined) props.rotation = rotation;
      if (borderEnabled !== undefined) props.borderEnabled = borderEnabled;
      if (borderOuterWidth !== undefined) props.borderOuterWidth = borderOuterWidth;
      if (borderInnerWidth !== undefined) props.borderInnerWidth = borderInnerWidth;
      if (borderHue !== undefined) props.borderHue = borderHue;
      if (borderSaturation !== undefined) props.borderSaturation = borderSaturation;
      if (borderLuma !== undefined) props.borderLuma = borderLuma;
      if (borderOpacity !== undefined) props.borderOpacity = borderOpacity;
      if (shadowEnabled !== undefined) props.shadowEnabled = shadowEnabled;
      if (maskEnabled !== undefined) props.maskEnabled = maskEnabled;
      if (maskTop !== undefined) props.maskTop = maskTop;
      if (maskBottom !== undefined) props.maskBottom = maskBottom;
      if (maskLeft !== undefined) props.maskLeft = maskLeft;
      if (maskRight !== undefined) props.maskRight = maskRight;

      if (Object.keys(props).length === 0) {
        return { content: [{ type: 'text', text: 'No DVE properties specified.' }] };
      }

      await atem.setUpstreamKeyerDVESettings(props as any, me, usk);

      const summary: string[] = [];
      if (sizeX !== undefined || sizeY !== undefined) summary.push(`size: ${sizeX ?? '?'}×${sizeY ?? '?'}%`);
      if (positionX !== undefined || positionY !== undefined) summary.push(`pos: (${positionX ?? '?'}, ${positionY ?? '?'})%`);
      if (rotation !== undefined) summary.push(`rot: ${(rotation / 100).toFixed(1)}°`);
      if (borderEnabled !== undefined) summary.push(`border: ${borderEnabled ? 'on' : 'off'}`);
      if (maskEnabled !== undefined) summary.push(`mask: ${maskEnabled ? 'on' : 'off'}`);
      if (shadowEnabled !== undefined) summary.push(`shadow: ${shadowEnabled ? 'on' : 'off'}`);

      return { content: [{ type: 'text', text: `ME${me + 1} USK${usk + 1} DVE: ${summary.join(', ')}` }] };
    }
  );

  // --- Upstream Keyer Mask (screen-space clip) ---

  server.registerTool(
    'atem_set_usk_mask',
    {
      title: 'Set Upstream Keyer Mask',
      description: `Set the screen-space mask (clip region) for an upstream keyer. This defines an absolute rectangle on the output frame — anything outside is hidden.

Use this to clip a DVE overlay to a specific region of the screen (e.g., one cell of a grid layout).

The coordinate system:
  - Left/Right: -16000 to +16000 (left edge to right edge of frame)
  - Top/Bottom: -9000 to +9000 (bottom edge to top edge of frame)
  - Default (full frame): maskLeft=-16000, maskRight=16000, maskTop=9000, maskBottom=-9000

Example — clip to left-third, top-half of frame:
  maskEnabled=true, maskLeft=-16000, maskRight=-5333, maskTop=9000, maskBottom=0

Args:
  - me (number, optional): Mix Effect bus (default: 0)
  - usk (number): Upstream keyer number (0-based)
  - maskEnabled (boolean, optional): Enable/disable the mask
  - maskTop (number, optional): Top edge (-9000 to 9000)
  - maskBottom (number, optional): Bottom edge (-9000 to 9000)
  - maskLeft (number, optional): Left edge (-16000 to 16000)
  - maskRight (number, optional): Right edge (-16000 to 16000)`,
      inputSchema: {
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus'),
        usk: z.number().int().min(0).max(3).describe('Upstream keyer number (0-based)'),
        maskEnabled: z.boolean().optional().describe('Enable mask clipping'),
        maskTop: z.number().int().min(-9000).max(9000).optional().describe('Top edge of visible region'),
        maskBottom: z.number().int().min(-9000).max(9000).optional().describe('Bottom edge of visible region'),
        maskLeft: z.number().int().min(-16000).max(16000).optional().describe('Left edge of visible region'),
        maskRight: z.number().int().min(-16000).max(16000).optional().describe('Right edge of visible region')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ me, usk, maskEnabled, maskTop, maskBottom, maskLeft, maskRight }) => {
      const atem = getAtem();

      const props: Record<string, unknown> = {};
      if (maskEnabled !== undefined) props.maskEnabled = maskEnabled;
      if (maskTop !== undefined) props.maskTop = maskTop;
      if (maskBottom !== undefined) props.maskBottom = maskBottom;
      if (maskLeft !== undefined) props.maskLeft = maskLeft;
      if (maskRight !== undefined) props.maskRight = maskRight;

      if (Object.keys(props).length === 0) {
        return { content: [{ type: 'text', text: 'No mask properties specified.' }] };
      }

      await atem.setUpstreamKeyerMaskSettings(props as any, me, usk);

      const summary: string[] = [];
      if (maskEnabled !== undefined) summary.push(`enabled: ${maskEnabled}`);
      if (maskLeft !== undefined || maskRight !== undefined) summary.push(`L=${maskLeft ?? '?'} R=${maskRight ?? '?'}`);
      if (maskTop !== undefined || maskBottom !== undefined) summary.push(`T=${maskTop ?? '?'} B=${maskBottom ?? '?'}`);

      return { content: [{ type: 'text', text: `ME${me + 1} USK${usk + 1} keyer mask: ${summary.join(', ')}` }] };
    }
  );

  // --- Upstream Keyer State ---

  server.registerTool(
    'atem_get_usk_state',
    {
      title: 'Get Upstream Keyer State',
      description: `Get the current state of upstream keyers on a mix effect bus — type, sources, on-air status, DVE position/size, and key settings.

Args:
  - me (number, optional): Mix Effect bus (default: 0 for ME1)

Returns all upstream keyers with their complete state.`,
      inputSchema: {
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus (0=ME1)')
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ me }) => {
      const atem = getAtem();
      const meState = atem.state?.video?.mixEffects?.[me];
      if (!meState) {
        return { content: [{ type: 'text', text: `ME${me + 1} not available.` }] };
      }

      const keyers = meState.upstreamKeyers ?? [];
      if (keyers.length === 0) {
        return { content: [{ type: 'text', text: `ME${me + 1} has no upstream keyers.` }] };
      }

      const keyTypeNames: Record<number, string> = {
        [Enums.MixEffectKeyType.Luma]: 'Luma',
        [Enums.MixEffectKeyType.Chroma]: 'Chroma',
        [Enums.MixEffectKeyType.Pattern]: 'Pattern',
        [Enums.MixEffectKeyType.DVE]: 'DVE',
      };

      const results = keyers.map((keyer, index) => {
        if (!keyer) return `USK${index + 1}: not available`;

        const lines: string[] = [
          `USK${index + 1}:`,
          `  On Air: ${keyer.onAir}`,
          `  Type: ${keyTypeNames[keyer.mixEffectKeyType] ?? keyer.mixEffectKeyType}`,
          `  Fly Enabled: ${keyer.flyEnabled}`,
          `  Fill: ${keyer.fillSource} (${getInputName(keyer.fillSource)})`,
          `  Cut: ${keyer.cutSource} (${getInputName(keyer.cutSource)})`,
        ];

        if (keyer.dveSettings) {
          const d = keyer.dveSettings;
          lines.push(
            `  DVE Settings:`,
            `    Size: ${d.sizeX} × ${d.sizeY}`,
            `    Position: (${d.positionX}, ${d.positionY})`,
            `    Rotation: ${(d.rotation / 100).toFixed(1)}°`,
            `    Border: ${d.borderEnabled ? 'on' : 'off'}${d.borderEnabled ? ` (outer=${d.borderOuterWidth}, inner=${d.borderInnerWidth})` : ''}`,
            `    Shadow: ${d.shadowEnabled ? 'on' : 'off'}`,
            `    Mask: ${d.maskEnabled ? 'on' : 'off'}${d.maskEnabled ? ` (T=${d.maskTop} B=${d.maskBottom} L=${d.maskLeft} R=${d.maskRight})` : ''}`,
          );
        }

        if (keyer.maskSettings) {
          const m = keyer.maskSettings;
          lines.push(
            `  Mask Settings:`,
            `    Enabled: ${m.maskEnabled}`,
            `    Top: ${m.maskTop}, Bottom: ${m.maskBottom}, Left: ${m.maskLeft}, Right: ${m.maskRight}`,
          );
        }

        return lines.join('\n');
      });

      return { content: [{ type: 'text', text: results.join('\n\n') }] };
    }
  );
}
