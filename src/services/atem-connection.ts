import { Atem } from 'atem-connection';

let atemInstance: Atem | null = null;
let isConnected = false;
let connectPromise: Promise<string> | null = null;

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
