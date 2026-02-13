import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAtem, getInputName } from '../services/atem-connection.js';
import { Enums } from 'atem-connection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if this ATEM uses Fairlight audio (Mini Extreme, Constellation, etc.) */
function hasFairlight(): boolean {
  const atem = getAtem();
  return !!atem.state?.fairlight;
}

/** Returns true if this ATEM uses the classic audio mixer (Mini, Mini Pro, etc.) */
function hasClassicAudio(): boolean {
  const atem = getAtem();
  return !!atem.state?.audio;
}

/** Find the first source ID string for a Fairlight input. Returns '-65280' style string. */
function getFairlightSourceId(inputIndex: number): string | null {
  const atem = getAtem();
  const input = atem.state?.fairlight?.inputs?.[inputIndex];
  if (!input) return null;
  const sourceIds = Object.keys(input.sources);
  return sourceIds.length > 0 ? sourceIds[0] : null;
}

// Fairlight uses hundredths of dB internally: -500 = -5.00 dB, 600 = +6.00 dB
function dbToFairlight(db: number): number { return Math.round(db * 100); }
function fairlightToDb(val: number): number { return val / 100; }

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerAudioTools(server: McpServer): void {

  // ── Set Audio Input ──────────────────────────────────────────────────────

  server.registerTool(
    'atem_set_audio_mixer_input',
    {
      title: 'Set Audio Input Properties',
      description: `Configure an audio input on the ATEM. Automatically uses Fairlight audio (ATEM Mini Extreme, Constellation) or classic mixer (ATEM Mini, Mini Pro) depending on the model.

Args:
  - input (number): Audio input number (matches video input numbers, e.g. 1=Camera 1, 2=Camera 2)
  - mixOption (string, optional): "on" (always on), "off" (muted), or "afv" (audio-follow-video — audio is live only when this input is on program)
  - gain (number, optional): Input gain in dB (-60 to +6). On Fairlight this is the pre-fader gain knob.
  - faderGain (number, optional): Fader level in dB (-100 to +10). Fairlight only — this is the main channel fader.
  - balance (number, optional): Stereo balance (-1.0 = full left, 0 = center, 1.0 = full right)`,
      inputSchema: {
        input: z.number().int().describe('Audio input number (matches video input, e.g. 1=Camera 1)'),
        mixOption: z.enum(['on', 'off', 'afv']).optional().describe('Mix option: on, off, or afv (audio-follow-video)'),
        gain: z.number().min(-60).max(6).optional().describe('Input gain in dB (-60 to +6)'),
        faderGain: z.number().min(-100).max(10).optional().describe('Fader level in dB (-100 to +10, Fairlight only)'),
        balance: z.number().min(-1).max(1).optional().describe('Balance (-1 left, 0 center, 1 right)')
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ input, mixOption, gain, faderGain, balance }) => {
      const atem = getAtem();
      const results: string[] = [];

      // ── Fairlight audio path ──
      if (hasFairlight()) {
        const sourceId = getFairlightSourceId(input);
        if (!sourceId) {
          const availableInputs = Object.keys(atem.state?.fairlight?.inputs || {}).join(', ');
          return { content: [{ type: 'text', text: `Fairlight input ${input} not found. Available inputs: ${availableInputs}` }] };
        }

        const props: Record<string, unknown> = {};

        if (mixOption !== undefined) {
          const fairlightMixMap: Record<string, number> = {
            off: Enums.FairlightAudioMixOption.Off,
            on: Enums.FairlightAudioMixOption.On,
            afv: Enums.FairlightAudioMixOption.AudioFollowVideo
          };
          props.mixOption = fairlightMixMap[mixOption];
          results.push(`mix = ${mixOption}`);
        }
        if (gain !== undefined) {
          props.gain = dbToFairlight(gain);
          results.push(`gain = ${gain} dB`);
        }
        if (faderGain !== undefined) {
          props.faderGain = dbToFairlight(faderGain);
          results.push(`fader = ${faderGain} dB`);
        }
        if (balance !== undefined) {
          // Fairlight balance: -5000 to +5000 (hundredths mapped from -50 to +50)
          props.balance = Math.round(balance * 5000);
          results.push(`balance = ${balance}`);
        }

        if (Object.keys(props).length === 0) {
          return { content: [{ type: 'text', text: 'No audio properties specified.' }] };
        }

        await atem.setFairlightAudioMixerSourceProps(input, sourceId, props);
        return { content: [{ type: 'text', text: `Audio input ${input} (${getInputName(input)}) [Fairlight]: ${results.join(', ')}` }] };
      }

      // ── Classic audio mixer path ──
      if (hasClassicAudio()) {
        const props: Record<string, unknown> = {};

        if (mixOption !== undefined) {
          const classicMixMap: Record<string, number> = {
            off: Enums.AudioMixOption.Off,
            on: Enums.AudioMixOption.On,
            afv: Enums.AudioMixOption.AudioFollowVideo
          };
          props.mixOption = classicMixMap[mixOption];
          results.push(`mix = ${mixOption}`);
        }
        if (gain !== undefined) {
          props.gain = gain;
          results.push(`gain = ${gain} dB`);
        }
        if (balance !== undefined) {
          props.balance = Math.round(balance * 50);
          results.push(`balance = ${balance}`);
        }
        if (faderGain !== undefined) {
          results.push(`faderGain ignored (classic mixer — use gain instead)`);
        }

        if (Object.keys(props).length === 0) {
          return { content: [{ type: 'text', text: 'No audio properties specified.' }] };
        }

        await atem.setClassicAudioMixerInputProps(input, props as Record<string, unknown>);
        return { content: [{ type: 'text', text: `Audio input ${input} (${getInputName(input)}) [Classic]: ${results.join(', ')}` }] };
      }

      return { content: [{ type: 'text', text: 'No audio mixer available on this ATEM.' }] };
    }
  );

  // ── Set Audio Master Output ──────────────────────────────────────────────

  server.registerTool(
    'atem_set_audio_master_output',
    {
      title: 'Set Audio Master Output',
      description: `Configure the master audio output level. Works with both Fairlight and classic audio mixers.

Args:
  - gain (number, optional): Master output gain/fader in dB (-100 to +10)
  - followFadeToBlack (boolean, optional): Whether master audio follows Fade to Black`,
      inputSchema: {
        gain: z.number().min(-100).max(10).optional().describe('Master gain/fader in dB'),
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
      const results: string[] = [];

      if (hasFairlight()) {
        const props: Record<string, unknown> = {};
        if (gain !== undefined) {
          props.faderGain = dbToFairlight(gain);
          results.push(`fader = ${gain} dB`);
        }
        if (followFadeToBlack !== undefined) {
          props.followFadeToBlack = followFadeToBlack;
          results.push(`followFTB = ${followFadeToBlack}`);
        }
        if (Object.keys(props).length === 0) {
          return { content: [{ type: 'text', text: 'No properties specified.' }] };
        }
        await atem.setFairlightAudioMixerMasterProps(props);
        return { content: [{ type: 'text', text: `Master audio [Fairlight]: ${results.join(', ')}` }] };
      }

      if (hasClassicAudio()) {
        const props: Record<string, unknown> = {};
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
        return { content: [{ type: 'text', text: `Master audio [Classic]: ${results.join(', ')}` }] };
      }

      return { content: [{ type: 'text', text: 'No audio mixer available on this ATEM.' }] };
    }
  );

  // ── Get Audio State ────────────────────────────────────────────────────

  server.registerTool(
    'atem_get_audio_state',
    {
      title: 'Get Audio Mixer State',
      description: `Get the current audio mixer state. Returns all input levels, mix options, fader positions, and master output. Automatically reads from Fairlight or classic mixer depending on ATEM model.

Returns: JSON with mixer type, master settings, and per-input audio state.`,
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

      // ── Fairlight audio path ──
      if (hasFairlight()) {
        const fl = atem.state!.fairlight!;
        const inputs: Record<string, unknown> = {};

        for (const [id, input] of Object.entries(fl.inputs)) {
          if (!input) continue;
          const inputNum = parseInt(id);
          const inputName = getInputName(inputNum);

          for (const [sourceId, source] of Object.entries(input.sources)) {
            if (!source?.properties) continue;
            const p = source.properties;

            const mixOptionNames: Record<number, string> = {
              [Enums.FairlightAudioMixOption.Off]: 'off',
              [Enums.FairlightAudioMixOption.On]: 'on',
              [Enums.FairlightAudioMixOption.AudioFollowVideo]: 'afv'
            };

            inputs[`Input ${id} (${inputName})`] = {
              sourceId,
              mixOption: mixOptionNames[p.mixOption] ?? `unknown(${p.mixOption})`,
              gain_dB: fairlightToDb(p.gain),
              faderGain_dB: fairlightToDb(p.faderGain),
              balance: p.balance / 5000,
            };
          }
        }

        const master = fl.master?.properties ? {
          faderGain_dB: fairlightToDb(fl.master.properties.faderGain),
          followFadeToBlack: fl.master.properties.followFadeToBlack
        } : null;

        return { content: [{ type: 'text', text: JSON.stringify({ mixer: 'Fairlight', master, inputs }, null, 2) }] };
      }

      // ── Classic audio path ──
      if (hasClassicAudio()) {
        const audioState = atem.state!.audio!;
        const mixOptionNames: Record<number, string> = { 0: 'off', 1: 'on', 2: 'afv' };

        const inputs: Record<string, unknown> = {};
        if (audioState.channels) {
          for (const [id, channel] of Object.entries(audioState.channels)) {
            if (!channel) continue;
            inputs[`Input ${id} (${getInputName(parseInt(id))})`] = {
              mixOption: mixOptionNames[channel.mixOption ?? 0] ?? 'unknown',
              gain_dB: channel.gain ?? 0,
              balance: channel.balance ?? 0
            };
          }
        }

        const master = {
          gain_dB: audioState.master?.gain ?? 0,
          followFadeToBlack: audioState.master?.followFadeToBlack ?? false
        };

        return { content: [{ type: 'text', text: JSON.stringify({ mixer: 'Classic', master, inputs }, null, 2) }] };
      }

      return { content: [{ type: 'text', text: 'No audio mixer available on this ATEM model.' }] };
    }
  );
}
