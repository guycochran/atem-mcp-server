import { Atem } from 'atem-connection';
export declare function getAtem(): Atem;
export declare function isAtemConnected(): boolean;
export declare function connectAtem(host: string, port?: number): Promise<string>;
export declare function disconnectAtem(): Promise<string>;
export declare function getAtemState(): Record<string, unknown>;
export declare function getInputName(inputId: number): string;
//# sourceMappingURL=atem-connection.d.ts.map