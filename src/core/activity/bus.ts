import { createHash, randomUUID } from "node:crypto";
import type { ActivityEvent, ActivitySubscriber } from "./types.js";
import { type ExecutionAuthorityContext } from "../security/execution-authority-context.js";
import {
    type HashChainedEvent,
    CURRENT_AUDIT_HASH_VERSION,
    GENESIS_PREVIOUS_HASH,
    computeChainedEventHash,
} from "./hash-chained-audit.js";

export class ActivityBus {
    private readonly subscribers = new Set<ActivitySubscriber>();
    private readonly events: HashChainedEvent[] = [];
    private lastHash: string = GENESIS_PREVIOUS_HASH;

    subscribe(subscriber: ActivitySubscriber): () => void {
        this.subscribers.add(subscriber);
        return () => this.subscribers.delete(subscriber);
    }

    emit(event: Omit<ActivityEvent, "id" | "timestamp" | "hash">, authorityContext?: ExecutionAuthorityContext): HashChainedEvent {
        const id = randomUUID();
        const timestamp = new Date().toISOString();
        const sequenceNumber = this.events.length + 1;
        const previousHash = this.lastHash;

        const baseEvent: Omit<ActivityEvent, "hash"> = {
            ...event,
            id,
            timestamp,
            operatorEmail: event.operatorEmail || authorityContext?.operatorEmail || undefined,
            assignmentId: event.assignmentId || authorityContext?.assignmentId || undefined,
        };

        // IC-11 Phase 4: Compute blockchain-style chained hash
        const hash = computeChainedEventHash(previousHash, baseEvent, CURRENT_AUDIT_HASH_VERSION);

        const chainedEvent: HashChainedEvent = {
            ...baseEvent,
            hash,
            previousHash,
            sequenceNumber,
            hashVersion: CURRENT_AUDIT_HASH_VERSION,
        };

        this.lastHash = hash;
        this.events.push(chainedEvent);

        for (const subscriber of this.subscribers) {
            subscriber.onEvent(chainedEvent);
        }

        return chainedEvent;
    }

    listEvents(): readonly HashChainedEvent[] {
        return this.events;
    }

    getLastHash(): string {
        return this.lastHash;
    }
}
