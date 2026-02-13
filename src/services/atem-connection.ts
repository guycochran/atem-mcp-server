import { Atem } from 'atem-connection';

let atemInstance: Atem | null = null;
let isConnected = false;
let connectPromise: Promise<string> | null = null;

// ---------------------------------------------------------------------------
// Audio level tracking — maintains a rolling window of recent audio levels
// per input so we can detect which inputs are "active" (someone speaking).
//
// Speech audio is very bursty: a speaker might swing from -10 dB to -80 dB
// between words. To reliably detect who is speaking, we keep a sliding window
// of recent samples and compute a smoothed level (exponential moving average)
// that represents sustained speech energy rather than instantaneous peaks.
// ---------------------------------------------------------------------------

/** How many samples to keep per input for the sliding window */
const SAMPLE_WINDOW_SIZE = 12; // ~6 seconds at ~2 samples/sec from ATEM

/** How long (ms) before level data is considered stale */
const LEVEL_WINDOW_MS = 5000;

/**
 * Minimum smoothed audio level to consider an input "active".
 * The ATEM Fairlight mixer reports levels in hundredths of dB:
 *   -10000 = -100 dB = silence, -2000 = -20 dB = normal speech.
 * Threshold of -5000 (-50 dB) filters out ambient noise.
 */
const SILENCE_THRESHOLD = -5000;

interface InputAudioLevel {
  /** Recent level samples (newest last) for computing average */
  samples: number[];
  /** Smoothed level (exponential moving average of recent samples) */
  smoothedLevel: number;
  /** Most recent instantaneous peak */
  recentPeak: number;
  /** Timestamp of last update */
  lastUpdate: number;
}

/** Map of input index → audio level tracking data */
const audioLevels = new Map<number, InputAudioLevel>();

/** Whether we're currently receiving level data from the ATEM */
let levelTrackingActive = false;

/** EMA smoothing factor — 0.3 gives good responsiveness while smoothing bursts */
const EMA_ALPHA = 0.3;

/**
 * Start listening for audio level events from the ATEM.
 * Must be called after connecting. Safe to call multiple times.
 */
export async function startAudioLevelTracking(): Promise<void> {
  if (levelTrackingActive || !atemInstance || !isConnected) return;

  atemInstance.on('levelChanged', (levelData) => {
    if (levelData.type === 'source') {
      const inputIndex = levelData.index;
      const levels = levelData.levels;
      // Use the maximum of left/right output levels as a proxy for "how loud"
      const peak = Math.max(levels.outputLeftLevel, levels.outputRightLevel);

      const existing = audioLevels.get(inputIndex);
      if (existing) {
        // Add sample to sliding window
        existing.samples.push(peak);
        if (existing.samples.length > SAMPLE_WINDOW_SIZE) {
          existing.samples.shift();
        }
        // Update exponential moving average
        existing.smoothedLevel = EMA_ALPHA * peak + (1 - EMA_ALPHA) * existing.smoothedLevel;
        existing.recentPeak = peak;
        existing.lastUpdate = Date.now();
      } else {
        audioLevels.set(inputIndex, {
          samples: [peak],
          smoothedLevel: peak,
          recentPeak: peak,
          lastUpdate: Date.now(),
        });
      }
    }
  });

  try {
    await atemInstance.startFairlightMixerSendLevels();
    levelTrackingActive = true;
    console.error('[atem-mcp] Audio level tracking started');
  } catch (err) {
    console.error('[atem-mcp] Could not start audio level tracking:', err);
  }
}

/**
 * Get inputs sorted by recent audio activity (loudest first).
 * Uses smoothed (EMA) levels to avoid switching on brief spikes or dips.
 * Filters out stale entries, silent inputs, and inputs not in the candidate list.
 *
 * @param candidateInputs - only consider these input IDs (e.g., guest cameras)
 * @param includeAll - if true, include all candidates even silent ones (for diagnostics)
 * @returns Array of { input, level } sorted by smoothed level descending (loudest first)
 */
export function getActiveInputsByAudioLevel(
  candidateInputs?: number[],
  includeAll = false,
): { input: number; level: number }[] {
  const now = Date.now();
  const results: { input: number; level: number }[] = [];

  for (const [input, data] of audioLevels) {
    // Skip stale entries
    if (now - data.lastUpdate > LEVEL_WINDOW_MS) continue;
    // Skip if not in candidate list
    if (candidateInputs && !candidateInputs.includes(input)) continue;
    // Skip silent inputs (below threshold) unless includeAll is set
    if (!includeAll && data.smoothedLevel <= SILENCE_THRESHOLD) continue;
    results.push({ input, level: data.smoothedLevel });
  }

  // Sort by level descending (loudest first)
  results.sort((a, b) => b.level - a.level);
  return results;
}

/**
 * Check if audio level tracking is active
 */
export function isLevelTrackingActive(): boolean {
  return levelTrackingActive;
}

// ---------------------------------------------------------------------------
// Auto-switch engine — continuously switches to the active speaker
// ---------------------------------------------------------------------------
//
// Zoom-style fast switching with anti-bounce protection:
//
//   1. Fast detection — uses instantaneous peaks to detect a new speaker
//      immediately when they start talking
//   2. Short hold — confirm the new speaker for just ~1s (avoids coughs/noise)
//   3. Cooldown — after switching, brief pause to prevent ping-pong
//   4. Current-speaker stickiness — the current speaker's smoothed (EMA) level
//      is used so brief pauses between words don't cause a switch away
//   5. New speaker uses instantaneous peak — so we detect them starting to
//      talk right away, not after the EMA ramps up
// ---------------------------------------------------------------------------

interface AutoSwitchState {
  /** setInterval handle */
  timer: ReturnType<typeof setInterval>;
  /** Inputs to consider */
  candidates: number[];
  /** Host input (informational — 0 means no host exclusion) */
  hostInput: number;
  /** Current speaker on program (avoid redundant switches) */
  currentSpeaker: number | null;
  /** Minimum ms a new speaker must be dominant before we switch */
  holdMs: number;
  /** How often we check levels (ms) */
  intervalMs: number;
  /** Minimum ms between switches (cooldown) */
  cooldownMs: number;
  /** Mix Effect bus */
  me: number;
  /** Transition type */
  transition: 'cut' | 'auto';
  /** Count of switches performed */
  switchCount: number;
  /** When auto-switch was started */
  startedAt: number;
  /** Timestamp of last switch (for cooldown) */
  lastSwitchAt: number;
  /** Mode: 'program' switches program input, 'ssrc_box' switches a Super Source box source, 'host_ssrc' switches between host full-screen and Super Source with active guest */
  mode: 'program' | 'ssrc_box' | 'host_ssrc';
  /** Which Super Source box to update (0-3) — only used in ssrc_box mode */
  ssrcBox: number;
  /** Super Source ID (default 0) — only used in ssrc_box mode */
  ssrcId: number;
}

let autoSwitch: AutoSwitchState | null = null;

/**
 * Get the instantaneous peak level for an input (not smoothed).
 * Used by auto-switch to detect new speakers immediately.
 */
function getInstantaneousPeak(inputIndex: number): number {
  const data = audioLevels.get(inputIndex);
  if (!data || Date.now() - data.lastUpdate > LEVEL_WINDOW_MS) return -10000;
  return data.recentPeak;
}

/**
 * Get the smoothed (EMA) level for an input.
 * Used by auto-switch to check if the current speaker is still active.
 */
function getSmoothedLevel(inputIndex: number): number {
  const data = audioLevels.get(inputIndex);
  if (!data || Date.now() - data.lastUpdate > LEVEL_WINDOW_MS) return -10000;
  return data.smoothedLevel;
}

/**
 * Start auto-switching to the active speaker.
 * Runs a background loop that checks audio levels and switches program input.
 */
export function startAutoSwitch(options: {
  candidates?: number[];
  hostInput?: number;
  holdMs?: number;
  intervalMs?: number;
  cooldownMs?: number;
  me?: number;
  transition?: 'cut' | 'auto';
  mode?: 'program' | 'ssrc_box' | 'host_ssrc';
  ssrcBox?: number;
  ssrcId?: number;
}): string {
  if (autoSwitch) {
    return 'Auto-switch is already running. Stop it first with atem_auto_switch_off.';
  }

  if (!atemInstance || !isConnected) {
    return 'Not connected to ATEM.';
  }

  if (!levelTrackingActive) {
    return 'Audio level tracking is not active. Cannot auto-switch.';
  }

  const host = options.hostInput ?? 7;
  const mode = options.mode ?? 'program';
  // In host_ssrc mode, we monitor ALL inputs including the host so we can
  // detect when the host is speaking vs a guest.
  const candidates = options.candidates ?? (
    mode === 'host_ssrc'
      ? [1, 2, 3, 4, 5, 6, 7, 8]  // include host in candidates for host_ssrc
      : [1, 2, 3, 4, 5, 6, 7, 8].filter(i => i !== host)
  );
  const holdMs = options.holdMs ?? 1000;
  const intervalMs = options.intervalMs ?? 250;
  const cooldownMs = options.cooldownMs ?? 2000;
  const me = options.me ?? 0;
  const transition = options.transition ?? 'cut';
  const ssrcBox = options.ssrcBox ?? 1;  // default box 2 (0-indexed)
  const ssrcId = options.ssrcId ?? 0;

  // Track which candidate is building up as a potential switch target
  let pendingSpeaker: number | null = null;
  let pendingSince = 0;

  const state: AutoSwitchState = {
    timer: null as unknown as ReturnType<typeof setInterval>,
    candidates,
    hostInput: host,
    currentSpeaker: null,
    holdMs,
    intervalMs,
    cooldownMs,
    me,
    transition,
    switchCount: 0,
    startedAt: Date.now(),
    lastSwitchAt: 0,
    mode,
    ssrcBox,
    ssrcId,
  };

  state.timer = setInterval(() => {
    if (!atemInstance || !isConnected) return;

    const now = Date.now();

    // Cooldown: don't consider switching if we just switched
    if (state.lastSwitchAt > 0 && now - state.lastSwitchAt < cooldownMs) return;

    // Find the loudest candidate by INSTANTANEOUS peak (fast detection)
    let loudestInput: number | null = null;
    let loudestPeak = SILENCE_THRESHOLD;

    for (const c of candidates) {
      const peak = getInstantaneousPeak(c);
      if (peak > loudestPeak) {
        loudestPeak = peak;
        loudestInput = c;
      }
    }

    // Nobody speaking above threshold — do nothing, keep current camera
    if (loudestInput === null) {
      pendingSpeaker = null;
      return;
    }

    // If loudest is already the current speaker — great, reset pending
    if (loudestInput === state.currentSpeaker) {
      pendingSpeaker = null;
      return;
    }

    // Check if current speaker is still actively speaking (using smoothed level).
    // If the current speaker's smoothed level is above threshold and the new
    // speaker's peak isn't meaningfully louder, stay with the current speaker.
    // This prevents switching away during brief pauses between words.
    if (state.currentSpeaker !== null) {
      const currentSmoothed = getSmoothedLevel(state.currentSpeaker);
      if (currentSmoothed > SILENCE_THRESHOLD) {
        // Current speaker still active — new speaker needs to be louder
        // by at least 2 dB (instantaneous peak vs current smoothed)
        if (loudestPeak - currentSmoothed < 200) {
          pendingSpeaker = null;
          return;
        }
      }
    }

    // New dominant speaker detected — start or continue hold timer
    if (loudestInput !== pendingSpeaker) {
      pendingSpeaker = loudestInput;
      pendingSince = now;
      return;
    }

    // Same pending speaker is still dominant — check if hold time elapsed
    if (now - pendingSince >= holdMs) {
      // Switch!
      state.currentSpeaker = loudestInput;
      state.switchCount++;
      state.lastSwitchAt = now;
      pendingSpeaker = null;

      const name = getInputName(loudestInput);

      if (mode === 'host_ssrc') {
        // Host + Super Source hybrid mode:
        //   Host talking → full-screen host on program
        //   Guest talking → update Super Source box + cut to Super Source (6000)
        const isHost = loudestInput === host;
        if (isHost) {
          console.error(`[auto-switch:host_ssrc] HOST full-screen → ${name} (input ${loudestInput}) [switch #${state.switchCount}]`);
          atemInstance.changeProgramInput(loudestInput, me)
            .catch((e) => console.error('[auto-switch:host_ssrc] program error:', e));
        } else {
          console.error(`[auto-switch:host_ssrc] GUEST → Box ${ssrcBox + 1} = ${name} (input ${loudestInput}), program → Super Source [switch #${state.switchCount}]`);
          // Update the Super Source box with the active guest
          atemInstance.setSuperSourceBoxSettings({ source: loudestInput }, ssrcBox, ssrcId)
            .catch((e) => console.error('[auto-switch:host_ssrc] box update error:', e));
          // Cut program to Super Source (6000) so the side-by-side is visible
          atemInstance.changeProgramInput(6000, me)
            .catch((e) => console.error('[auto-switch:host_ssrc] program→ssrc error:', e));
        }
      } else if (mode === 'ssrc_box') {
        // Super Source box mode — update the box source instead of program
        console.error(`[auto-switch:ssrc] Box ${ssrcBox + 1} → ${name} (input ${loudestInput}) [switch #${state.switchCount}]`);
        atemInstance.setSuperSourceBoxSettings({ source: loudestInput }, ssrcBox, ssrcId)
          .catch((e) => console.error('[auto-switch:ssrc] box update error:', e));
      } else {
        // Program mode — switch full-screen camera
        console.error(`[auto-switch] → ${name} (input ${loudestInput}) [switch #${state.switchCount}]`);
        if (transition === 'auto') {
          atemInstance.changePreviewInput(loudestInput, me)
            .then(() => atemInstance!.autoTransition(me))
            .catch((e) => console.error('[auto-switch] transition error:', e));
        } else {
          atemInstance.changeProgramInput(loudestInput, me)
            .catch((e) => console.error('[auto-switch] cut error:', e));
        }
      }
    }
  }, intervalMs);

  autoSwitch = state;

  if (mode === 'host_ssrc') {
    console.error(`[auto-switch:host_ssrc] Started: host=${host}, box=${ssrcBox + 1}, candidates=[${candidates}], hold=${holdMs}ms, cooldown=${cooldownMs}ms, interval=${intervalMs}ms`);
    return `Auto-switch started in Host + Super Source mode! Host (input ${host}) talking → full-screen. Guest talking → Super Source with guest in box ${ssrcBox + 1}. Monitoring inputs [${candidates.join(', ')}]. Hold: ${holdMs / 1000}s, cooldown: ${cooldownMs / 1000}s. Say "auto switch off" to stop.`;
  } else if (mode === 'ssrc_box') {
    console.error(`[auto-switch:ssrc] Started: box=${ssrcBox + 1}, candidates=[${candidates}], hold=${holdMs}ms, cooldown=${cooldownMs}ms, interval=${intervalMs}ms`);
    return `Auto-switch started in Super Source box mode! Box ${ssrcBox + 1} will follow the active speaker. Monitoring inputs [${candidates.join(', ')}]. Hold: ${holdMs / 1000}s, cooldown: ${cooldownMs / 1000}s. Say "auto switch off" to stop.`;
  } else {
    console.error(`[auto-switch] Started: candidates=[${candidates}], hold=${holdMs}ms, cooldown=${cooldownMs}ms, interval=${intervalMs}ms, transition=${transition}`);
    return `Auto-switch started! Monitoring inputs [${candidates.join(', ')}]. Hold: ${holdMs / 1000}s, cooldown: ${cooldownMs / 1000}s. Transition: ${transition}. Say "auto switch off" to stop.`;
  }
}

/**
 * Stop auto-switching.
 */
export function stopAutoSwitch(): string {
  if (!autoSwitch) {
    return 'Auto-switch is not running.';
  }

  clearInterval(autoSwitch.timer);
  const duration = Math.round((Date.now() - autoSwitch.startedAt) / 1000);
  const switches = autoSwitch.switchCount;
  autoSwitch = null;

  console.error(`[auto-switch] Stopped after ${duration}s, ${switches} switches`);
  return `Auto-switch stopped. Ran for ${duration}s with ${switches} switches.`;
}

/**
 * Get current auto-switch status.
 */
export function getAutoSwitchStatus(): {
  running: boolean;
  candidates?: number[];
  hostInput?: number;
  holdMs?: number;
  cooldownMs?: number;
  intervalMs?: number;
  transition?: string;
  currentSpeaker?: number | null;
  switchCount?: number;
  runningForSeconds?: number;
  mode?: string;
  ssrcBox?: number;
} {
  if (!autoSwitch) return { running: false };
  return {
    running: true,
    candidates: autoSwitch.candidates,
    hostInput: autoSwitch.hostInput,
    holdMs: autoSwitch.holdMs,
    cooldownMs: autoSwitch.cooldownMs,
    intervalMs: autoSwitch.intervalMs,
    transition: autoSwitch.transition,
    currentSpeaker: autoSwitch.currentSpeaker,
    switchCount: autoSwitch.switchCount,
    runningForSeconds: Math.round((Date.now() - autoSwitch.startedAt) / 1000),
    mode: autoSwitch.mode,
    ssrcBox: (autoSwitch.mode === 'ssrc_box' || autoSwitch.mode === 'host_ssrc') ? autoSwitch.ssrcBox : undefined,
  };
}

export function getAtem(): Atem {
  if (!atemInstance || !isConnected) {
    throw new Error('Not connected to ATEM. Use atem_connect first.');
  }
  return atemInstance;
}

export function isAtemConnected(): boolean {
  return isConnected;
}

/**
 * Wait for an in-progress auto-connect to complete (if any).
 * Returns immediately if already connected or no connect in progress.
 */
export async function waitForConnection(timeoutMs: number = 15000): Promise<void> {
  if (isConnected) return;
  if (!connectPromise) return;
  try {
    await Promise.race([
      connectPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection wait timed out')), timeoutMs))
    ]);
  } catch {
    // Connection failed or timed out — tools will get "Not connected" error from getAtem()
  }
}

export async function connectAtem(host: string, port?: number): Promise<string> {
  if (atemInstance && isConnected) {
    await atemInstance.disconnect();
  }

  atemInstance = new Atem();

  const p = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      connectPromise = null;
      reject(new Error(`Connection to ATEM at ${host} timed out after 10 seconds`));
    }, 10000);

    atemInstance!.on('connected', () => {
      clearTimeout(timeout);
      isConnected = true;
      connectPromise = null;
      const model = atemInstance!.state?.info?.model ?? 'Unknown';
      // Auto-start audio level tracking for gallery/active-speaker features
      startAudioLevelTracking().catch((e) => console.error('[atem-mcp] Level tracking auto-start failed:', e));
      resolve(`Connected to ATEM (model: ${model}) at ${host}:${port ?? 9910}`);
    });

    atemInstance!.on('error', (err: string) => {
      clearTimeout(timeout);
      isConnected = false;
      connectPromise = null;
      reject(new Error(`ATEM connection error: ${err}`));
    });

    atemInstance!.on('disconnected', () => {
      isConnected = false;
      levelTrackingActive = false;
      audioLevels.clear();
      if (autoSwitch) { clearInterval(autoSwitch.timer); autoSwitch = null; }
    });

    atemInstance!.connect(host, port ?? 9910).catch((err: unknown) => {
      clearTimeout(timeout);
      connectPromise = null;
      reject(new Error(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`));
    });
  });

  connectPromise = p;
  return p;
}

export async function disconnectAtem(): Promise<string> {
  if (atemInstance) {
    await atemInstance.disconnect();
    isConnected = false;
    atemInstance = null;
    return 'Disconnected from ATEM';
  }
  return 'No active ATEM connection';
}

export function getAtemState(): Record<string, unknown> {
  const atem = getAtem();
  return atem.state as unknown as Record<string, unknown>;
}

export function getInputName(inputId: number): string {
  const atem = getAtem();
  const input = atem.state?.inputs?.[inputId];
  return input?.longName ?? input?.shortName ?? `Input ${inputId}`;
}
