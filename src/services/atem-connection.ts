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
