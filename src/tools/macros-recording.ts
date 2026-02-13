import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAtem } from '../services/atem-connection.js';

export function registerMacroTools(server: McpServer): void {

  server.registerTool(
    'atem_macro_run',
    {
      title: 'Run Macro',
      description: `Run an ATEM macro by index number.

Args:
  - index (number): Macro slot number (0-based, so macro 0 = first macro slot)`,
      inputSchema: {
        index: z.number().int().min(0).max(99).describe('Macro index (0-based)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async ({ index }) => {
      const atem = getAtem();
      await atem.macroRun(index);
      return { content: [{ type: 'text', text: `Macro ${index} running` }] };
    }
  );

  server.registerTool(
    'atem_macro_stop',
    {
      title: 'Stop Macro',
      description: 'Stop the currently running macro.',
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const atem = getAtem();
      await atem.macroStop();
      return { content: [{ type: 'text', text: 'Macro stopped' }] };
    }
  );

  server.registerTool(
    'atem_macro_continue',
    {
      title: 'Continue Macro',
      description: 'Continue a paused macro.',
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async () => {
      const atem = getAtem();
      await atem.macroContinue();
      return { content: [{ type: 'text', text: 'Macro continued' }] };
    }
  );

  server.registerTool(
    'atem_list_macros',
    {
      title: 'List Macros',
      description: `List all defined macros on the ATEM switcher.

Returns: JSON array of macros with their index, name, and whether they are valid/used.`,
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
      const macros = atem.state?.macro?.macroProperties ?? [];
      const result: Array<{ index: number; name: string; isUsed: boolean }> = [];

      macros.forEach((macro, idx) => {
        if (macro && macro.isUsed) {
          result.push({
            index: idx,
            name: macro.name ?? `Macro ${idx}`,
            isUsed: macro.isUsed
          });
        }
      });

      if (result.length === 0) {
        return { content: [{ type: 'text', text: 'No macros defined on this ATEM.' }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

export function registerRecordingStreamingTools(server: McpServer): void {

  server.registerTool(
    'atem_start_recording',
    {
      title: 'Start Recording',
      description: 'Start recording on the ATEM (requires USB storage connected to the switcher). Available on models with recording capability.',
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const atem = getAtem();
      await atem.startRecording();
      return { content: [{ type: 'text', text: 'Recording started' }] };
    }
  );

  server.registerTool(
    'atem_stop_recording',
    {
      title: 'Stop Recording',
      description: 'Stop recording on the ATEM.',
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const atem = getAtem();
      await atem.stopRecording();
      return { content: [{ type: 'text', text: 'Recording stopped' }] };
    }
  );

  server.registerTool(
    'atem_start_streaming',
    {
      title: 'Start Streaming',
      description: 'Start streaming on the ATEM (requires streaming to be configured in ATEM Software Control). Available on models with streaming capability.',
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const atem = getAtem();
      await atem.startStreaming();
      return { content: [{ type: 'text', text: 'Streaming started' }] };
    }
  );

  server.registerTool(
    'atem_stop_streaming',
    {
      title: 'Stop Streaming',
      description: 'Stop streaming on the ATEM.',
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      const atem = getAtem();
      await atem.stopStreaming();
      return { content: [{ type: 'text', text: 'Streaming stopped' }] };
    }
  );

  server.registerTool(
    'atem_get_recording_status',
    {
      title: 'Get Recording/Streaming Status',
      description: 'Get the current recording and streaming status from the ATEM.',
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
      const state = atem.state;

      const status = {
        recording: {
          state: state?.recording?.status?.state ?? 'unknown',
          error: state?.recording?.status?.error ?? 'none',
          duration: state?.recording?.duration ?? null
        },
        streaming: {
          state: state?.streaming?.status?.state ?? 'unknown',
          error: state?.streaming?.status?.error ?? 'none',
          duration: state?.streaming?.duration ?? null
        }
      };

      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    }
  );
}
