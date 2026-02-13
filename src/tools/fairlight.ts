import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAtem, getInputName } from '../services/atem-connection.js';

// ---------------------------------------------------------------------------
// Fairlight audio value encoding (atem-connection internal format)
// ---------------------------------------------------------------------------
// All dB values: hundredths of dB → -500 = -5.00 dB, 300 = +3.00 dB
// EQ frequency: direct Hz (46, 171, 798, 7260, 12900, etc.)
// Q factor: hundredths → 71 = 0.71, 230 = 2.30
// Compressor ratio: hundredths → 200 = 2.00:1, 400 = 4.00:1
// Attack/hold/release: hundredths of ms → 140 = 1.40 ms, 9300 = 93.00 ms
// Expander range: hundredths of dB → 1800 = 18.00 dB
//
// EQ band shapes (bitmask values used by supportedShapes):
//   1  = Low Shelf
//   2  = Low Pass (LP filter)
//   4  = Bell / Parametric (peak/dip)
//   8  = Notch
//   16 = High Pass (HP filter)
//   32 = High Shelf
//
// Default 6-band layout on ATEM Mini Extreme:
//   Band 0: HP Filter (shape 16), 46 Hz — disabled by default
//   Band 1: Low Shelf (shape 1), 49 Hz
//   Band 2: Bell (shape 4), 171 Hz
//   Band 3: Bell (shape 4), 798 Hz
//   Band 4: High Shelf (shape 32), 7260 Hz
//   Band 5: LP Filter (shape 2), 12900 Hz — disabled by default

// Conversion helpers
function dbToInternal(db: number): number { return Math.round(db * 100); }
function internalToDb(val: number): number { return val / 100; }
function qToInternal(q: number): number { return Math.round(q * 100); }
function internalToQ(val: number): number { return val / 100; }
function ratioToInternal(ratio: number): number { return Math.round(ratio * 100); }
function internalToRatio(val: number): number { return val / 100; }
function msToInternal(ms: number): number { return Math.round(ms * 100); }
function internalToMs(val: number): number { return val / 100; }

/** Returns true if this ATEM uses Fairlight audio */
function hasFairlight(): boolean {
  const atem = getAtem();
  return !!atem.state?.fairlight;
}

/** Find the first source ID string for a Fairlight input */
function getFairlightSourceId(inputIndex: number): string | null {
  const atem = getAtem();
  const input = atem.state?.fairlight?.inputs?.[inputIndex];
  if (!input) return null;
  const sourceIds = Object.keys(input.sources);
  return sourceIds.length > 0 ? sourceIds[0] : null;
}

// Shape name ↔ number mappings
const SHAPE_NAMES: Record<number, string> = {
  1: 'low_shelf',
  2: 'low_pass',
  4: 'bell',
  8: 'notch',
  16: 'high_pass',
  32: 'high_shelf'
};
const SHAPE_NUMBERS: Record<string, number> = {
  low_shelf: 1,
  low_pass: 2,
  bell: 4,
  notch: 8,
  high_pass: 16,
  high_shelf: 32
};

// Frequency range name ↔ number mappings
const FREQ_RANGE_NAMES: Record<number, string> = {
  1: 'low',
  2: 'low_mid',
  4: 'mid_high',
  8: 'high'
};
const FREQ_RANGE_NUMBERS: Record<string, number> = {
  low: 1,
  low_mid: 2,
  mid_high: 4,
  high: 8
};

// ---------------------------------------------------------------------------
// EQ Presets — common starting points for natural language requests
// ---------------------------------------------------------------------------
// Each preset configures all 6 bands. Users can say "vocal EQ on mic 1" etc.

interface EQPresetBand {
  bandEnabled: boolean;
  shape: number;
  frequency: number; // Hz
  gain: number; // hundredths dB
  qFactor: number; // hundredths
  frequencyRange: number;
}

interface EQPreset {
  description: string;
  bands: EQPresetBand[];
}

const EQ_PRESETS: Record<string, EQPreset> = {
  vocal: {
    description: 'Vocal clarity: HP at 80Hz, warm shelf at 200Hz, presence boost at 3kHz, air at 12kHz',
    bands: [
      { bandEnabled: true, shape: 16, frequency: 80, gain: 0, qFactor: 71, frequencyRange: 1 },
      { bandEnabled: true, shape: 1, frequency: 200, gain: -200, qFactor: 80, frequencyRange: 1 },
      { bandEnabled: true, shape: 4, frequency: 400, gain: -150, qFactor: 200, frequencyRange: 2 },
      { bandEnabled: true, shape: 4, frequency: 3000, gain: 300, qFactor: 150, frequencyRange: 4 },
      { bandEnabled: true, shape: 32, frequency: 12000, gain: 200, qFactor: 80, frequencyRange: 8 },
      { bandEnabled: false, shape: 2, frequency: 18000, gain: 0, qFactor: 71, frequencyRange: 8 },
    ]
  },
  podcast: {
    description: 'Podcast voice: HP at 100Hz removes rumble, slight warmth cut, clarity boost at 2.5kHz',
    bands: [
      { bandEnabled: true, shape: 16, frequency: 100, gain: 0, qFactor: 71, frequencyRange: 1 },
      { bandEnabled: true, shape: 4, frequency: 250, gain: -200, qFactor: 150, frequencyRange: 1 },
      { bandEnabled: true, shape: 4, frequency: 800, gain: 0, qFactor: 230, frequencyRange: 2 },
      { bandEnabled: true, shape: 4, frequency: 2500, gain: 250, qFactor: 180, frequencyRange: 4 },
      { bandEnabled: true, shape: 32, frequency: 10000, gain: 150, qFactor: 80, frequencyRange: 8 },
      { bandEnabled: false, shape: 2, frequency: 16000, gain: 0, qFactor: 71, frequencyRange: 8 },
    ]
  },
  music: {
    description: 'Music enhancement: gentle low-end warmth, slight mid scoop, high shimmer',
    bands: [
      { bandEnabled: false, shape: 16, frequency: 30, gain: 0, qFactor: 71, frequencyRange: 1 },
      { bandEnabled: true, shape: 1, frequency: 80, gain: 200, qFactor: 80, frequencyRange: 1 },
      { bandEnabled: true, shape: 4, frequency: 500, gain: -100, qFactor: 100, frequencyRange: 2 },
      { bandEnabled: true, shape: 4, frequency: 2000, gain: 0, qFactor: 230, frequencyRange: 4 },
      { bandEnabled: true, shape: 32, frequency: 10000, gain: 250, qFactor: 80, frequencyRange: 8 },
      { bandEnabled: false, shape: 2, frequency: 18000, gain: 0, qFactor: 71, frequencyRange: 8 },
    ]
  },
  de_mud: {
    description: 'De-mud: cuts boxy 200-500Hz frequencies that make voices sound muddy',
    bands: [
      { bandEnabled: true, shape: 16, frequency: 80, gain: 0, qFactor: 71, frequencyRange: 1 },
      { bandEnabled: true, shape: 4, frequency: 250, gain: -300, qFactor: 150, frequencyRange: 1 },
      { bandEnabled: true, shape: 4, frequency: 450, gain: -250, qFactor: 200, frequencyRange: 2 },
      { bandEnabled: true, shape: 4, frequency: 800, gain: 0, qFactor: 230, frequencyRange: 4 },
      { bandEnabled: true, shape: 32, frequency: 8000, gain: 0, qFactor: 80, frequencyRange: 8 },
      { bandEnabled: false, shape: 2, frequency: 16000, gain: 0, qFactor: 71, frequencyRange: 8 },
    ]
  },
  flat: {
    description: 'Flat / reset: all bands at 0 dB gain (default frequencies preserved)',
    bands: [
      { bandEnabled: false, shape: 16, frequency: 46, gain: 0, qFactor: 71, frequencyRange: 1 },
      { bandEnabled: true, shape: 1, frequency: 49, gain: 0, qFactor: 80, frequencyRange: 1 },
      { bandEnabled: true, shape: 4, frequency: 171, gain: 0, qFactor: 230, frequencyRange: 2 },
      { bandEnabled: true, shape: 4, frequency: 798, gain: 0, qFactor: 230, frequencyRange: 4 },
      { bandEnabled: true, shape: 32, frequency: 7260, gain: 0, qFactor: 80, frequencyRange: 8 },
      { bandEnabled: false, shape: 2, frequency: 12900, gain: 0, qFactor: 71, frequencyRange: 8 },
    ]
  }
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerFairlightTools(server: McpServer): void {

  // ── Set Fairlight EQ Band ─────────────────────────────────────────────────

  server.registerTool(
    'atem_set_fairlight_eq',
    {
      title: 'Set Fairlight EQ Band',
      description: `Set an EQ band on a Fairlight audio input. The ATEM Mini Extreme has 6 bands per channel (0-5).

Default band layout:
  Band 0: HP Filter, 46 Hz (disabled)
  Band 1: Low Shelf, 49 Hz
  Band 2: Bell, 171 Hz
  Band 3: Bell, 798 Hz
  Band 4: High Shelf, 7260 Hz
  Band 5: LP Filter, 12900 Hz (disabled)

Args:
  - input (number): Audio input number (1=Camera 1, 2=Camera 2, etc.)
  - band (number): EQ band index (0-5)
  - bandEnabled (boolean, optional): Enable/disable this band
  - shape (string, optional): Band shape — "bell", "low_shelf", "high_shelf", "high_pass", "low_pass", "notch"
  - frequency (number, optional): Center frequency in Hz (20-20000)
  - gain (number, optional): Band gain in dB (-20 to +20)
  - qFactor (number, optional): Q factor / bandwidth (0.3 to 10.3)
  - frequencyRange (string, optional): "low", "low_mid", "mid_high", "high"`,
      inputSchema: {
        input: z.number().int().describe('Audio input number (1=Camera 1)'),
        band: z.number().int().min(0).max(5).describe('EQ band index (0-5)'),
        bandEnabled: z.boolean().optional().describe('Enable/disable this band'),
        shape: z.enum(['bell', 'low_shelf', 'high_shelf', 'high_pass', 'low_pass', 'notch']).optional().describe('Band shape'),
        frequency: z.number().min(20).max(20000).optional().describe('Frequency in Hz'),
        gain: z.number().min(-20).max(20).optional().describe('Gain in dB'),
        qFactor: z.number().min(0.3).max(10.3).optional().describe('Q factor (bandwidth)'),
        frequencyRange: z.enum(['low', 'low_mid', 'mid_high', 'high']).optional().describe('Frequency range')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ input, band, bandEnabled, shape, frequency, gain, qFactor, frequencyRange }) => {
      if (!hasFairlight()) return { content: [{ type: 'text' as const, text: 'Fairlight audio not available on this ATEM.' }] };

      const sourceId = getFairlightSourceId(input);
      if (!sourceId) return { content: [{ type: 'text' as const, text: `Audio input ${input} not found.` }] };

      const atem = getAtem();
      const props: Record<string, unknown> = {};
      const results: string[] = [];

      if (bandEnabled !== undefined) { props.bandEnabled = bandEnabled; results.push(`enabled=${bandEnabled}`); }
      if (shape !== undefined) { props.shape = SHAPE_NUMBERS[shape]; results.push(`shape=${shape}`); }
      if (frequency !== undefined) { props.frequency = frequency; results.push(`freq=${frequency}Hz`); }
      if (gain !== undefined) { props.gain = dbToInternal(gain); results.push(`gain=${gain}dB`); }
      if (qFactor !== undefined) { props.qFactor = qToInternal(qFactor); results.push(`Q=${qFactor}`); }
      if (frequencyRange !== undefined) { props.frequencyRange = FREQ_RANGE_NUMBERS[frequencyRange]; results.push(`range=${frequencyRange}`); }

      if (Object.keys(props).length === 0) return { content: [{ type: 'text' as const, text: 'No EQ properties specified.' }] };

      await atem.setFairlightAudioMixerSourceEqualizerBandProps(input, sourceId, band, props as any);
      return { content: [{ type: 'text' as const, text: `EQ band ${band} on input ${input} (${getInputName(input)}): ${results.join(', ')}` }] };
    }
  );

  // ── Set Fairlight EQ Preset ───────────────────────────────────────────────

  server.registerTool(
    'atem_set_fairlight_eq_preset',
    {
      title: 'Set Fairlight EQ Preset',
      description: `Apply a predefined EQ preset to a Fairlight audio input. Sets all 6 bands at once.

Available presets:
  - "vocal": Clarity for speech — HP at 80Hz, mud cut at 400Hz, presence boost at 3kHz, air at 12kHz
  - "podcast": Podcast voice — HP at 100Hz, warmth cut at 250Hz, clarity at 2.5kHz
  - "music": Music playback — warmth boost at 80Hz, slight mid scoop, high shimmer
  - "de_mud": Cut boxy 200-500Hz frequencies that make audio sound muddy
  - "flat": Reset all bands to 0 dB gain (factory defaults)

Args:
  - input (number): Audio input number (1=Camera 1, 2=Camera 2, etc.)
  - preset (string): Preset name`,
      inputSchema: {
        input: z.number().int().describe('Audio input number'),
        preset: z.enum(['vocal', 'podcast', 'music', 'de_mud', 'flat']).describe('EQ preset name')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ input, preset }) => {
      if (!hasFairlight()) return { content: [{ type: 'text' as const, text: 'Fairlight audio not available on this ATEM.' }] };

      const sourceId = getFairlightSourceId(input);
      if (!sourceId) return { content: [{ type: 'text' as const, text: `Audio input ${input} not found.` }] };

      const atem = getAtem();
      const p = EQ_PRESETS[preset];
      if (!p) return { content: [{ type: 'text' as const, text: `Unknown preset: ${preset}` }] };

      // Apply all 6 bands
      for (let i = 0; i < p.bands.length; i++) {
        const b = p.bands[i];
        await atem.setFairlightAudioMixerSourceEqualizerBandProps(input, sourceId, i, {
          bandEnabled: b.bandEnabled,
          shape: b.shape,
          frequency: b.frequency,
          gain: b.gain,
          qFactor: b.qFactor,
          frequencyRange: b.frequencyRange,
        } as any);
      }

      return { content: [{ type: 'text' as const, text: `EQ preset "${preset}" applied to input ${input} (${getInputName(input)}): ${p.description}` }] };
    }
  );

  // ── Set Fairlight Compressor ──────────────────────────────────────────────

  server.registerTool(
    'atem_set_fairlight_compressor',
    {
      title: 'Set Fairlight Compressor',
      description: `Configure the compressor on a Fairlight audio input.

Args:
  - input (number): Audio input number (1=Camera 1, 2=Camera 2, etc.)
  - enabled (boolean, optional): Enable/disable compressor
  - threshold (number, optional): Threshold in dB (-50 to 0)
  - ratio (number, optional): Compression ratio (1.0 to 20.0, e.g. 4.0 = 4:1)
  - attack (number, optional): Attack time in ms (0.7 to 100)
  - hold (number, optional): Hold time in ms (0 to 4000)
  - release (number, optional): Release time in ms (5 to 4000)`,
      inputSchema: {
        input: z.number().int().describe('Audio input number'),
        enabled: z.boolean().optional().describe('Enable/disable compressor'),
        threshold: z.number().min(-50).max(0).optional().describe('Threshold in dB'),
        ratio: z.number().min(1).max(20).optional().describe('Ratio (e.g. 4.0 = 4:1)'),
        attack: z.number().min(0.7).max(100).optional().describe('Attack in ms'),
        hold: z.number().min(0).max(4000).optional().describe('Hold in ms'),
        release: z.number().min(5).max(4000).optional().describe('Release in ms')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ input, enabled, threshold, ratio, attack, hold, release }) => {
      if (!hasFairlight()) return { content: [{ type: 'text' as const, text: 'Fairlight audio not available on this ATEM.' }] };

      const sourceId = getFairlightSourceId(input);
      if (!sourceId) return { content: [{ type: 'text' as const, text: `Audio input ${input} not found.` }] };

      const atem = getAtem();
      const props: Record<string, unknown> = {};
      const results: string[] = [];

      if (enabled !== undefined) { props.compressorEnabled = enabled; results.push(`enabled=${enabled}`); }
      if (threshold !== undefined) { props.threshold = dbToInternal(threshold); results.push(`threshold=${threshold}dB`); }
      if (ratio !== undefined) { props.ratio = ratioToInternal(ratio); results.push(`ratio=${ratio}:1`); }
      if (attack !== undefined) { props.attack = msToInternal(attack); results.push(`attack=${attack}ms`); }
      if (hold !== undefined) { props.hold = msToInternal(hold); results.push(`hold=${hold}ms`); }
      if (release !== undefined) { props.release = msToInternal(release); results.push(`release=${release}ms`); }

      if (Object.keys(props).length === 0) return { content: [{ type: 'text' as const, text: 'No compressor properties specified.' }] };

      await atem.setFairlightAudioMixerSourceCompressorProps(input, sourceId, props as any);
      return { content: [{ type: 'text' as const, text: `Compressor on input ${input} (${getInputName(input)}): ${results.join(', ')}` }] };
    }
  );

  // ── Set Fairlight Limiter ─────────────────────────────────────────────────

  server.registerTool(
    'atem_set_fairlight_limiter',
    {
      title: 'Set Fairlight Limiter',
      description: `Configure the limiter on a Fairlight audio input. The limiter prevents audio from exceeding the threshold.

Args:
  - input (number): Audio input number (1=Camera 1, 2=Camera 2, etc.)
  - enabled (boolean, optional): Enable/disable limiter
  - threshold (number, optional): Threshold in dB (-50 to 0)
  - attack (number, optional): Attack time in ms (0.7 to 30)
  - hold (number, optional): Hold time in ms (0 to 4000)
  - release (number, optional): Release time in ms (5 to 4000)`,
      inputSchema: {
        input: z.number().int().describe('Audio input number'),
        enabled: z.boolean().optional().describe('Enable/disable limiter'),
        threshold: z.number().min(-50).max(0).optional().describe('Threshold in dB'),
        attack: z.number().min(0.7).max(30).optional().describe('Attack in ms'),
        hold: z.number().min(0).max(4000).optional().describe('Hold in ms'),
        release: z.number().min(5).max(4000).optional().describe('Release in ms')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ input, enabled, threshold, attack, hold, release }) => {
      if (!hasFairlight()) return { content: [{ type: 'text' as const, text: 'Fairlight audio not available on this ATEM.' }] };

      const sourceId = getFairlightSourceId(input);
      if (!sourceId) return { content: [{ type: 'text' as const, text: `Audio input ${input} not found.` }] };

      const atem = getAtem();
      const props: Record<string, unknown> = {};
      const results: string[] = [];

      if (enabled !== undefined) { props.limiterEnabled = enabled; results.push(`enabled=${enabled}`); }
      if (threshold !== undefined) { props.threshold = dbToInternal(threshold); results.push(`threshold=${threshold}dB`); }
      if (attack !== undefined) { props.attack = msToInternal(attack); results.push(`attack=${attack}ms`); }
      if (hold !== undefined) { props.hold = msToInternal(hold); results.push(`hold=${hold}ms`); }
      if (release !== undefined) { props.release = msToInternal(release); results.push(`release=${release}ms`); }

      if (Object.keys(props).length === 0) return { content: [{ type: 'text' as const, text: 'No limiter properties specified.' }] };

      await atem.setFairlightAudioMixerSourceLimiterProps(input, sourceId, props as any);
      return { content: [{ type: 'text' as const, text: `Limiter on input ${input} (${getInputName(input)}): ${results.join(', ')}` }] };
    }
  );

  // ── Set Fairlight Gate/Expander ───────────────────────────────────────────

  server.registerTool(
    'atem_set_fairlight_gate',
    {
      title: 'Set Fairlight Gate / Expander',
      description: `Configure the noise gate or expander on a Fairlight audio input. Gates cut audio below the threshold; expanders reduce it by a ratio.

Args:
  - input (number): Audio input number (1=Camera 1, 2=Camera 2, etc.)
  - enabled (boolean, optional): Enable/disable expander
  - gateEnabled (boolean, optional): true = hard gate mode, false = expander mode
  - threshold (number, optional): Threshold in dB (-50 to 0). Audio below this is reduced.
  - range (number, optional): Range in dB (0 to 60). How much to reduce audio below threshold.
  - ratio (number, optional): Expansion ratio (1.0 to 4.0)
  - attack (number, optional): Attack time in ms (0.7 to 100)
  - hold (number, optional): Hold time in ms (0 to 4000)
  - release (number, optional): Release time in ms (5 to 4000)`,
      inputSchema: {
        input: z.number().int().describe('Audio input number'),
        enabled: z.boolean().optional().describe('Enable/disable gate/expander'),
        gateEnabled: z.boolean().optional().describe('true = gate mode, false = expander mode'),
        threshold: z.number().min(-50).max(0).optional().describe('Threshold in dB'),
        range: z.number().min(0).max(60).optional().describe('Range in dB'),
        ratio: z.number().min(1).max(4).optional().describe('Expansion ratio'),
        attack: z.number().min(0.7).max(100).optional().describe('Attack in ms'),
        hold: z.number().min(0).max(4000).optional().describe('Hold in ms'),
        release: z.number().min(5).max(4000).optional().describe('Release in ms')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ input, enabled, gateEnabled, threshold, range, ratio, attack, hold, release }) => {
      if (!hasFairlight()) return { content: [{ type: 'text' as const, text: 'Fairlight audio not available on this ATEM.' }] };

      const sourceId = getFairlightSourceId(input);
      if (!sourceId) return { content: [{ type: 'text' as const, text: `Audio input ${input} not found.` }] };

      const atem = getAtem();
      const props: Record<string, unknown> = {};
      const results: string[] = [];

      if (enabled !== undefined) { props.expanderEnabled = enabled; results.push(`enabled=${enabled}`); }
      if (gateEnabled !== undefined) { props.gateEnabled = gateEnabled; results.push(`gate=${gateEnabled}`); }
      if (threshold !== undefined) { props.threshold = dbToInternal(threshold); results.push(`threshold=${threshold}dB`); }
      if (range !== undefined) { props.range = dbToInternal(range); results.push(`range=${range}dB`); }
      if (ratio !== undefined) { props.ratio = ratioToInternal(ratio); results.push(`ratio=${ratio}:1`); }
      if (attack !== undefined) { props.attack = msToInternal(attack); results.push(`attack=${attack}ms`); }
      if (hold !== undefined) { props.hold = msToInternal(hold); results.push(`hold=${hold}ms`); }
      if (release !== undefined) { props.release = msToInternal(release); results.push(`release=${release}ms`); }

      if (Object.keys(props).length === 0) return { content: [{ type: 'text' as const, text: 'No gate/expander properties specified.' }] };

      await atem.setFairlightAudioMixerSourceExpanderProps(input, sourceId, props as any);
      return { content: [{ type: 'text' as const, text: `Gate/expander on input ${input} (${getInputName(input)}): ${results.join(', ')}` }] };
    }
  );

  // ── Get Fairlight EQ & Dynamics State ─────────────────────────────────────

  server.registerTool(
    'atem_get_fairlight_eq_state',
    {
      title: 'Get Fairlight EQ & Dynamics State',
      description: `Get the current EQ bands, compressor, limiter, and gate/expander settings for a Fairlight audio input. Returns human-readable values (dB, Hz, ms).

Args:
  - input (number): Audio input number (1=Camera 1, 2=Camera 2, etc.)`,
      inputSchema: {
        input: z.number().int().describe('Audio input number')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ input }) => {
      if (!hasFairlight()) return { content: [{ type: 'text' as const, text: 'Fairlight audio not available on this ATEM.' }] };

      const atem = getAtem();
      const fl = atem.state?.fairlight;
      if (!fl) return { content: [{ type: 'text' as const, text: 'Fairlight state not available.' }] };

      const flInput = fl.inputs?.[input];
      if (!flInput) return { content: [{ type: 'text' as const, text: `Input ${input} not found in Fairlight.` }] };

      const sourceId = Object.keys(flInput.sources)[0];
      if (!sourceId) return { content: [{ type: 'text' as const, text: `No audio source found for input ${input}.` }] };

      const source = flInput.sources[sourceId];
      if (!source) return { content: [{ type: 'text' as const, text: `Source ${sourceId} not found.` }] };

      // Format EQ bands
      const eqBands = source.equalizer?.bands?.map((b, i) => {
        if (!b) return { band: i, enabled: false };
        return {
          band: i,
          enabled: b.bandEnabled,
          shape: SHAPE_NAMES[b.shape] ?? `unknown(${b.shape})`,
          frequency_Hz: b.frequency,
          gain_dB: internalToDb(b.gain),
          qFactor: internalToQ(b.qFactor),
          frequencyRange: FREQ_RANGE_NAMES[b.frequencyRange] ?? `unknown(${b.frequencyRange})`
        };
      }) ?? [];

      // Format dynamics
      const comp = source.dynamics?.compressor;
      const compressor = comp ? {
        enabled: comp.compressorEnabled,
        threshold_dB: internalToDb(comp.threshold),
        ratio: internalToRatio(comp.ratio),
        attack_ms: internalToMs(comp.attack),
        hold_ms: internalToMs(comp.hold),
        release_ms: internalToMs(comp.release)
      } : null;

      const lim = source.dynamics?.limiter;
      const limiter = lim ? {
        enabled: lim.limiterEnabled,
        threshold_dB: internalToDb(lim.threshold),
        attack_ms: internalToMs(lim.attack),
        hold_ms: internalToMs(lim.hold),
        release_ms: internalToMs(lim.release)
      } : null;

      const exp = source.dynamics?.expander;
      const gate = exp ? {
        enabled: exp.expanderEnabled,
        gateMode: exp.gateEnabled,
        threshold_dB: internalToDb(exp.threshold),
        range_dB: internalToDb(exp.range),
        ratio: internalToRatio(exp.ratio),
        attack_ms: internalToMs(exp.attack),
        hold_ms: internalToMs(exp.hold),
        release_ms: internalToMs(exp.release)
      } : null;

      const result = {
        input,
        name: getInputName(input),
        eq: {
          enabled: source.equalizer?.enabled ?? false,
          gain_dB: internalToDb(source.equalizer?.gain ?? 0),
          bands: eqBands
        },
        makeUpGain_dB: internalToDb(source.dynamics?.makeUpGain ?? 0),
        compressor,
        limiter,
        gate
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── Set Master EQ Band ────────────────────────────────────────────────────

  server.registerTool(
    'atem_set_fairlight_master_eq',
    {
      title: 'Set Fairlight Master EQ Band',
      description: `Set an EQ band on the Fairlight master output. Same 6-band layout as input EQ.

Args:
  - band (number): EQ band index (0-5)
  - bandEnabled (boolean, optional): Enable/disable this band
  - shape (string, optional): Band shape — "bell", "low_shelf", "high_shelf", "high_pass", "low_pass", "notch"
  - frequency (number, optional): Center frequency in Hz (20-20000)
  - gain (number, optional): Band gain in dB (-20 to +20)
  - qFactor (number, optional): Q factor (0.3 to 10.3)
  - frequencyRange (string, optional): "low", "low_mid", "mid_high", "high"`,
      inputSchema: {
        band: z.number().int().min(0).max(5).describe('EQ band index (0-5)'),
        bandEnabled: z.boolean().optional().describe('Enable/disable this band'),
        shape: z.enum(['bell', 'low_shelf', 'high_shelf', 'high_pass', 'low_pass', 'notch']).optional().describe('Band shape'),
        frequency: z.number().min(20).max(20000).optional().describe('Frequency in Hz'),
        gain: z.number().min(-20).max(20).optional().describe('Gain in dB'),
        qFactor: z.number().min(0.3).max(10.3).optional().describe('Q factor'),
        frequencyRange: z.enum(['low', 'low_mid', 'mid_high', 'high']).optional().describe('Frequency range')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ band, bandEnabled, shape, frequency, gain, qFactor, frequencyRange }) => {
      if (!hasFairlight()) return { content: [{ type: 'text' as const, text: 'Fairlight audio not available on this ATEM.' }] };

      const atem = getAtem();
      const props: Record<string, unknown> = {};
      const results: string[] = [];

      if (bandEnabled !== undefined) { props.bandEnabled = bandEnabled; results.push(`enabled=${bandEnabled}`); }
      if (shape !== undefined) { props.shape = SHAPE_NUMBERS[shape]; results.push(`shape=${shape}`); }
      if (frequency !== undefined) { props.frequency = frequency; results.push(`freq=${frequency}Hz`); }
      if (gain !== undefined) { props.gain = dbToInternal(gain); results.push(`gain=${gain}dB`); }
      if (qFactor !== undefined) { props.qFactor = qToInternal(qFactor); results.push(`Q=${qFactor}`); }
      if (frequencyRange !== undefined) { props.frequencyRange = FREQ_RANGE_NUMBERS[frequencyRange]; results.push(`range=${frequencyRange}`); }

      if (Object.keys(props).length === 0) return { content: [{ type: 'text' as const, text: 'No EQ properties specified.' }] };

      await atem.setFairlightAudioMixerMasterEqualizerBandProps(band, props as any);
      return { content: [{ type: 'text' as const, text: `Master EQ band ${band}: ${results.join(', ')}` }] };
    }
  );

  // ── Set Master Compressor ─────────────────────────────────────────────────

  server.registerTool(
    'atem_set_fairlight_master_compressor',
    {
      title: 'Set Fairlight Master Compressor',
      description: `Configure the compressor on the Fairlight master output.

Args:
  - enabled (boolean, optional): Enable/disable compressor
  - threshold (number, optional): Threshold in dB (-50 to 0)
  - ratio (number, optional): Compression ratio (1.0 to 20.0)
  - attack (number, optional): Attack in ms (0.7 to 100)
  - hold (number, optional): Hold in ms (0 to 4000)
  - release (number, optional): Release in ms (5 to 4000)`,
      inputSchema: {
        enabled: z.boolean().optional().describe('Enable/disable compressor'),
        threshold: z.number().min(-50).max(0).optional().describe('Threshold in dB'),
        ratio: z.number().min(1).max(20).optional().describe('Ratio (e.g. 4.0 = 4:1)'),
        attack: z.number().min(0.7).max(100).optional().describe('Attack in ms'),
        hold: z.number().min(0).max(4000).optional().describe('Hold in ms'),
        release: z.number().min(5).max(4000).optional().describe('Release in ms')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ enabled, threshold, ratio, attack, hold, release }) => {
      if (!hasFairlight()) return { content: [{ type: 'text' as const, text: 'Fairlight audio not available on this ATEM.' }] };

      const atem = getAtem();
      const props: Record<string, unknown> = {};
      const results: string[] = [];

      if (enabled !== undefined) { props.compressorEnabled = enabled; results.push(`enabled=${enabled}`); }
      if (threshold !== undefined) { props.threshold = dbToInternal(threshold); results.push(`threshold=${threshold}dB`); }
      if (ratio !== undefined) { props.ratio = ratioToInternal(ratio); results.push(`ratio=${ratio}:1`); }
      if (attack !== undefined) { props.attack = msToInternal(attack); results.push(`attack=${attack}ms`); }
      if (hold !== undefined) { props.hold = msToInternal(hold); results.push(`hold=${hold}ms`); }
      if (release !== undefined) { props.release = msToInternal(release); results.push(`release=${release}ms`); }

      if (Object.keys(props).length === 0) return { content: [{ type: 'text' as const, text: 'No compressor properties specified.' }] };

      await atem.setFairlightAudioMixerMasterCompressorProps(props as any);
      return { content: [{ type: 'text' as const, text: `Master compressor: ${results.join(', ')}` }] };
    }
  );

  // ── Set Master Limiter ────────────────────────────────────────────────────

  server.registerTool(
    'atem_set_fairlight_master_limiter',
    {
      title: 'Set Fairlight Master Limiter',
      description: `Configure the limiter on the Fairlight master output.

Args:
  - enabled (boolean, optional): Enable/disable limiter
  - threshold (number, optional): Threshold in dB (-50 to 0)
  - attack (number, optional): Attack in ms (0.7 to 30)
  - hold (number, optional): Hold in ms (0 to 4000)
  - release (number, optional): Release in ms (5 to 4000)`,
      inputSchema: {
        enabled: z.boolean().optional().describe('Enable/disable limiter'),
        threshold: z.number().min(-50).max(0).optional().describe('Threshold in dB'),
        attack: z.number().min(0.7).max(30).optional().describe('Attack in ms'),
        hold: z.number().min(0).max(4000).optional().describe('Hold in ms'),
        release: z.number().min(5).max(4000).optional().describe('Release in ms')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ enabled, threshold, attack, hold, release }) => {
      if (!hasFairlight()) return { content: [{ type: 'text' as const, text: 'Fairlight audio not available on this ATEM.' }] };

      const atem = getAtem();
      const props: Record<string, unknown> = {};
      const results: string[] = [];

      if (enabled !== undefined) { props.limiterEnabled = enabled; results.push(`enabled=${enabled}`); }
      if (threshold !== undefined) { props.threshold = dbToInternal(threshold); results.push(`threshold=${threshold}dB`); }
      if (attack !== undefined) { props.attack = msToInternal(attack); results.push(`attack=${attack}ms`); }
      if (hold !== undefined) { props.hold = msToInternal(hold); results.push(`hold=${hold}ms`); }
      if (release !== undefined) { props.release = msToInternal(release); results.push(`release=${release}ms`); }

      if (Object.keys(props).length === 0) return { content: [{ type: 'text' as const, text: 'No limiter properties specified.' }] };

      await atem.setFairlightAudioMixerMasterLimiterProps(props as any);
      return { content: [{ type: 'text' as const, text: `Master limiter: ${results.join(', ')}` }] };
    }
  );

  // ── Set Makeup Gain ───────────────────────────────────────────────────────

  server.registerTool(
    'atem_set_fairlight_makeup_gain',
    {
      title: 'Set Fairlight Makeup Gain',
      description: `Set the makeup gain on a Fairlight audio input. Makeup gain compensates for volume lost during compression.

Args:
  - input (number): Audio input number (1=Camera 1, 2=Camera 2, etc.)
  - gain (number): Makeup gain in dB (0 to 20)`,
      inputSchema: {
        input: z.number().int().describe('Audio input number'),
        gain: z.number().min(0).max(20).describe('Makeup gain in dB')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ input, gain }) => {
      if (!hasFairlight()) return { content: [{ type: 'text' as const, text: 'Fairlight audio not available on this ATEM.' }] };

      const sourceId = getFairlightSourceId(input);
      if (!sourceId) return { content: [{ type: 'text' as const, text: `Audio input ${input} not found.` }] };

      const atem = getAtem();
      await atem.setFairlightAudioMixerSourceProps(input, sourceId, { makeUpGain: dbToInternal(gain) } as any);
      return { content: [{ type: 'text' as const, text: `Makeup gain on input ${input} (${getInputName(input)}): ${gain} dB` }] };
    }
  );

  // ── Reset Fairlight Dynamics ──────────────────────────────────────────────

  server.registerTool(
    'atem_reset_fairlight_dynamics',
    {
      title: 'Reset Fairlight Dynamics',
      description: `Reset dynamics processors to factory defaults on a Fairlight audio input.

Args:
  - input (number): Audio input number (1=Camera 1, 2=Camera 2, etc.)
  - compressor (boolean, optional): Reset compressor to defaults
  - limiter (boolean, optional): Reset limiter to defaults
  - expander (boolean, optional): Reset gate/expander to defaults
  - dynamics (boolean, optional): Reset all dynamics to defaults`,
      inputSchema: {
        input: z.number().int().describe('Audio input number'),
        compressor: z.boolean().optional().describe('Reset compressor'),
        limiter: z.boolean().optional().describe('Reset limiter'),
        expander: z.boolean().optional().describe('Reset gate/expander'),
        dynamics: z.boolean().optional().describe('Reset all dynamics')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ input, compressor, limiter, expander, dynamics }) => {
      if (!hasFairlight()) return { content: [{ type: 'text' as const, text: 'Fairlight audio not available on this ATEM.' }] };

      const sourceId = getFairlightSourceId(input);
      if (!sourceId) return { content: [{ type: 'text' as const, text: `Audio input ${input} not found.` }] };

      const atem = getAtem();
      const props: Record<string, boolean> = {};
      const results: string[] = [];

      if (dynamics) { props.dynamics = true; results.push('all dynamics'); }
      if (compressor) { props.compressor = true; results.push('compressor'); }
      if (limiter) { props.limiter = true; results.push('limiter'); }
      if (expander) { props.expander = true; results.push('gate/expander'); }

      if (Object.keys(props).length === 0) {
        props.dynamics = true;
        results.push('all dynamics');
      }

      await atem.setFairlightAudioMixerSourceDynamicsReset(input, sourceId, props);
      return { content: [{ type: 'text' as const, text: `Reset ${results.join(', ')} on input ${input} (${getInputName(input)})` }] };
    }
  );

  // ── Reset Fairlight EQ ────────────────────────────────────────────────────

  server.registerTool(
    'atem_reset_fairlight_eq',
    {
      title: 'Reset Fairlight EQ',
      description: `Reset EQ to factory defaults on a Fairlight audio input.

Args:
  - input (number): Audio input number (1=Camera 1, 2=Camera 2, etc.)
  - band (number, optional): Reset a specific band (0-5). If omitted, resets all bands.`,
      inputSchema: {
        input: z.number().int().describe('Audio input number'),
        band: z.number().int().min(0).max(5).optional().describe('Specific band to reset (0-5), or omit for all')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ input, band }) => {
      if (!hasFairlight()) return { content: [{ type: 'text' as const, text: 'Fairlight audio not available on this ATEM.' }] };

      const sourceId = getFairlightSourceId(input);
      if (!sourceId) return { content: [{ type: 'text' as const, text: `Audio input ${input} not found.` }] };

      const atem = getAtem();
      const props: Record<string, unknown> = {};

      if (band !== undefined) {
        props.band = band;
        await atem.setFairlightAudioMixerSourceEqualizerReset(input, sourceId, props);
        return { content: [{ type: 'text' as const, text: `Reset EQ band ${band} on input ${input} (${getInputName(input)})` }] };
      } else {
        props.equalizer = true;
        await atem.setFairlightAudioMixerSourceEqualizerReset(input, sourceId, props);
        return { content: [{ type: 'text' as const, text: `Reset all EQ on input ${input} (${getInputName(input)})` }] };
      }
    }
  );
}
