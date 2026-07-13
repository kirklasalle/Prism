import { createHash, randomBytes, scryptSync } from "node:crypto";

/**
 * Hash a password using scrypt with dynamic salting.
 */
export function hashPassword(password: string): string {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
    return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored hash.
 * Supports legacy SHA-256 for backward compatibility.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
    if (!storedHash) return false;

    if (!storedHash.includes(":")) {
        // Fallback check for legacy SHA-256 password hash
        const sha256Hex = createHash("sha256").update(password, "utf-8").digest("hex");
        return storedHash === sha256Hex;
    }

    const parts = storedHash.split(":");
    if (parts.length !== 2) return false;

    const [salt, hash] = parts;
    const computedHash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
    return computedHash === hash;
}
