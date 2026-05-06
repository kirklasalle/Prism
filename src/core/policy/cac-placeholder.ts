/**
 * Phase E3b: CAC placeholder-identity detection.
 *
 * The wizard accepts sentinel emails (@prism.local, @placeholder) so an operator can
 * boot a workspace before their real corporate identity is provisioned. Runtime policy
 * then blocks all tier-2+ tool calls on the Business profile until real emails land.
 *
 * Keeping the predicate in a single file makes it trivial to extend the sentinel set
 * (e.g. add `@example.com` for training fixtures) without hunting through call sites.
 */

const PLACEHOLDER_SUFFIXES = ["@prism.local", "@placeholder"] as const;

export function isPlaceholderEmail(email: string | null | undefined): boolean {
    if (!email) {
        return true;
    }
    const normalized = email.trim().toLowerCase();
    if (normalized === "") {
        return true;
    }
    return PLACEHOLDER_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/**
 * Returns true when either the operator or the assistant email on the CAC snapshot
 * is a placeholder sentinel. Used to populate `PolicyContext.cac.hasPlaceholderIdentity`.
 */
export function hasPlaceholderIdentity(input: {
    operatorEmail?: string | null;
    assistantEmail?: string | null;
}): boolean {
    return isPlaceholderEmail(input.operatorEmail) || isPlaceholderEmail(input.assistantEmail);
}
