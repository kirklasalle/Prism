/**
 * PRISM CLI API Client — Lightweight HTTP client for /api/setup/* endpoints.
 * Uses Node 22+ built-in fetch(). Zero external dependencies.
 */

export interface SetupStatus {
    setupComplete: boolean;
    executionProfileSegment: string;
    workspaceRoot: string;
}

export interface PrerequisiteCheck {
    id: string;
    label: string;
    passed: boolean;
    detail: string;
}

export interface SetupPrerequisites {
    checks: PrerequisiteCheck[];
}

export interface ReadinessSnapshot {
    checkedAt: string;
    ready: boolean;
    activeSessionId: string | null;
    selectedProviderId: string | null;
    selectedModel: string | null;
    requirements: Array<{ id: string; label: string; passed: boolean; detail: string }>;
    recommendations: string[];
}

export interface ProviderTestResult {
    ok: boolean;
    message: string;
    models: string[];
    latencyMs?: number;
}

export class SetupApiClient {
    private readonly baseUrl: string;

    constructor(port = 7070, host = "localhost") {
        this.baseUrl = `http://${host}:${port}`;
    }

    /**
     * Check if the PRISM server is reachable.
     */
    async isServerRunning(): Promise<boolean> {
        try {
            const res = await fetch(`${this.baseUrl}/api/health`, {
                signal: AbortSignal.timeout(3000),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    /**
     * Get current setup status (profile, workspace, completion).
     */
    async getSetupStatus(): Promise<SetupStatus> {
        return this.get<SetupStatus>("/api/setup/status");
    }

    /**
     * Get prerequisite checks (Node.js version, workspace exists).
     */
    async getSetupPrerequisites(): Promise<SetupPrerequisites> {
        return this.get<SetupPrerequisites>("/api/setup/prerequisites");
    }

    /**
     * Save execution profile.
     */
    async postSetupProfile(segment: string): Promise<{ executionProfileSegment: string }> {
        return this.post("/api/setup/profile", { executionProfileSegment: segment });
    }

    /**
     * Save workspace root and create directory structure.
     */
    async postSetupWorkspace(root: string): Promise<{ workspaceRoot: string }> {
        return this.post("/api/setup/workspace", { workspaceRoot: root });
    }

    /**
     * Set default character in setup.
     */
    async postSetupCharacter(characterId: string): Promise<{ ok: boolean; defaultCharacterId: string }> {
        return this.post("/api/setup/character", { characterId });
    }

    /**
     * Create CAC and first chat session.
     */
    async postSetupCac(payload: {
        characterId?: string;
        operatorEmail: string;
        assistantEmail?: string;
        title?: string;
        operatorPassword?: string;
    }): Promise<{ ok: boolean; cacAssignmentId: string; session: Record<string, unknown> }> {
        return this.post("/api/setup/cac", payload);
    }

    /**
     * Mark setup as complete, trigger readiness check and audit events.
     */
    async postSetupComplete(): Promise<{ setupComplete: boolean; readiness: ReadinessSnapshot }> {
        return this.post("/api/setup/complete");
    }

    /**
     * Test a provider's connectivity.
     */
    async postProviderTest(providerId: string): Promise<ProviderTestResult> {
        return this.post("/api/llm/provider-test", { providerId });
    }

    /**
     * Save an API key for a provider.
     */
    async postProviderKey(providerId: string, apiKey: string): Promise<Record<string, unknown>> {
        return this.post(`/api/provider/${encodeURIComponent(providerId)}/key`, { apiKey });
    }

    /**
     * Re-run readiness checks.
     */
    async postReadinessRecheck(source: string): Promise<ReadinessSnapshot> {
        return this.post("/api/readiness/recheck", { source });
    }

    // ── Advanced Wizard Endpoints ────────────────────────────────────────────

    /**
     * Get advanced setup status (full state including routing, guardian, CAC, etc.).
     */
    async getAdvancedSetupStatus(): Promise<Record<string, unknown>> {
        return this.get("/api/setup/advanced/status");
    }

    /**
     * Get AI-suggested model routing for roles.
     */
    async getRoutingSuggestions(): Promise<{ suggestions: Record<string, string> }> {
        return this.get("/api/llm/routing/suggest");
    }

    /**
     * Save model routing configuration.
     */
    async postRouting(strategy: string, roleOverrides: Record<string, string>): Promise<Record<string, unknown>> {
        return this.post("/api/llm/routing", { strategy, roleOverrides });
    }

    /**
     * List available GGUF models for guardian.
     */
    async getGgufModels(): Promise<{ models: Array<{ name: string; path: string }> }> {
        return this.get("/api/models/gguf");
    }

    /**
     * Configure guardian agent.
     */
    async postGuardianConfigure(config: {
        modelPath: string;
        authorityTier: string;
        autoStart: boolean;
    }): Promise<Record<string, unknown>> {
        return this.post("/api/guardian/configure", config);
    }

    /**
     * List available characters from workspace.
     */
    async getWorkspaceCharacters(): Promise<{ characters: Array<{ id?: string; characterId?: string; name?: string; displayName?: string; executionProfile?: string }> }> {
        return this.get("/api/workspace/characters");
    }

    /**
     * Assign a character (CAC identity binding).
     */
    async postCharacterAssign(payload: {
        characterId: string;
        operatorEmail: string;
        prismUserEmail?: string;
        operatorId?: string;
        executionProfile: string;
        workspaceHub?: string;
        operatorPassword?: string;
    }): Promise<{ assignment?: { assignmentId?: string } }> {
        return this.post("/api/workspace/character-assign", payload);
    }

    /**
     * Create a browser profile.
     */
    async postBrowserProfile(email: string, segment: string): Promise<{ profile?: { profileId?: string }; profileId?: string; id?: string }> {
        return this.post("/api/browser/profiles", { email, segment });
    }

    /**
     * Create a scheduled cron job.
     */
    async postSchedulerCron(label: string, cron: string, action: string): Promise<Record<string, unknown>> {
        return this.post("/api/scheduler/cron", { label, cron, action });
    }

    /**
     * Create initialization session certificate.
     */
    async postInitializationSession(certificate: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.post("/api/setup/initialization-session", certificate);
    }

    // ── Internal HTTP helpers ────────────────────────────────────────────────

    private async get<T>(path: string): Promise<T> {
        const res = await fetch(`${this.baseUrl}${path}`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`API ${path} returned ${res.status}: ${body}`);
        }
        return res.json() as Promise<T>;
    }

    private async post<T = Record<string, unknown>>(path: string, body?: Record<string, unknown>): Promise<T> {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`API ${path} returned ${res.status}: ${text}`);
        }
        return res.json() as Promise<T>;
    }
}
