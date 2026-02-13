import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAtem } from '../services/atem-connection.js';
import { Enums } from 'atem-connection';

export function registerTransitionTools(server: McpServer): void {

  server.registerTool(
    'atem_set_transition_style',
    {
      title: 'Set Transition Style',
      description: `Set the transition style (mix, dip, wipe, DVE, stinger) for auto transitions.

Args:
  - style (string): Transition type — "mix", "dip", "wipe", "dve", or "stinger"
  - me (number, optional): Mix Effect bus number (default: 0 for ME1)`,
      inputSchema: {
        style: z.enum(['mix', 'dip', 'wipe', 'dve', 'stinger']).describe('Transition style'),
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus (0=ME1, 1=ME2, etc.)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ style, me }) => {
      const atem = getAtem();
      const styleMap: Record<string, Enums.TransitionStyle> = {
        mix: Enums.TransitionStyle.MIX,
        dip: Enums.TransitionStyle.DIP,
        wipe: Enums.TransitionStyle.WIPE,
        dve: Enums.TransitionStyle.DVE,
        stinger: Enums.TransitionStyle.STING
      };
      await atem.setTransitionStyle({ nextStyle: styleMap[style] }, me);
      return { content: [{ type: 'text', text: `Transition style set to ${style.toUpperCase()} on ME${me + 1}` }] };
    }
  );

  server.registerTool(
    'atem_set_transition_rate',
    {
      title: 'Set Transition Rate',
      description: `Set the transition duration/rate in frames for a specific transition type.

Args:
  - style (string): Which transition to set the rate for — "mix", "dip", "wipe", "dve", or "stinger"
  - rate (number): Duration in frames (e.g., 30 = 1 second at 30fps, 60 = 2 seconds)
  - me (number, optional): Mix Effect bus number (default: 0 for ME1)`,
      inputSchema: {
        style: z.enum(['mix', 'dip', 'wipe', 'dve', 'stinger']).describe('Which transition type to configure'),
        rate: z.number().int().min(1).max(250).describe('Duration in frames'),
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus (0=ME1, 1=ME2, etc.)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ style, rate, me }) => {
      const atem = getAtem();
      switch (style) {
        case 'mix':
          await atem.setMixTransitionSettings({ rate }, me);
          break;
        case 'dip':
          await atem.setDipTransitionSettings({ rate }, me);
          break;
        case 'wipe':
          await atem.setWipeTransitionSettings({ rate }, me);
          break;
        case 'dve':
          await atem.setDVETransitionSettings({ rate }, me);
          break;
        case 'stinger':
          // Stinger uses clip duration rather than a simple rate
          await atem.setStingerTransitionSettings({ mixRate: rate }, me);
          break;
      }
      return { content: [{ type: 'text', text: `${style.toUpperCase()} transition rate set to ${rate} frames on ME${me + 1}` }] };
    }
  );

  server.registerTool(
    'atem_set_transition_position',
    {
      title: 'Set Transition Position (T-Bar)',
      description: `Manually set the transition position, like moving the T-bar. Useful for manual fades.

Args:
  - position (number): Position from 0.0 (preview) to 1.0 (program). 0 = fully on current program, 1 = fully transitioned to preview.
  - me (number, optional): Mix Effect bus number (default: 0 for ME1)`,
      inputSchema: {
        position: z.number().min(0).max(1).describe('Transition position (0.0 to 1.0)'),
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus (0=ME1, 1=ME2, etc.)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ position, me }) => {
      const atem = getAtem();
      // ATEM expects 0-10000 range
      const atemPosition = Math.round(position * 10000);
      await atem.setTransitionPosition(atemPosition, me);
      return { content: [{ type: 'text', text: `Transition position set to ${(position * 100).toFixed(0)}% on ME${me + 1}` }] };
    }
  );

  server.registerTool(
    'atem_get_transition_state',
    {
      title: 'Get Transition State',
      description: `Get current transition settings for a Mix Effect bus including style, rates, and in-transition status.

Args:
  - me (number, optional): Mix Effect bus number (default: 0 for ME1)

Returns: JSON with current transition style, rates per type, and whether a transition is currently in progress.`,
      inputSchema: {
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus (0=ME1, 1=ME2, etc.)')
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
        return { content: [{ type: 'text', text: `ME${me + 1} not available on this ATEM model.` }] };
      }

      const styleNames: Record<number, string> = {
        0: 'Mix', 1: 'Dip', 2: 'Wipe', 3: 'DVE', 4: 'Stinger'
      };

      const transitionState = {
        currentStyle: styleNames[meState.transitionProperties?.nextStyle ?? 0] ?? 'Unknown',
        inTransition: meState.transitionPosition?.inTransition ?? false,
        transitionPosition: meState.transitionPosition?.handlePosition ?? 0,
        rates: {
          mix: meState.transitionSettings?.mix?.rate ?? 'N/A',
          dip: meState.transitionSettings?.dip?.rate ?? 'N/A',
          wipe: meState.transitionSettings?.wipe?.rate ?? 'N/A',
          dve: meState.transitionSettings?.DVE?.rate ?? 'N/A'
        },
        fadeToBlack: {
          isFullyBlack: meState.fadeToBlack?.isFullyBlack ?? false,
          inTransition: meState.fadeToBlack?.inTransition ?? false,
          rate: meState.fadeToBlack?.rate ?? 'N/A'
        }
      };

      return { content: [{ type: 'text', text: JSON.stringify(transitionState, null, 2) }] };
    }
  );
}
