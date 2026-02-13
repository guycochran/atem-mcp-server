import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAtem, getInputName } from '../services/atem-connection.js';
import { Enums } from 'atem-connection';

export function registerAudioTools(server: McpServer): void {

  server.registerTool(
    'atem_set_audio_mixer_input',
    {
      title: 'Set Audio Input Properties',
      description: `Configure an audio input on the ATEM's built-in audio mixer. Set gain, balance, and whether the input is on, off, or in audio-follow-video mode.

Args:
  - input (number): Audio input number (matches video input numbers)
  - mixOption (string, optional): "on" (always on), "off" (muted), or "afv" (audio-follow-video — audio is live only when this input is on program)
  - gain (number, optional): Gain in dB (-60 to +6)
  - balance (number, optional): Stereo balance (-1.0 = full left, 0 = center, 1.0 = full right)`,
      inputSchema: {
        input: z.number().int().describe('Audio input number'),
        mixOption: z.enum(['on', 'off', 'afv']).optional().describe('Mix option: on, off, or afv (audio-follow-video)'),
        gain: z.number().min(-60).max(6).optional().describe('Gain in dB (-60 to +6)'),
        balance: z.number().min(-1).max(1).optional().describe('Balance (-1 left, 0 center, 1 right)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ input, mixOption, gain, balance }) => {
      const atem = getAtem();
      const props: Record<string, unknown> = {};
      const results: string[] = [];

      if (mixOption !== undefined) {
        const mixOptionMap: Record<string, number> = {
          off: Enums.AudioMixOption.Off,
          on: Enums.AudioMixOption.On,
          afv: Enums.AudioMixOption.AudioFollowVideo
        };
        props.mixOption = mixOptionMap[mixOption];
        results.push(`mix = ${mixOption}`);
      }

      if (gain !== undefined) {
        props.gain = gain;
        results.push(`gain = ${gain} dB`);
      }

      if (balance !== undefined) {
        // ATEM expects -50 to +50
        props.balance = Math.round(balance * 50);
        results.push(`balance = ${balance}`);
      }

      if (Object.keys(props).length === 0) {
        return { content: [{ type: 'text', text: 'No audio properties specified.' }] };
      }

      await atem.setClassicAudioMixerInputProps(input, props as Record<string, unknown>);
      return { content: [{ type: 'text', text: `Audio input ${input} (${getInputName(input)}): ${results.join(', ')}` }] };
    }
  );

  server.registerTool(
    'atem_set_audio_master_output',
    {
      title: 'Set Audio Master Output',
      description: `Configure the master audio output level.

Args:
  - gain (number, optional): Master output gain in dB (-60 to +6)
  - followFadeToBlack (boolean, optional): Whether master audio follows Fade to Black`,
      inputSchema: {
        gain: z.number().min(-60).max(6).optional().describe('Master gain in dB'),
        followFadeToBlack: z.boolean().optional().describe('Follow Fade to Black')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ gain, followFadeToBlack }) => {
      const atem = getAtem();
      const props: Record<string, unknown> = {};
      const results: string[] = [];

      if (gain !== undefined) {
        props.gain = gain;
        results.push(`gain = ${gain} dB`);
      }
      if (followFadeToBlack !== undefined) {
        props.followFadeToBlack = followFadeToBlack;
        results.push(`followFTB = ${followFadeToBlack}`);
      }

      if (Object.keys(props).length === 0) {
        return { content: [{ type: 'text', text: 'No properties specified.' }] };
      }

      await atem.setClassicAudioMixerMasterProps(props as Record<string, unknown>);
      return { content: [{ type: 'text', text: `Master audio: ${results.join(', ')}` }] };
    }
  );

  server.registerTool(
    'atem_get_audio_state',
    {
      title: 'Get Audio Mixer State',
      description: `Get the current audio mixer state including all input levels, mix options, and master output settings.

Returns: JSON object with master output settings and per-input audio state.`,
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
      const audioState = atem.state?.audio;

      if (!audioState) {
        return { content: [{ type: 'text', text: 'Classic audio mixer not available on this ATEM model (may use Fairlight audio instead).' }] };
      }

      const mixOptionNames: Record<number, string> = {
        0: 'off',
        1: 'on',
        2: 'afv'
      };

      const inputs: Record<string, unknown> = {};
      if (audioState.channels) {
        for (const [id, channel] of Object.entries(audioState.channels)) {
          if (channel) {
            inputs[`Input ${id} (${getInputName(parseInt(id))})`] = {
              mixOption: mixOptionNames[channel.mixOption ?? 0] ?? 'unknown',
              gain_dB: channel.gain ?? 0,
              balance: channel.balance ?? 0
            };
          }
        }
      }

      const result = {
        master: {
          gain_dB: audioState.master?.gain ?? 0,
          followFadeToBlack: audioState.master?.followFadeToBlack ?? false
        },
        inputs
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}
