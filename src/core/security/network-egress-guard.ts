import net from "node:net";

export interface EgressGuardOptions {
    allowLoopback?: boolean;
    allowPrivate?: boolean;
    allowLinkLocal?: boolean;
    allowMetadata?: boolean;
}

export interface EgressGuardResult {
    ok: boolean;
    reason?: string;
}

function parseIpv4(host: string): number[] | null {
    if (net.isIP(host) !== 4) return null;
    const parts = host.split(".").map((p) => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
        return null;
    }
    return parts;
}

function isLoopbackHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (host === "::1") return true;
    if (host.startsWith("::ffff:127.")) return true;
    const ipv4 = parseIpv4(host);
    return Boolean(ipv4 && ipv4[0] === 127);
}

function isLinkLocalIpv4(octets: number[]): boolean {
    return octets[0] === 169 && octets[1] === 254;
}

function isPrivateIpv4(octets: number[]): boolean {
    if (octets[0] === 10) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    // RFC 6598 carrier-grade NAT block.
    if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
    return false;
}

function isMetadataHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    if (host === "169.254.169.254") return true;
    if (host === "169.254.170.2") return true;
    if (host === "100.100.100.200") return true;
    if (host === "metadata.google.internal") return true;
    if (host.endsWith(".metadata.google.internal")) return true;
    return false;
}

export function validateEgressUrl(rawUrl: string, options?: EgressGuardOptions): EgressGuardResult {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { ok: false, reason: "Invalid URL." };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, reason: "Only http:// and https:// URLs are allowed." };
    }

    const host = parsed.hostname.toLowerCase();
    const allowLoopback = options?.allowLoopback ?? false;
    const allowPrivate = options?.allowPrivate ?? false;
    const allowLinkLocal = options?.allowLinkLocal ?? false;
    const allowMetadata = options?.allowMetadata ?? false;

    if (!allowMetadata && isMetadataHost(host)) {
        return { ok: false, reason: "Metadata service targets are blocked." };
    }

    if (!allowLoopback && isLoopbackHost(host)) {
        return { ok: false, reason: "Loopback targets are blocked." };
    }

    const ipType = net.isIP(host);
    if (ipType === 4) {
        const octets = parseIpv4(host);
        if (!octets) {
            return { ok: false, reason: "Invalid IPv4 address." };
        }

        if (!allowLinkLocal && isLinkLocalIpv4(octets)) {
            return { ok: false, reason: "Link-local targets are blocked." };
        }

        if (!allowPrivate && isPrivateIpv4(octets)) {
            return { ok: false, reason: "Private network targets are blocked." };
        }
    } else if (ipType === 6) {
        const normalized = host.replace(/^\[|\]$/g, "");
        if (!allowLoopback && normalized === "::1") {
            return { ok: false, reason: "Loopback targets are blocked." };
        }
        if (!allowLinkLocal && /^fe[89ab][0-9a-f]*:/i.test(normalized)) {
            return { ok: false, reason: "Link-local IPv6 targets are blocked." };
        }
        if (!allowPrivate && /^f[cd][0-9a-f]*:/i.test(normalized)) {
            return { ok: false, reason: "Private IPv6 targets are blocked." };
        }
    }

    return { ok: true };
}
