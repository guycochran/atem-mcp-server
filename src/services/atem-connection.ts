import { Atem } from 'atem-connection';

let atemInstance: Atem | null = null;
let isConnected = false;
let connectPromise: Promise<string> | null = null;

// ---------------------------------------------------------------------------
// Audio level tracking — maintains a rolling window of recent audio levels
// per input so we can detect which inputs are "active" (someone speaking).
// ---------------------------------------------------------------------------

interface InputAudioLevel {
  /** Maximum of left/right output levels seen in the recent window (internal units, higher = louder) */
  recentPeak: number;
  /** Timestamp of last update */
  lastUpdate: number;
}

/** Map of input index → recent audio level info */
const audioLevels = new Map<number, InputAudioLevel>();

/** How long (ms) to keep level data before it's considered stale */
const LEVEL_WINDOW_MS = 3000;

/** Whether we're currently receiving level data from the ATEM */
let levelTrackingActive = false;

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
      audioLevels.set(inputIndex, { recentPeak: peak, lastUpdate: Date.now() });
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
 * Filters out stale entries and inputs not in the candidate list.
 * @param candidateInputs - only consider these input IDs (e.g., guest cameras)
 * @returns Array of { input, level } sorted by level descending
 */
export function getActiveInputsByAudioLevel(candidateInputs?: number[]): { input: number; level: number }[] {
  const now = Date.now();
  const results: { input: number; level: number }[] = [];

  for (const [input, data] of audioLevels) {
    // Skip stale entries
    if (now - data.lastUpdate > LEVEL_WINDOW_MS) continue;
    // Skip if not in candidate list
    if (candidateInputs && !candidateInputs.includes(input)) continue;
    results.push({ input, level: data.recentPeak });
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

interface AutoSwitchState {
  /** setInterval handle */
  timer: ReturnType<typeof setInterval>;
  /** Guest inputs to consider */
  candidates: number[];
  /** Host input to exclude */
  hostInput: number;
  /** Current speaker on program (avoid redundant switches) */
  currentSpeaker: number | null;
  /** Timestamp when currentSpeaker became loudest (for hold logic) */
  speakerSince: number;
  /** Minimum ms a new speaker must be loudest before we switch */
  holdMs: number;
  /** How often we check levels (ms) */
  intervalMs: number;
  /** Mix Effect bus */
  me: number;
  /** Transition type */
  transition: 'cut' | 'auto';
  /** Count of switches performed */
  switchCount: number;
  /** When auto-switch was started */
  startedAt: number;
}

let autoSwitch: AutoSwitchState | null = null;

/**
 * Start auto-switching to the active speaker.
 * Runs a background loop that checks audio levels and switches program input.
 */
export function startAutoSwitch(options: {
  candidates?: number[];
  hostInput?: number;
  holdMs?: number;
  intervalMs?: number;
  me?: number;
  transition?: 'cut' | 'auto';
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
  const candidates = options.candidates ?? [1, 2, 3, 4, 5, 6, 7, 8].filter(i => i !== host);
  const holdMs = options.holdMs ?? 1500;
  const intervalMs = options.intervalMs ?? 500;
  const me = options.me ?? 0;
  const transition = options.transition ?? 'cut';

  // Track which candidate is currently loudest and for how long
  let pendingSpeaker: number | null = null;
  let pendingSince = 0;

  const state: AutoSwitchState = {
    timer: null as unknown as ReturnType<typeof setInterval>,
    candidates,
    hostInput: host,
    currentSpeaker: null,
    speakerSince: Date.now(),
    holdMs,
    intervalMs,
    me,
    transition,
    switchCount: 0,
    startedAt: Date.now(),
  };

  state.timer = setInterval(() => {
    if (!atemInstance || !isConnected) return;

    const active = getActiveInputsByAudioLevel(candidates);
    if (active.length === 0) return;

    const loudest = active[0].input;

    // If loudest speaker is the same as current program, nothing to do
    if (loudest === state.currentSpeaker) {
      pendingSpeaker = null;
      return;
    }

    // New speaker detected — start hold timer
    if (loudest !== pendingSpeaker) {
      pendingSpeaker = loudest;
      pendingSince = Date.now();
      return;
    }

    // Same new speaker is still loudest — check if hold time has elapsed
    if (Date.now() - pendingSince >= holdMs) {
      // Switch!
      state.currentSpeaker = loudest;
      state.switchCount++;
      pendingSpeaker = null;

      const name = getInputName(loudest);
      console.error(`[auto-switch] → ${name} (input ${loudest}) [switch #${state.switchCount}]`);

      if (transition === 'auto') {
        atemInstance.changePreviewInput(loudest, me)
          .then(() => atemInstance!.autoTransition(me))
          .catch((e) => console.error('[auto-switch] transition error:', e));
      } else {
        atemInstance.changeProgramInput(loudest, me)
          .catch((e) => console.error('[auto-switch] cut error:', e));
      }
    }
  }, intervalMs);

  autoSwitch = state;
  console.error(`[auto-switch] Started: candidates=[${candidates}], hold=${holdMs}ms, interval=${intervalMs}ms, transition=${transition}`);
  return `Auto-switch started! Monitoring inputs [${candidates.join(', ')}]. Hold: ${holdMs}ms. Transition: ${transition}. Say "auto switch off" to stop.`;
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
  intervalMs?: number;
  transition?: string;
  currentSpeaker?: number | null;
  switchCount?: number;
  runningForSeconds?: number;
} {
  if (!autoSwitch) return { running: false };
  return {
    running: true,
    candidates: autoSwitch.candidates,
    hostInput: autoSwitch.hostInput,
    holdMs: autoSwitch.holdMs,
    intervalMs: autoSwitch.intervalMs,
    transition: autoSwitch.transition,
    currentSpeaker: autoSwitch.currentSpeaker,
    switchCount: autoSwitch.switchCount,
    runningForSeconds: Math.round((Date.now() - autoSwitch.startedAt) / 1000),
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
