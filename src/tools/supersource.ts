import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAtem, getInputName, getActiveInputsByAudioLevel, isLevelTrackingActive, startAutoSwitch, stopAutoSwitch, getAutoSwitchStatus } from '../services/atem-connection.js';
import { Enums } from 'atem-connection';

// ---------------------------------------------------------------------------
// Preset layouts for Super Source
// ---------------------------------------------------------------------------
// Coordinate system (atem-connection library values, 16:9 output):
//   Position x, y: -4800 to 4800 (0 = center of frame)
//   Size: 0-1000 (1000 = full frame 1920×1080, 500 = half 960×540)
//   Crop: 0-18000 per edge (crop_value / 10 = position units removed)
//
// At size S, the box spans:
//   half-width  = 1600 × S / 1000   (full frame half-width = 1600)
//   half-height =  900 × S / 1000   (full frame half-height = 900)
//
// The full visible frame spans x: -1600 to +1600, y: -900 to +900.
//
// Layout math:
//   side_by_side: size=1000 boxes cropped to half-width, positioned at ±800
//   grid_2x2:    size=500 boxes (exactly quarter-frame), no crop needed
//   three_up:    left half = cropped size=1000, right half = two size=500 boxes
//   pip:         size=1000 background + size=250 overlay in corner

interface BoxLayout {
  enabled: boolean;
  x: number;
  y: number;
  size: number;
  cropped: boolean;
  cropTop: number;
  cropBottom: number;
  cropLeft: number;
  cropRight: number;
}

const PRESETS: Record<string, { description: string; boxes: BoxLayout[] }> = {
  side_by_side: {
    description: 'Two equal boxes side by side filling the frame (boxes 1-2). Each source is center-cropped to fill its half.',
    boxes: [
      // Left half: x=-800 centers in left half, crop removes outer quarters of source
      { enabled: true, x: -800, y: 0, size: 1000, cropped: true, cropTop: 0, cropBottom: 0, cropLeft: 8000, cropRight: 8000 },
      // Right half: x=+800 centers in right half
      { enabled: true, x: 800, y: 0, size: 1000, cropped: true, cropTop: 0, cropBottom: 0, cropLeft: 8000, cropRight: 8000 },
      { enabled: false, x: 0, y: 0, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      { enabled: false, x: 0, y: 0, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
    ]
  },
  pip_bottom_right: {
    description: 'Full-screen background with small PiP in bottom-right corner (boxes 1-2)',
    boxes: [
      // Background: full frame
      { enabled: true, x: 0, y: 0, size: 1000, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      // PiP: size=250 (quarter scale) snapped to bottom-right corner
      { enabled: true, x: 1200, y: -675, size: 250, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      { enabled: false, x: 0, y: 0, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      { enabled: false, x: 0, y: 0, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
    ]
  },
  pip_bottom_left: {
    description: 'Full-screen background with small PiP in bottom-left corner (boxes 1-2)',
    boxes: [
      { enabled: true, x: 0, y: 0, size: 1000, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      { enabled: true, x: -1200, y: -675, size: 250, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      { enabled: false, x: 0, y: 0, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      { enabled: false, x: 0, y: 0, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
    ]
  },
  pip_top_right: {
    description: 'Full-screen background with small PiP in top-right corner (boxes 1-2)',
    boxes: [
      { enabled: true, x: 0, y: 0, size: 1000, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      { enabled: true, x: 1200, y: 675, size: 250, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      { enabled: false, x: 0, y: 0, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      { enabled: false, x: 0, y: 0, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
    ]
  },
  pip_top_left: {
    description: 'Full-screen background with small PiP in top-left corner (boxes 1-2)',
    boxes: [
      { enabled: true, x: 0, y: 0, size: 1000, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      { enabled: true, x: -1200, y: 675, size: 250, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      { enabled: false, x: 0, y: 0, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      { enabled: false, x: 0, y: 0, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
    ]
  },
  grid_2x2: {
    description: 'Four equal boxes in a 2×2 grid filling the frame (all 4 boxes). Each source shown at 50% scale, full 16:9, no crop.',
    boxes: [
      // Top-left: edges x[-1600,0] y[0,900]
      { enabled: true, x: -800, y: 450, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      // Top-right: edges x[0,1600] y[0,900]
      { enabled: true, x: 800, y: 450, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      // Bottom-left: edges x[-1600,0] y[-900,0]
      { enabled: true, x: -800, y: -450, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      // Bottom-right: edges x[0,1600] y[-900,0]
      { enabled: true, x: 800, y: -450, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
    ]
  },
  three_up: {
    description: 'One large box on left half, two stacked boxes on right half (boxes 1-3). Left source is center-cropped, right sources shown at 50% scale.',
    boxes: [
      // Left half: same as side_by_side left box
      { enabled: true, x: -800, y: 0, size: 1000, cropped: true, cropTop: 0, cropBottom: 0, cropLeft: 8000, cropRight: 8000 },
      // Top-right quarter: edges x[0,1600] y[0,900]
      { enabled: true, x: 800, y: 450, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      // Bottom-right quarter: edges x[0,1600] y[-900,0]
      { enabled: true, x: 800, y: -450, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
      { enabled: false, x: 0, y: 0, size: 500, cropped: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
    ]
  },
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerSuperSourceTools(server: McpServer): void {

  // ── Tool 1: Get Super Source State ──────────────────────────────────────

  server.registerTool(
    'atem_get_supersource_state',
    {
      title: 'Get Super Source State',
      description: `Get the current Super Source state including all box positions/sources, art settings, and border settings.

Args:
  - ssrcId (number, optional): Super Source index (default: 0). Most ATEMs have only one Super Source.

Returns: JSON object with boxes (array of 4 box states), art properties, and border settings.`,
      inputSchema: {
        ssrcId: z.number().int().min(0).max(3).default(0)
          .describe('Super Source index (0 = first, default)')
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ ssrcId }) => {
      const atem = getAtem();
      const ssrc = atem.state?.video?.superSources?.[ssrcId ?? 0];
      if (!ssrc) {
        const hasSuperSources = atem.state?.video?.superSources && Object.keys(atem.state.video.superSources).length > 0;
        if (!hasSuperSources) {
          return { content: [{ type: 'text', text: 'Super Source not available. This could mean the ATEM model does not support Super Source, or the ATEM state has not fully loaded yet. Try again in a moment, or verify your ATEM model supports Super Source (e.g., ATEM Mini Extreme, Constellation).' }] };
        }
        return { content: [{ type: 'text', text: `Super Source index ${ssrcId ?? 0} not found. Available indices: ${Object.keys(atem.state.video.superSources).join(', ')}` }] };
      }

      const boxes = ssrc.boxes.map((box, i) => {
        if (!box) return { box: i + 1, enabled: false };
        return {
          box: i + 1,
          enabled: box.enabled,
          source: box.source,
          sourceName: getInputName(box.source),
          x: box.x,
          y: box.y,
          size: box.size,
          cropped: box.cropped,
          cropTop: box.cropTop,
          cropBottom: box.cropBottom,
          cropLeft: box.cropLeft,
          cropRight: box.cropRight,
        };
      });

      const art = ssrc.properties ? {
        fillSource: ssrc.properties.artFillSource,
        fillSourceName: getInputName(ssrc.properties.artFillSource),
        cutSource: ssrc.properties.artCutSource,
        cutSourceName: getInputName(ssrc.properties.artCutSource),
        option: ssrc.properties.artOption === Enums.SuperSourceArtOption.Foreground ? 'foreground' : 'background',
        preMultiplied: ssrc.properties.artPreMultiplied,
        clip: ssrc.properties.artClip,
        gain: ssrc.properties.artGain,
        invertKey: ssrc.properties.artInvertKey,
      } : null;

      const border = ssrc.border ? {
        enabled: ssrc.border.borderEnabled,
        bevel: ['none', 'in_out', 'in', 'out'][ssrc.border.borderBevel] ?? 'none',
        outerWidth: ssrc.border.borderOuterWidth,
        innerWidth: ssrc.border.borderInnerWidth,
        outerSoftness: ssrc.border.borderOuterSoftness,
        innerSoftness: ssrc.border.borderInnerSoftness,
        bevelSoftness: ssrc.border.borderBevelSoftness,
        bevelPosition: ssrc.border.borderBevelPosition,
        hue: ssrc.border.borderHue,
        saturation: ssrc.border.borderSaturation,
        luma: ssrc.border.borderLuma,
        lightSourceDirection: ssrc.border.borderLightSourceDirection,
        lightSourceAltitude: ssrc.border.borderLightSourceAltitude,
      } : null;

      const result = { boxes, art, border };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── Tool 2: Set Super Source Box ────────────────────────────────────────

  server.registerTool(
    'atem_set_supersource_box',
    {
      title: 'Set Super Source Box',
      description: `Configure a single Super Source box. Set its source, position, size, and crop. All properties except box number are optional — only specified values are changed.

Args:
  - box (number): Box number (0-3, where 0=Box 1)
  - enabled (boolean, optional): Show or hide this box
  - source (number, optional): Input source number (1=Input 1, 2=Input 2, 3010=Media Player 1, etc.)
  - x (number, optional): Horizontal position (-4800 to 4800, 0=center)
  - y (number, optional): Vertical position (-4800 to 4800, 0=center)
  - size (number, optional): Box size (70 to 1000, where 1000=full size, 500=half)
  - cropped (boolean, optional): Enable or disable crop
  - cropTop (number, optional): Top crop (0-18000)
  - cropBottom (number, optional): Bottom crop (0-18000)
  - cropLeft (number, optional): Left crop (0-18000)
  - cropRight (number, optional): Right crop (0-18000)
  - ssrcId (number, optional): Super Source index (default: 0)`,
      inputSchema: {
        box: z.number().int().min(0).max(3).describe('Box number (0=Box 1, 1=Box 2, 2=Box 3, 3=Box 4)'),
        enabled: z.boolean().optional().describe('Show or hide this box'),
        source: z.number().int().optional().describe('Input source number'),
        x: z.number().int().min(-4800).max(4800).optional().describe('Horizontal position (-4800 to 4800, 0=center)'),
        y: z.number().int().min(-4800).max(4800).optional().describe('Vertical position (-4800 to 4800, 0=center)'),
        size: z.number().int().min(70).max(1000).optional().describe('Box size (70-1000, 1000=full, 500=half)'),
        cropped: z.boolean().optional().describe('Enable/disable crop'),
        cropTop: z.number().int().min(0).max(18000).optional().describe('Top crop (0-18000)'),
        cropBottom: z.number().int().min(0).max(18000).optional().describe('Bottom crop (0-18000)'),
        cropLeft: z.number().int().min(0).max(18000).optional().describe('Left crop (0-18000)'),
        cropRight: z.number().int().min(0).max(18000).optional().describe('Right crop (0-18000)'),
        ssrcId: z.number().int().min(0).max(3).default(0).describe('Super Source index (default: 0)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ box, enabled, source, x, y, size, cropped, cropTop, cropBottom, cropLeft, cropRight, ssrcId }) => {
      const atem = getAtem();
      const props: Record<string, unknown> = {};
      const results: string[] = [];

      if (enabled !== undefined) { props.enabled = enabled; results.push(`enabled=${enabled}`); }
      if (source !== undefined) { props.source = source; results.push(`source=${source} (${getInputName(source)})`); }
      if (x !== undefined) { props.x = x; results.push(`x=${x}`); }
      if (y !== undefined) { props.y = y; results.push(`y=${y}`); }
      if (size !== undefined) { props.size = size; results.push(`size=${size}`); }
      if (cropped !== undefined) { props.cropped = cropped; results.push(`cropped=${cropped}`); }
      if (cropTop !== undefined) { props.cropTop = cropTop; results.push(`cropTop=${cropTop}`); }
      if (cropBottom !== undefined) { props.cropBottom = cropBottom; results.push(`cropBottom=${cropBottom}`); }
      if (cropLeft !== undefined) { props.cropLeft = cropLeft; results.push(`cropLeft=${cropLeft}`); }
      if (cropRight !== undefined) { props.cropRight = cropRight; results.push(`cropRight=${cropRight}`); }

      if (results.length === 0) {
        return { content: [{ type: 'text', text: 'No properties specified. Provide at least one property to change.' }] };
      }

      await atem.setSuperSourceBoxSettings(props, box, ssrcId ?? 0);
      return { content: [{ type: 'text', text: `Super Source Box ${box + 1}: ${results.join(', ')}` }] };
    }
  );

  // ── Tool 3: Set Super Source Layout ─────────────────────────────────────

  server.registerTool(
    'atem_set_supersource_layout',
    {
      title: 'Set Super Source Layout',
      description: `Set up a Super Source layout using a preset or custom box configuration. Configures all 4 boxes at once.

Presets arrange boxes with sensible defaults — just provide the input sources.

Args:
  - preset (string, optional): Layout preset name:
    - "side_by_side": Two equal boxes side by side (sources: [left, right])
    - "pip_bottom_right": Full-screen with small PiP bottom-right (sources: [background, pip])
    - "pip_bottom_left": Full-screen with small PiP bottom-left (sources: [background, pip])
    - "pip_top_right": Full-screen with small PiP top-right (sources: [background, pip])
    - "pip_top_left": Full-screen with small PiP top-left (sources: [background, pip])
    - "grid_2x2": Four equal boxes in 2x2 grid (sources: [topLeft, topRight, bottomLeft, bottomRight])
    - "three_up": Large left + two stacked right (sources: [large, topRight, bottomRight])
  - sources (array of numbers, optional): Input source numbers for each box position in the preset
  - boxes (array of objects, optional): Custom box configs (overrides preset). Each: { enabled, source, x, y, size, cropped, cropTop, cropBottom, cropLeft, cropRight }
  - ssrcId (number, optional): Super Source index (default: 0)

Examples:
  - Side-by-side cameras 1 & 2: preset="side_by_side", sources=[1, 2]
  - 2x2 grid all cameras: preset="grid_2x2", sources=[1, 2, 3, 4]
  - PiP camera 3 over camera 1: preset="pip_bottom_right", sources=[1, 3]`,
      inputSchema: {
        preset: z.enum([
          'side_by_side', 'pip_bottom_right', 'pip_bottom_left',
          'pip_top_right', 'pip_top_left', 'grid_2x2', 'three_up'
        ]).optional().describe('Layout preset name'),
        sources: z.array(z.number().int()).optional()
          .describe('Input source numbers for each box position in the preset'),
        boxes: z.array(z.object({
          enabled: z.boolean().optional(),
          source: z.number().int().optional(),
          x: z.number().int().min(-4800).max(4800).optional(),
          y: z.number().int().min(-4800).max(4800).optional(),
          size: z.number().int().min(70).max(1000).optional(),
          cropped: z.boolean().optional(),
          cropTop: z.number().int().min(0).max(18000).optional(),
          cropBottom: z.number().int().min(0).max(18000).optional(),
          cropLeft: z.number().int().min(0).max(18000).optional(),
          cropRight: z.number().int().min(0).max(18000).optional(),
        })).optional().describe('Custom box configurations (array of up to 4 box objects, overrides preset)'),
        ssrcId: z.number().int().min(0).max(3).default(0).describe('Super Source index (default: 0)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ preset, sources, boxes, ssrcId }) => {
      const atem = getAtem();
      const id = ssrcId ?? 0;

      // Custom box mode
      if (boxes && boxes.length > 0) {
        for (let i = 0; i < 4; i++) {
          if (i < boxes.length && boxes[i]) {
            await atem.setSuperSourceBoxSettings(boxes[i], i, id);
          } else {
            await atem.setSuperSourceBoxSettings({ enabled: false }, i, id);
          }
        }
        const enabledCount = boxes.filter(b => b.enabled !== false).length;
        return { content: [{ type: 'text', text: `Super Source custom layout applied: ${enabledCount} boxes configured` }] };
      }

      // Preset mode
      if (!preset) {
        return { content: [{ type: 'text', text: 'Specify either a preset name or custom boxes array. Available presets: ' + Object.keys(PRESETS).join(', ') }] };
      }

      const layout = PRESETS[preset];
      if (!layout) {
        return { content: [{ type: 'text', text: `Unknown preset "${preset}". Available: ${Object.keys(PRESETS).join(', ')}` }] };
      }

      const sourceNames: string[] = [];
      for (let i = 0; i < 4; i++) {
        const boxLayout = layout.boxes[i];
        const boxProps: Record<string, unknown> = { ...boxLayout };

        // Assign source from the sources array if provided
        if (sources && i < sources.length && boxLayout.enabled) {
          boxProps.source = sources[i];
          sourceNames.push(`Box ${i + 1}: ${getInputName(sources[i])}`);
        }

        await atem.setSuperSourceBoxSettings(boxProps, i, id);
      }

      const sourceInfo = sourceNames.length > 0 ? ` (${sourceNames.join(', ')})` : '';
      return { content: [{ type: 'text', text: `Super Source layout set to "${preset}"${sourceInfo}. Use input 6000 (Super Source) on program or preview to see it.` }] };
    }
  );

  // ── Tool 4: Set Super Source Art ────────────────────────────────────────

  server.registerTool(
    'atem_set_supersource_art',
    {
      title: 'Set Super Source Art',
      description: `Configure the Super Source art (background/foreground) key settings. Controls which source is used as the art layer and how it is keyed.

Args:
  - artFillSource (number, optional): Input source for the art fill
  - artCutSource (number, optional): Input source for the art key/cut
  - artOption (string, optional): "background" or "foreground" — whether art appears behind or in front of boxes
  - artPreMultiplied (boolean, optional): Art source uses pre-multiplied alpha
  - artClip (number, optional): Key clip level (0-1000)
  - artGain (number, optional): Key gain level (0-1000)
  - artInvertKey (boolean, optional): Invert the key signal
  - ssrcId (number, optional): Super Source index (default: 0)`,
      inputSchema: {
        artFillSource: z.number().int().optional().describe('Art fill input source number'),
        artCutSource: z.number().int().optional().describe('Art key/cut input source number'),
        artOption: z.enum(['background', 'foreground']).optional()
          .describe('Art placement: "background" (behind boxes) or "foreground" (in front)'),
        artPreMultiplied: z.boolean().optional().describe('Art source uses pre-multiplied alpha'),
        artClip: z.number().int().min(0).max(1000).optional().describe('Key clip level (0-1000)'),
        artGain: z.number().int().min(0).max(1000).optional().describe('Key gain level (0-1000)'),
        artInvertKey: z.boolean().optional().describe('Invert the key signal'),
        ssrcId: z.number().int().min(0).max(3).default(0).describe('Super Source index (default: 0)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ artFillSource, artCutSource, artOption, artPreMultiplied, artClip, artGain, artInvertKey, ssrcId }) => {
      const atem = getAtem();
      const props: Record<string, unknown> = {};
      const results: string[] = [];

      if (artFillSource !== undefined) { props.artFillSource = artFillSource; results.push(`fill source=${artFillSource} (${getInputName(artFillSource)})`); }
      if (artCutSource !== undefined) { props.artCutSource = artCutSource; results.push(`cut source=${artCutSource} (${getInputName(artCutSource)})`); }
      if (artOption !== undefined) {
        props.artOption = artOption === 'foreground' ? Enums.SuperSourceArtOption.Foreground : Enums.SuperSourceArtOption.Background;
        results.push(`option=${artOption}`);
      }
      if (artPreMultiplied !== undefined) { props.artPreMultiplied = artPreMultiplied; results.push(`pre-multiplied=${artPreMultiplied}`); }
      if (artClip !== undefined) { props.artClip = artClip; results.push(`clip=${artClip}`); }
      if (artGain !== undefined) { props.artGain = artGain; results.push(`gain=${artGain}`); }
      if (artInvertKey !== undefined) { props.artInvertKey = artInvertKey; results.push(`invert key=${artInvertKey}`); }

      if (results.length === 0) {
        return { content: [{ type: 'text', text: 'No art properties specified. Provide at least one property to change.' }] };
      }

      await atem.setSuperSourceProperties(props, ssrcId ?? 0);
      return { content: [{ type: 'text', text: `Super Source art: ${results.join(', ')}` }] };
    }
  );

  // ── Tool 5: Set Super Source Border ─────────────────────────────────────

  server.registerTool(
    'atem_set_supersource_border',
    {
      title: 'Set Super Source Border',
      description: `Configure the Super Source border appearance. Controls border visibility, width, color, bevel, and light source.

Args:
  - borderEnabled (boolean, optional): Enable or disable the border
  - borderBevel (string, optional): Bevel style — "none", "in_out", "in", or "out"
  - borderOuterWidth (number, optional): Outer border width (0-1600)
  - borderInnerWidth (number, optional): Inner border width (0-1600)
  - borderOuterSoftness (number, optional): Outer edge softness (0-100)
  - borderInnerSoftness (number, optional): Inner edge softness (0-100)
  - borderBevelSoftness (number, optional): Bevel softness (0-100)
  - borderBevelPosition (number, optional): Bevel position (0-100)
  - borderHue (number, optional): Border color hue (0-3599, degrees x10)
  - borderSaturation (number, optional): Border color saturation (0-1000)
  - borderLuma (number, optional): Border luminance/brightness (0-1000)
  - borderLightSourceDirection (number, optional): Light source direction (0-3590, degrees x10)
  - borderLightSourceAltitude (number, optional): Light source altitude (0-100)
  - ssrcId (number, optional): Super Source index (default: 0)`,
      inputSchema: {
        borderEnabled: z.boolean().optional().describe('Enable or disable the border'),
        borderBevel: z.enum(['none', 'in_out', 'in', 'out']).optional().describe('Bevel style'),
        borderOuterWidth: z.number().int().min(0).max(1600).optional().describe('Outer border width (0-1600)'),
        borderInnerWidth: z.number().int().min(0).max(1600).optional().describe('Inner border width (0-1600)'),
        borderOuterSoftness: z.number().int().min(0).max(100).optional().describe('Outer edge softness (0-100)'),
        borderInnerSoftness: z.number().int().min(0).max(100).optional().describe('Inner edge softness (0-100)'),
        borderBevelSoftness: z.number().int().min(0).max(100).optional().describe('Bevel softness (0-100)'),
        borderBevelPosition: z.number().int().min(0).max(100).optional().describe('Bevel position (0-100)'),
        borderHue: z.number().int().min(0).max(3599).optional().describe('Border hue (0-3599, degrees x10)'),
        borderSaturation: z.number().int().min(0).max(1000).optional().describe('Border saturation (0-1000)'),
        borderLuma: z.number().int().min(0).max(1000).optional().describe('Border luminance (0-1000)'),
        borderLightSourceDirection: z.number().int().min(0).max(3590).optional().describe('Light direction (0-3590, degrees x10)'),
        borderLightSourceAltitude: z.number().int().min(0).max(100).optional().describe('Light altitude (0-100)'),
        ssrcId: z.number().int().min(0).max(3).default(0).describe('Super Source index (default: 0)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ borderEnabled, borderBevel, borderOuterWidth, borderInnerWidth, borderOuterSoftness, borderInnerSoftness, borderBevelSoftness, borderBevelPosition, borderHue, borderSaturation, borderLuma, borderLightSourceDirection, borderLightSourceAltitude, ssrcId }) => {
      const atem = getAtem();
      const props: Record<string, unknown> = {};
      const results: string[] = [];

      const bevelMap: Record<string, number> = { none: 0, in_out: 1, in: 2, out: 3 };

      if (borderEnabled !== undefined) { props.borderEnabled = borderEnabled; results.push(`enabled=${borderEnabled}`); }
      if (borderBevel !== undefined) { props.borderBevel = bevelMap[borderBevel]; results.push(`bevel=${borderBevel}`); }
      if (borderOuterWidth !== undefined) { props.borderOuterWidth = borderOuterWidth; results.push(`outer width=${borderOuterWidth}`); }
      if (borderInnerWidth !== undefined) { props.borderInnerWidth = borderInnerWidth; results.push(`inner width=${borderInnerWidth}`); }
      if (borderOuterSoftness !== undefined) { props.borderOuterSoftness = borderOuterSoftness; results.push(`outer softness=${borderOuterSoftness}`); }
      if (borderInnerSoftness !== undefined) { props.borderInnerSoftness = borderInnerSoftness; results.push(`inner softness=${borderInnerSoftness}`); }
      if (borderBevelSoftness !== undefined) { props.borderBevelSoftness = borderBevelSoftness; results.push(`bevel softness=${borderBevelSoftness}`); }
      if (borderBevelPosition !== undefined) { props.borderBevelPosition = borderBevelPosition; results.push(`bevel position=${borderBevelPosition}`); }
      if (borderHue !== undefined) { props.borderHue = borderHue; results.push(`hue=${borderHue}`); }
      if (borderSaturation !== undefined) { props.borderSaturation = borderSaturation; results.push(`saturation=${borderSaturation}`); }
      if (borderLuma !== undefined) { props.borderLuma = borderLuma; results.push(`luma=${borderLuma}`); }
      if (borderLightSourceDirection !== undefined) { props.borderLightSourceDirection = borderLightSourceDirection; results.push(`light direction=${borderLightSourceDirection}`); }
      if (borderLightSourceAltitude !== undefined) { props.borderLightSourceAltitude = borderLightSourceAltitude; results.push(`light altitude=${borderLightSourceAltitude}`); }

      if (results.length === 0) {
        return { content: [{ type: 'text', text: 'No border properties specified. Provide at least one property to change.' }] };
      }

      await atem.setSuperSourceBorder(props, ssrcId ?? 0);
      return { content: [{ type: 'text', text: `Super Source border: ${results.join(', ')}` }] };
    }
  );

  // ── Tool 6: Go Gallery ──────────────────────────────────────────────────
  // Sets up a 2x2 grid with the host + 3 guests, prioritizing active speakers
  // based on real-time audio levels from the Fairlight mixer.

  server.registerTool(
    'atem_go_gallery',
    {
      title: 'Go Gallery',
      description: `Set up a 2×2 gallery grid with the host camera and 3 guest cameras, then cut to Super Source.

Prioritizes guests who are currently speaking (detected via real-time audio levels from the Fairlight mixer). The guest with the highest audio level appears in box 2 (top-right), next in box 3 (bottom-left), next in box 4 (bottom-right).

If audio level data is unavailable, falls back to the first 3 guests from the guest list.

Args:
  - hostInput (number, optional): Host camera input (default: 7)
  - guestInputs (array of numbers, optional): All possible guest camera inputs to choose from (default: [1, 2, 3, 4, 5, 6, 8]). The tool picks the 3 most active.
  - cutToProgram (boolean, optional): Automatically cut Super Source to program (default: true)
  - ssrcId (number, optional): Super Source index (default: 0)

Examples:
  - "Go gallery" → 2x2 grid with host (cam 7) + 3 most active guests
  - "Go gallery with guests on 2, 3, 5" → picks 3 most active from cameras 2, 3, 5`,
      inputSchema: {
        hostInput: z.number().int().default(7)
          .describe('Host camera input number (default: 7)'),
        guestInputs: z.array(z.number().int()).optional()
          .describe('Guest camera inputs to choose from (default: all inputs except host). Picks the 3 most active.'),
        cutToProgram: z.boolean().default(true)
          .describe('Cut Super Source to program output (default: true)'),
        ssrcId: z.number().int().min(0).max(3).default(0)
          .describe('Super Source index (default: 0)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ hostInput, guestInputs, cutToProgram, ssrcId }) => {
      const atem = getAtem();
      const host = hostInput ?? 7;
      const id = ssrcId ?? 0;

      // Default guest list: all physical inputs 1-8 except the host
      const candidates = guestInputs ?? [1, 2, 3, 4, 5, 6, 7, 8].filter(i => i !== host);

      // Pick guests — prioritize by audio activity if available
      let selectedGuests: number[];
      let selectionMethod: string;

      if (isLevelTrackingActive()) {
        const activeSpeakers = getActiveInputsByAudioLevel(candidates);
        if (activeSpeakers.length >= 3) {
          selectedGuests = activeSpeakers.slice(0, 3).map(s => s.input);
          selectionMethod = 'by audio activity (loudest first)';
        } else if (activeSpeakers.length > 0) {
          // Mix active speakers with fallback from candidate list
          selectedGuests = activeSpeakers.map(s => s.input);
          const remaining = candidates.filter(c => !selectedGuests.includes(c));
          while (selectedGuests.length < 3 && remaining.length > 0) {
            selectedGuests.push(remaining.shift()!);
          }
          selectionMethod = `${activeSpeakers.length} by audio, ${selectedGuests.length - activeSpeakers.length} fallback`;
        } else {
          // No audio data yet — use first 3 candidates
          selectedGuests = candidates.slice(0, 3);
          selectionMethod = 'no recent audio detected, using first 3 guests';
        }
      } else {
        selectedGuests = candidates.slice(0, 3);
        selectionMethod = 'audio tracking not active, using first 3 guests';
      }

      // Ensure we have exactly 3 guests (pad with candidates if needed)
      while (selectedGuests.length < 3 && candidates.length > 0) {
        const next = candidates.find(c => !selectedGuests.includes(c));
        if (next !== undefined) selectedGuests.push(next);
        else break;
      }

      // Set up 2x2 grid: Host=top-left, guests fill remaining 3 slots
      const sources = [host, ...selectedGuests.slice(0, 3)];
      const gridLayout = PRESETS.grid_2x2;

      for (let i = 0; i < 4; i++) {
        const boxLayout = gridLayout.boxes[i];
        const boxProps: Record<string, unknown> = { ...boxLayout };
        if (i < sources.length) {
          boxProps.source = sources[i];
        }
        await atem.setSuperSourceBoxSettings(boxProps, i, id);
      }

      // Cut to Super Source on program
      if (cutToProgram !== false) {
        await atem.changeProgramInput(6000);
      }

      const guestNames = selectedGuests.slice(0, 3).map(g => `${getInputName(g)} (${g})`).join(', ');
      return {
        content: [{
          type: 'text',
          text: `Gallery view live! 2×2 grid:\n` +
            `  Box 1 (top-left): ${getInputName(host)} (${host}) [HOST]\n` +
            `  Box 2 (top-right): ${selectedGuests[0] !== undefined ? `${getInputName(selectedGuests[0])} (${selectedGuests[0]})` : 'none'}\n` +
            `  Box 3 (bottom-left): ${selectedGuests[1] !== undefined ? `${getInputName(selectedGuests[1])} (${selectedGuests[1]})` : 'none'}\n` +
            `  Box 4 (bottom-right): ${selectedGuests[2] !== undefined ? `${getInputName(selectedGuests[2])} (${selectedGuests[2]})` : 'none'}\n` +
            `Guest selection: ${selectionMethod}`
        }]
      };
    }
  );

  // ── Tool 7: Cut to Active Speaker ─────────────────────────────────────
  // Detects the guest with the highest audio level and cuts to them full-screen.

  server.registerTool(
    'atem_cut_to_active_speaker',
    {
      title: 'Cut to Active Speaker',
      description: `Cut full-screen to the active speaker — the guest with the highest audio level (loudest VU meters).

Uses real-time Fairlight audio level data to detect who is currently talking and puts them on program.

Args:
  - guestInputs (array of numbers, optional): Guest camera inputs to consider (default: all inputs 1-8 except host). Only guests in this list are eligible.
  - hostInput (number, optional): Host camera input to exclude from active speaker detection (default: 7)
  - transition (string, optional): How to switch — "cut" (instant) or "auto" (use current transition settings). Default: "cut"
  - me (number, optional): Mix Effect bus (default: 0 for ME1)

Examples:
  - "Cut to active speaker" → detects loudest guest, hard cuts to them
  - "Cut to active speaker with a dissolve" → transition="auto"`,
      inputSchema: {
        guestInputs: z.array(z.number().int()).optional()
          .describe('Guest camera inputs to consider (default: all inputs 1-8 except host)'),
        hostInput: z.number().int().default(7)
          .describe('Host camera to exclude from detection (default: 7)'),
        transition: z.enum(['cut', 'auto']).default('cut')
          .describe('Transition type: "cut" (instant) or "auto" (dissolve/wipe). Default: "cut"'),
        me: z.number().int().min(0).max(3).default(0)
          .describe('Mix Effect bus (default: 0 for ME1)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ guestInputs, hostInput, transition, me }) => {
      const atem = getAtem();
      const host = hostInput ?? 7;
      const meIndex = me ?? 0;
      const candidates = guestInputs ?? [1, 2, 3, 4, 5, 6, 7, 8].filter(i => i !== host);

      if (!isLevelTrackingActive()) {
        return { content: [{ type: 'text', text: 'Audio level tracking is not active. Cannot detect active speaker. The ATEM may not have Fairlight audio, or the connection may still be initializing.' }] };
      }

      const activeSpeakers = getActiveInputsByAudioLevel(candidates);
      if (activeSpeakers.length === 0) {
        return { content: [{ type: 'text', text: `No active audio detected on guest inputs [${candidates.join(', ')}]. No one appears to be speaking right now.` }] };
      }

      const speaker = activeSpeakers[0];
      const speakerName = getInputName(speaker.input);

      // Set preview then transition, or hard cut
      if ((transition ?? 'cut') === 'auto') {
        await atem.changePreviewInput(speaker.input, meIndex);
        await atem.autoTransition(meIndex);
      } else {
        await atem.changeProgramInput(speaker.input, meIndex);
      }

      return {
        content: [{
          type: 'text',
          text: `Active speaker: ${speakerName} (input ${speaker.input}) — now on program${(transition ?? 'cut') === 'auto' ? ' (auto transition)' : ' (cut)'}`
        }]
      };
    }
  );

  // ── Tool 8: Auto Switch On ──────────────────────────────────────────────
  // Starts continuous auto-switching to the active speaker.

  server.registerTool(
    'atem_auto_switch_on',
    {
      title: 'Auto Switch On',
      description: `Start auto-switching mode — continuously monitors audio levels and switches to the active speaker automatically, Zoom-style.

Three modes:
  - **program** (default): Switches the full-screen program input to the active speaker
  - **ssrc_box**: Updates a Super Source box source to the active speaker — perfect for "host + active speaker" side-by-side
  - **host_ssrc**: Hybrid mode — host talking → cuts to host full-screen; guest talking → updates Super Source box with that guest AND cuts to Super Source (6000). Perfect for talk shows where the host gets their own shot but guests share a side-by-side with the host.

Fast and responsive like Zoom's active speaker switching:
  - **Instant detection** — uses real-time audio peaks to detect new speakers immediately
  - **Hold time** (default 1s): brief confirmation to filter out coughs/bumps
  - **Cooldown** (default 2s): short pause after switching to prevent ping-pong
  - **Smart stickiness** — the current speaker uses smoothed audio levels so brief pauses between words don't cause a switch away

Args:
  - mode (string, optional): "program", "ssrc_box", or "host_ssrc" (default: "program")
  - ssrcBox (number, optional): Super Source box to update, 1-4 (default: 2). Used in ssrc_box and host_ssrc modes.
  - guestInputs (array of numbers, optional): Inputs to monitor (default: all inputs 1-8 except host; in host_ssrc mode, host is automatically included)
  - hostInput (number, optional): Host camera input (default: 7). In host_ssrc mode, this is who gets full-screen when they talk.
  - holdMs (number, optional): How long a new speaker must talk before switching, in ms (default: 1000)
  - cooldownMs (number, optional): Minimum ms between switches (default: 2000)
  - transition (string, optional): "cut" or "auto" (default: "cut"). Only used in program mode.
  - me (number, optional): Mix Effect bus (default: 0)

Examples:
  - "Auto switch" → starts following the active speaker (full-screen)
  - "Auto switch box 2 to active speaker" → mode="ssrc_box", ssrcBox=2
  - "Host full-screen when talking, side-by-side when guest talks" → mode="host_ssrc", ssrcBox=2
  - "Auto switch with dissolves" → transition="auto"
  - "Auto switch on all cameras" → guestInputs=[1,2,3,4,5,6,7,8], hostInput=0`,
      inputSchema: {
        mode: z.enum(['program', 'ssrc_box', 'host_ssrc']).default('program')
          .describe('Mode: "program" switches full-screen, "ssrc_box" updates a Super Source box source, "host_ssrc" host full-screen + guest in Super Source'),
        ssrcBox: z.number().int().min(1).max(4).default(2)
          .describe('Super Source box to update (1-4, default: 2). Only used in ssrc_box mode.'),
        guestInputs: z.array(z.number().int()).optional()
          .describe('Camera inputs to monitor (default: all 1-8 except host)'),
        hostInput: z.number().int().default(7)
          .describe('Host camera to exclude (default: 7). Set to 0 to include all inputs.'),
        holdMs: z.number().int().min(200).max(10000).default(1000)
          .describe('Hold time in ms — new speaker must talk this long before switching (default: 1000)'),
        cooldownMs: z.number().int().min(500).max(15000).default(2000)
          .describe('Cooldown in ms — minimum time between switches (default: 2000)'),
        intervalMs: z.number().int().min(100).max(5000).default(250)
          .describe('Level check interval in ms (default: 250)'),
        transition: z.enum(['cut', 'auto']).default('cut')
          .describe('Transition type: "cut" or "auto" (default: "cut"). Only used in program mode.'),
        me: z.number().int().min(0).max(3).default(0)
          .describe('Mix Effect bus (default: 0)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ mode, ssrcBox, guestInputs, hostInput, holdMs, cooldownMs, intervalMs, transition, me }) => {
      const result = startAutoSwitch({
        candidates: guestInputs,
        hostInput: hostInput ?? 7,
        holdMs: holdMs ?? 1000,
        cooldownMs: cooldownMs ?? 2000,
        intervalMs: intervalMs ?? 250,
        me: me ?? 0,
        transition: transition ?? 'cut',
        mode: mode ?? 'program',
        ssrcBox: (ssrcBox ?? 2) - 1,  // Convert 1-based (user) to 0-based (API)
        ssrcId: 0,
      });
      return { content: [{ type: 'text', text: result }] };
    }
  );

  // ── Tool 9: Auto Switch Off ─────────────────────────────────────────────

  server.registerTool(
    'atem_auto_switch_off',
    {
      title: 'Auto Switch Off',
      description: `Stop auto-switching mode. The current program input stays on air — switching simply stops following the active speaker.

Also returns stats: how long auto-switch ran and how many switches it performed.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const result = stopAutoSwitch();
      return { content: [{ type: 'text', text: result }] };
    }
  );

  // ── Tool 10: Auto Switch Status ─────────────────────────────────────────

  server.registerTool(
    'atem_get_auto_switch_status',
    {
      title: 'Auto Switch Status',
      description: `Check if auto-switch mode is currently running and get its configuration and stats.

Returns: running state, monitored inputs, hold time, transition type, current speaker, switch count, and runtime.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const status = getAutoSwitchStatus();
      if (!status.running) {
        return { content: [{ type: 'text', text: 'Auto-switch is not running.' }] };
      }
      const currentName = status.currentSpeaker ? getInputName(status.currentSpeaker) : 'none yet';
      const modeStr = status.mode === 'host_ssrc'
        ? `Host + Super Source (host=${status.hostInput ?? 7} full-screen, guests→box ${(status.ssrcBox ?? 0) + 1})`
        : status.mode === 'ssrc_box'
        ? `Super Source box ${(status.ssrcBox ?? 0) + 1}`
        : `Program (${status.transition})`;
      return {
        content: [{
          type: 'text',
          text: `Auto-switch is ACTIVE\n` +
            `  Mode: ${modeStr}\n` +
            `  Monitoring: inputs [${status.candidates?.join(', ')}]\n` +
            `  Hold time: ${(status.holdMs ?? 1000) / 1000}s\n` +
            `  Cooldown: ${(status.cooldownMs ?? 2000) / 1000}s\n` +
            `  Current speaker: ${currentName}${status.currentSpeaker ? ` (input ${status.currentSpeaker})` : ''}\n` +
            `  Switches: ${status.switchCount}\n` +
            `  Running for: ${status.runningForSeconds}s`
        }]
      };
    }
  );
}
