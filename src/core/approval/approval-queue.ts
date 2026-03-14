import { randomUUID } from "node:crypto";

interface PendingApproval {
    readonly id: string;
    readonly sessionId: string;
    readonly operation: string;
    readonly context: Record<string, unknown>;
    readonly createdAt: Date;
    readonly resolve: (approved: boolean) => void;
    readonly timeoutHandle: NodeJS.Timeout;
}

export class ApprovalQueue {
    private readonly pending = new Map<string, PendingApproval>();

    /**
     * Enqueues an operation needing approval and returns a promise that
     * resolves true (approved) or false (denied / timed-out).
     */
    request(
        sessionId: string,
        operation: string,
        context: Record<string, unknown>,
        timeoutMs = 120_000,
    ): Promise<boolean> {
        return new Promise((resolve) => {
            const id = randomUUID();

            const timeoutHandle = setTimeout(() => {
                this.pending.delete(id);
                console.warn(`[APPROVAL] Timed out id=${id} operation=${operation}`);
                resolve(false);
            }, timeoutMs);

            this.pending.set(id, {
                id,
                sessionId,
                operation,
                context,
                createdAt: new Date(),
                resolve,
                timeoutHandle,
            });

            console.log(`\n[APPROVAL REQUIRED]`);
            console.log(`  id        : ${id}`);
            console.log(`  operation : ${operation}`);
            console.log(`  approve   : POST http://localhost:7070/approve/${id}`);
            console.log(`  deny      : POST http://localhost:7070/deny/${id}`);
            console.log(`  expires   : ${timeoutMs / 1000}s\n`);
        });
    }

    approve(id: string): boolean {
        return this.settle(id, true);
    }

    deny(id: string): boolean {
        return this.settle(id, false);
    }

    list(): ReadonlyArray<Omit<PendingApproval, "resolve" | "timeoutHandle">> {
        return [...this.pending.values()].map(({ id, sessionId, operation, context, createdAt }) => ({
            id,
            sessionId,
            operation,
            context,
            createdAt,
        }));
    }

    private settle(id: string, approved: boolean): boolean {
        const item = this.pending.get(id);
        if (!item) return false;
        clearTimeout(item.timeoutHandle);
        this.pending.delete(id);
        item.resolve(approved);
        return true;
    }
}
