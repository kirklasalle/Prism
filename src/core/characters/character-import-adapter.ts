/**
 * Phase E3b — Character ImportAdapter.
 *
 * PRISM's character manifest is canonical. External persona formats (Openclaw,
 * CrewAI, AutoGen, plain "OpenAI system-prompt JSON") are normalized into PRISM
 * shape on ingest so the rest of the runtime never has to care about the origin.
 *
 * Detection is purely structural — we never run untrusted code from an import.
 * Conversion is deliberately lossy: unknown fields are preserved under
 * `_importSource.raw` so an operator can audit what was dropped.
 *
 * For a Business target profile, we auto-harden the denylist to include
 * high-blast-radius tools (`shell_exec`, `terminal_session`) even if the source
 * manifest omitted them, and return a `warnings[]` array so the UI can surface
 * "auto-hardened denylist applied".
 */

export type ImportShape = "prism" | "openclaw" | "crewai" | "autogen" | "openai-prompt" | "unknown";

export interface PrismCharacter {
    name: string;
    displayName: string;
    systemPrompt: string;
    toolPermissions: {
        allow: string[];
        deny: string[];
    };
    maxRiskTier: number;
    executionProfile: "individual" | "business";
    persona?: string;
    greeting?: string;
    tags: string[];
    defaultEmail?: string;
    _importSource?: {
        shape: ImportShape;
        importedAt: string;
        raw: Record<string, unknown>;
    };
}

export interface ImportAdapterResult {
    character: PrismCharacter;
    shape: ImportShape;
    warnings: string[];
    errors: string[];
}

const BUSINESS_DENYLIST_REQUIRED = ["shell_exec", "terminal_session"] as const;

/**
 * Structural shape detection — all branches must be O(1) and side-effect-free.
 */
export function detectShape(obj: unknown): ImportShape {
    if (!obj || typeof obj !== "object") {
        return "unknown";
    }
    const o = obj as Record<string, unknown>;

    // PRISM canonical: has toolPermissions object + name + systemPrompt.
    if (
        typeof o.name === "string"
        && typeof o.systemPrompt === "string"
        && typeof o.toolPermissions === "object"
        && o.toolPermissions !== null
    ) {
        return "prism";
    }

    // Openclaw: signature fields `persona` + `instructions` + optional `tools[]` array of strings.
    if (typeof o.persona === "string" && typeof o.instructions === "string") {
        return "openclaw";
    }

    // CrewAI: `role` + `goal` + `backstory` triad.
    if (typeof o.role === "string" && typeof o.goal === "string" && typeof o.backstory === "string") {
        return "crewai";
    }

    // AutoGen: `name` + `system_message` + optional `llm_config`.
    if (typeof o.name === "string" && typeof o.system_message === "string") {
        return "autogen";
    }

    // Plain OpenAI prompt JSON: `system` or `messages[0].role === "system"`.
    if (typeof o.system === "string") {
        return "openai-prompt";
    }
    if (Array.isArray(o.messages)) {
        const first = o.messages[0] as Record<string, unknown> | undefined;
        if (first && first.role === "system" && typeof first.content === "string") {
            return "openai-prompt";
        }
    }

    return "unknown";
}

function sanitizeName(raw: string, fallback: string): string {
    const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return cleaned || fallback;
}

function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => String(entry)).filter((s) => s.length > 0);
}

/**
 * Adapt an arbitrary import shape to a canonical PRISM character. Lossy by
 * design — unrecognized fields are preserved under `_importSource.raw`.
 */
export function adaptToPrism(
    obj: Record<string, unknown>,
    shape: ImportShape,
    targetProfile: "individual" | "business" = "individual",
): PrismCharacter {
    const raw = obj;
    let name = "";
    let displayName = "";
    let systemPrompt = "";
    let allow: string[] = [];
    let deny: string[] = [];
    let persona: string | undefined;
    let greeting: string | undefined;
    let tags: string[] = [];
    let maxRiskTier = targetProfile === "business" ? 1 : 2;

    switch (shape) {
        case "prism": {
            name = String(obj.name ?? "");
            displayName = String(obj.displayName ?? obj.name ?? "");
            systemPrompt = String(obj.systemPrompt ?? "");
            const tp = (obj.toolPermissions ?? {}) as Record<string, unknown>;
            allow = toStringArray(tp.allow);
            deny = toStringArray(tp.deny);
            persona = obj.persona != null ? String(obj.persona) : undefined;
            greeting = obj.greeting != null ? String(obj.greeting) : undefined;
            tags = toStringArray(obj.tags);
            if (Number.isFinite(Number(obj.maxRiskTier))) maxRiskTier = Number(obj.maxRiskTier);
            break;
        }
        case "openclaw": {
            name = String(obj.name ?? obj.id ?? "openclaw-import");
            displayName = String(obj.displayName ?? obj.name ?? name);
            systemPrompt = String(obj.instructions ?? "");
            persona = String(obj.persona ?? "");
            greeting = obj.greeting != null ? String(obj.greeting) : undefined;
            allow = toStringArray(obj.tools);
            tags = toStringArray(obj.tags);
            break;
        }
        case "crewai": {
            name = String(obj.name ?? obj.role ?? "crewai-agent");
            displayName = String(obj.role ?? name);
            systemPrompt = [
                `Role: ${obj.role}`,
                `Goal: ${obj.goal}`,
                `Backstory: ${obj.backstory}`,
            ].join("\n\n");
            persona = String(obj.role ?? "");
            allow = toStringArray(obj.tools);
            tags = ["imported", "crewai"];
            break;
        }
        case "autogen": {
            name = String(obj.name ?? "autogen-agent");
            displayName = name;
            systemPrompt = String(obj.system_message ?? "");
            tags = ["imported", "autogen"];
            break;
        }
        case "openai-prompt": {
            if (typeof obj.system === "string") {
                systemPrompt = obj.system;
            } else if (Array.isArray(obj.messages)) {
                const first = obj.messages[0] as Record<string, unknown> | undefined;
                if (first && typeof first.content === "string") {
                    systemPrompt = first.content;
                }
            }
            name = String(obj.name ?? "openai-imported");
            displayName = String(obj.displayName ?? name);
            tags = ["imported", "openai-prompt"];
            break;
        }
        default: {
            name = String(obj.name ?? "unknown-import");
            displayName = name;
            systemPrompt = String(obj.systemPrompt ?? obj.instructions ?? obj.system_message ?? "");
        }
    }

    name = sanitizeName(name, "imported-character");
    displayName = displayName.trim() || name;

    // Auto-harden the Business denylist.
    if (targetProfile === "business") {
        for (const tool of BUSINESS_DENYLIST_REQUIRED) {
            if (!deny.includes(tool)) {
                deny.push(tool);
            }
            // If the source explicitly allowed a blast-radius tool, revoke it.
            allow = allow.filter((t) => t !== tool);
        }
        if (maxRiskTier > 1) maxRiskTier = 1;
    }

    return {
        name,
        displayName,
        systemPrompt,
        toolPermissions: { allow, deny },
        maxRiskTier,
        executionProfile: targetProfile,
        persona,
        greeting,
        tags,
        _importSource: {
            shape,
            importedAt: new Date().toISOString(),
            raw,
        },
    };
}

/**
 * Validate a candidate PRISM character. Errors block the import; warnings are
 * informational and surface in the wizard preview.
 */
export function validatePrismCharacter(
    character: PrismCharacter,
    targetProfile: "individual" | "business" = "individual",
): { warnings: string[]; errors: string[] } {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!character.name) errors.push("name is required.");
    if (!character.systemPrompt || character.systemPrompt.trim().length === 0) {
        errors.push("systemPrompt is required and must be non-empty.");
    }

    if (targetProfile === "business") {
        const missing = BUSINESS_DENYLIST_REQUIRED.filter(
            (tool) => !character.toolPermissions.deny.includes(tool),
        );
        if (missing.length > 0) {
            // This path is only reachable if a caller bypassed adaptToPrism; keep as a
            // safety net so validation alone can guard the gate.
            warnings.push(
                `Business profile auto-hardened denylist for: ${missing.join(", ")}.`,
            );
            for (const tool of missing) character.toolPermissions.deny.push(tool);
        }
        if (character.maxRiskTier > 1) {
            warnings.push(
                `Business profile caps maxRiskTier at 1 (was ${character.maxRiskTier}).`,
            );
            character.maxRiskTier = 1;
        }
    }

    return { warnings, errors };
}

/**
 * Top-level convenience: detect + adapt + validate in one call.
 */
export function importCharacter(
    raw: unknown,
    targetProfile: "individual" | "business" = "individual",
): ImportAdapterResult {
    const shape = detectShape(raw);
    if (shape === "unknown") {
        return {
            character: {
                name: "",
                displayName: "",
                systemPrompt: "",
                toolPermissions: { allow: [], deny: [] },
                maxRiskTier: targetProfile === "business" ? 1 : 2,
                executionProfile: targetProfile,
                tags: [],
            },
            shape,
            warnings: [],
            errors: ["Unrecognized character manifest shape. Supported: prism, openclaw, crewai, autogen, openai-prompt."],
        };
    }

    const warnings: string[] = [];
    const rawDeny = (raw as { toolPermissions?: { deny?: unknown } } | null | undefined)?.toolPermissions?.deny;
    const originalDenyCount = Array.isArray(rawDeny) ? rawDeny.length : 0;

    const character = adaptToPrism(raw as Record<string, unknown>, shape, targetProfile);

    if (targetProfile === "business" && character.toolPermissions.deny.length > originalDenyCount) {
        warnings.push(
            `Business profile auto-hardened denylist (added: ${BUSINESS_DENYLIST_REQUIRED.join(", ")}).`,
        );
    }

    const { warnings: moreWarnings, errors } = validatePrismCharacter(character, targetProfile);
    warnings.push(...moreWarnings);

    return { character, shape, warnings, errors };
}
