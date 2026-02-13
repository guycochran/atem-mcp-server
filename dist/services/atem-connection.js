import { Atem } from 'atem-connection';
let atemInstance = null;
let isConnected = false;
export function getAtem() {
    if (!atemInstance || !isConnected) {
        throw new Error('Not connected to ATEM. Use atem_connect first.');
    }
    return atemInstance;
}
export function isAtemConnected() {
    return isConnected;
}
export async function connectAtem(host, port) {
    if (atemInstance && isConnected) {
        await atemInstance.disconnect();
    }
    atemInstance = new Atem();
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Connection to ATEM at ${host} timed out after 10 seconds`));
        }, 10000);
        atemInstance.on('connected', () => {
            clearTimeout(timeout);
            isConnected = true;
            const model = atemInstance.state?.info?.model ?? 'Unknown';
            resolve(`Connected to ATEM (model: ${model}) at ${host}:${port ?? 9910}`);
        });
        atemInstance.on('error', (err) => {
            clearTimeout(timeout);
            isConnected = false;
            reject(new Error(`ATEM connection error: ${err}`));
        });
        atemInstance.on('disconnected', () => {
            isConnected = false;
        });
        atemInstance.connect(host, port ?? 9910).catch((err) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`));
        });
    });
}
export async function disconnectAtem() {
    if (atemInstance) {
        await atemInstance.disconnect();
        isConnected = false;
        atemInstance = null;
        return 'Disconnected from ATEM';
    }
    return 'No active ATEM connection';
}
export function getAtemState() {
    const atem = getAtem();
    return atem.state;
}
export function getInputName(inputId) {
    const atem = getAtem();
    const input = atem.state?.inputs?.[inputId];
    return input?.longName ?? input?.shortName ?? `Input ${inputId}`;
}
//# sourceMappingURL=atem-connection.js.map