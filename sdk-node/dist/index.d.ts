import { IncomingMessage, ServerResponse } from 'http';
interface PantauConfig {
    apiKey: string;
    baseUrl?: string;
    serviceName: string;
}
/**
 * Initialize Pantau SDK. Call this once at app startup.
 */
export declare function init(cfg: PantauConfig): void;
/**
 * Express middleware — auto-detect routes & track performance.
 * Usage: app.use(pantau.middleware())
 */
export declare function middleware(): (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => void;
/**
 * Start periodic heartbeat. Default every 30 seconds.
 */
export declare function startHeartbeat(intervalMs?: number): void;
/**
 * Stop heartbeat interval.
 */
export declare function stopHeartbeat(): void;
/**
 * Shutdown — send final heartbeat and clean up.
 */
export declare function shutdown(): Promise<void>;
export {};
//# sourceMappingURL=index.d.ts.map