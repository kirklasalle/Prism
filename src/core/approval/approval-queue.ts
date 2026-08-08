import { createHash, generateKeyPairSync, sign, verify, randomUUID, type KeyObject } from "node:crypto";

export interface SignedApprovalDecision {
    readonly requestId: string;
    readonly actionDigest: string;
    readonly approved: boolean;
    readonly decidedAt: string;
    readonly expiresAt: string;
    readonly nonce: string;
    readonly signature: string;
}

interface PendingApproval {
    readonly id: string;
    readonly sessionId: string;
    readonly operation: string;
    readonly context: Record<string, unknown>;
    readonly actionDigest: string;
    readonly createdAt: Date;
    readonly expiresAt: Date;
    readonly resolve: (approved: boolean) => void;
    readonly timeoutHandle: NodeJS.Timeout;
}

export class ApprovalQueue {
    private readonly pending = new Map<string, PendingApproval>();
    private readonly decisions = new Map<string, SignedApprovalDecision>();
    private readonly privateKey: KeyObject;
    private readonly publicKey: KeyObject;

    constructor(keys?: { privateKey: KeyObject; publicKey: KeyObject }) {
        const generated = keys ?? generateKeyPairSync("ed25519");
        this.privateKey = generated.privateKey;
        this.publicKey = generated.publicKey;
    }

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
            const createdAt = new Date();
            const expiresAt = new Date(createdAt.getTime() + timeoutMs);
            const contextSnapshot = structuredClone(context);
            const actionDigest = approvalActionDigest(sessionId, operation, contextSnapshot);

            const timeoutHandle = setTimeout(() => {
                this.pending.delete(id);
                console.warn(`[APPROVAL] Timed out id=${id} operation=${operation}`);
                resolve(false);
            }, timeoutMs);

            this.pending.set(id, {
                id,
                sessionId,
                operation,
                context: contextSnapshot,
                actionDigest,
                createdAt,
                expiresAt,
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
        return [...this.pending.values()].map(({ id, sessionId, operation, context, actionDigest, createdAt, expiresAt }) => ({
            id,
            sessionId,
            operation,
            context,
            actionDigest,
            createdAt,
            expiresAt,
        }));
    }

    getDecision(id: string): SignedApprovalDecision | null {
        return this.decisions.get(id) ?? null;
    }

    private settle(id: string, approved: boolean): boolean {
        const item = this.pending.get(id);
        if (!item) return false;
        clearTimeout(item.timeoutHandle);
        this.pending.delete(id);
        const payload = {
            requestId: item.id,
            actionDigest: item.actionDigest,
            approved,
            decidedAt: new Date().toISOString(),
            expiresAt: item.expiresAt.toISOString(),
            nonce: randomUUID(),
        };
        const signature = sign(null, Buffer.from(canonicalJson(payload)), this.privateKey).toString("base64");
        const decision = { ...payload, signature };
        const valid = this.verifyDecision(decision, item);
        this.decisions.set(id, decision);
        if (this.decisions.size > 1000) this.decisions.delete(this.decisions.keys().next().value!);
        item.resolve(approved && valid);
        return true;
    }

    private verifyDecision(decision: SignedApprovalDecision, pending: PendingApproval): boolean {
        if (
            decision.requestId !== pending.id ||
            decision.actionDigest !== pending.actionDigest ||
            Date.parse(decision.expiresAt) !== pending.expiresAt.getTime() ||
            Date.now() > pending.expiresAt.getTime()
        ) {
            return false;
        }
        const { signature, ...payload } = decision;
        return verify(null, Buffer.from(canonicalJson(payload)), this.publicKey, Buffer.from(signature, "base64"));
    }
}

export function approvalActionDigest(
    sessionId: string,
    operation: string,
    context: Record<string, unknown>,
): string {
    return createHash("sha256").update(canonicalJson({ sessionId, operation, context })).digest("hex");
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(",")}}`;
}
