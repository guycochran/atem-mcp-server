import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAtem, getInputName } from '../services/atem-connection.js';

export function registerSwitchingTools(server: McpServer): void {

  server.registerTool(
    'atem_set_program',
    {
      title: 'Set Program Input',
      description: `Set the program (live/on-air) input on the ATEM switcher.

Args:
  - input (number): Input source number (e.g., 1=Input 1, 2=Input 2, 1000=Color Bars, 2001=Color 1, 3010=Media Player 1, 3020=Media Player 2, 6000=Super Source, 10010=Black)
  - me (number, optional): Mix Effect bus number (default: 0 for ME1)

Common input IDs: 1-20 = physical inputs, 1000 = color bars, 2001/2002 = color generators, 3010/3020 = media players, 6000 = super source, 10010 = black.`,
      inputSchema: {
        input: z.number().int().describe('Input source number'),
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus (0=ME1, 1=ME2, etc.)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ input, me }) => {
      const atem = getAtem();
      await atem.changeProgramInput(input, me);
      const name = getInputName(input);
      return { content: [{ type: 'text', text: `Program (ME${me + 1}) set to input ${input} (${name})` }] };
    }
  );

  server.registerTool(
    'atem_set_preview',
    {
      title: 'Set Preview Input',
      description: `Set the preview (next) input on the ATEM switcher.

Args:
  - input (number): Input source number (same IDs as atem_set_program)
  - me (number, optional): Mix Effect bus number (default: 0 for ME1)`,
      inputSchema: {
        input: z.number().int().describe('Input source number'),
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus (0=ME1, 1=ME2, etc.)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ input, me }) => {
      const atem = getAtem();
      await atem.changePreviewInput(input, me);
      const name = getInputName(input);
      return { content: [{ type: 'text', text: `Preview (ME${me + 1}) set to input ${input} (${name})` }] };
    }
  );

  server.registerTool(
    'atem_cut',
    {
      title: 'Cut Transition',
      description: `Perform a hard cut transition — instantly switches preview to program.

Args:
  - me (number, optional): Mix Effect bus number (default: 0 for ME1)`,
      inputSchema: {
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus (0=ME1, 1=ME2, etc.)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ me }) => {
      const atem = getAtem();
      await atem.cut(me);
      return { content: [{ type: 'text', text: `Cut performed on ME${me + 1}` }] };
    }
  );

  server.registerTool(
    'atem_auto_transition',
    {
      title: 'Auto Transition',
      description: `Trigger an auto transition (dissolve, wipe, etc.) from preview to program using the current transition settings.

Args:
  - me (number, optional): Mix Effect bus number (default: 0 for ME1)`,
      inputSchema: {
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus (0=ME1, 1=ME2, etc.)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ me }) => {
      const atem = getAtem();
      await atem.autoTransition(me);
      return { content: [{ type: 'text', text: `Auto transition triggered on ME${me + 1}` }] };
    }
  );

  server.registerTool(
    'atem_fade_to_black',
    {
      title: 'Fade to Black',
      description: `Toggle Fade to Black (FTB). If currently live, fades to black. If already in FTB, fades back up.

Args:
  - me (number, optional): Mix Effect bus number (default: 0 for ME1)`,
      inputSchema: {
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus (0=ME1, 1=ME2, etc.)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ me }) => {
      const atem = getAtem();
      await atem.fadeToBlack(me);
      return { content: [{ type: 'text', text: `Fade to Black toggled on ME${me + 1}` }] };
    }
  );

  server.registerTool(
    'atem_preview_and_auto',
    {
      title: 'Set Preview and Auto Transition',
      description: `Convenience tool: sets a preview input then immediately triggers an auto transition to bring it on air. Equivalent to selecting a source and pressing AUTO.

Args:
  - input (number): Input source number to transition to
  - me (number, optional): Mix Effect bus number (default: 0 for ME1)`,
      inputSchema: {
        input: z.number().int().describe('Input source number to transition to'),
        me: z.number().int().min(0).max(3).default(0).describe('Mix Effect bus (0=ME1, 1=ME2, etc.)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ input, me }) => {
      const atem = getAtem();
      await atem.changePreviewInput(input, me);
      // Small delay to let the ATEM register the preview change
      await new Promise(resolve => setTimeout(resolve, 50));
      await atem.autoTransition(me);
      const name = getInputName(input);
      return { content: [{ type: 'text', text: `Transitioning to input ${input} (${name}) on ME${me + 1}` }] };
    }
  );
}
