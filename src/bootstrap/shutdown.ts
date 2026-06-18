/**
 * PRISM Bootstrap — Graceful Shutdown
 *
 * Provides a configurable graceful shutdown handler with timeout.
 * Extracted from `src/index.ts` monolith as part of Phase R (Readiness) audit remediation.
 */

/**
 * Wait for a shutdown signal (SIGINT/SIGTERM) and run the cleanup callback.
 * A hard timeout prevents hanging indefinitely if a store `close()` blocks.
 *
 * @param cleanup - Async cleanup function to run on shutdown signal
 * @param timeoutMs - Max time to wait for cleanup before force-exiting (default 30s)
 */
export function waitForShutdown(cleanup: () => Promise<void>, timeoutMs: number = 30_000): Promise<void> {
    return new Promise((resolve, reject) => {
        let shuttingDown = false;
        let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

        const shutdown = (signal: string): void => {
            if (shuttingDown) return;
            shuttingDown = true;
            console.log(`\n[PRISM] Received ${signal}. Shutting down...`);

            // Hard stop after timeoutMs — prevents hanging on blocked store close()
            shutdownTimer = setTimeout(() => {
                console.error(`[PRISM] Shutdown timed out after ${timeoutMs}ms — forcing exit.`);
                process.exit(1);
            }, timeoutMs);
            shutdownTimer.unref();

            void cleanup()
                .then(() => {
                    if (shutdownTimer) clearTimeout(shutdownTimer);
                    resolve();
                })
                .catch((error) => {
                    if (shutdownTimer) clearTimeout(shutdownTimer);
                    reject(error);
                });
        };

        process.once("SIGINT", () => shutdown("SIGINT"));
        process.once("SIGTERM", () => shutdown("SIGTERM"));
    });
}