import { Atem } from 'atem-connection';

let atemInstance: Atem | null = null;
let isConnected = false;

export function getAtem(): Atem {
  if (!atemInstance || !isConnected) {
    throw new Error('Not connected to ATEM. Use atem_connect first.');
  }
  return atemInstance;
}

export function isAtemConnected(): boolean {
  return isConnected;
}

export async function connectAtem(host: string, port?: number): Promise<string> {
  if (atemInstance && isConnected) {
    await atemInstance.disconnect();
  }

  atemInstance = new Atem();

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Connection to ATEM at ${host} timed out after 10 seconds`));
    }, 10000);

    atemInstance!.on('connected', () => {
      clearTimeout(timeout);
      isConnected = true;
      const model = atemInstance!.state?.info?.model ?? 'Unknown';
      resolve(`Connected to ATEM (model: ${model}) at ${host}:${port ?? 9910}`);
    });

    atemInstance!.on('error', (err: string) => {
      clearTimeout(timeout);
      isConnected = false;
      reject(new Error(`ATEM connection error: ${err}`));
    });

    atemInstance!.on('disconnected', () => {
      isConnected = false;
    });

    atemInstance!.connect(host, port ?? 9910).catch((err: unknown) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`));
    });
  });
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
