import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateEnvironment } from "../src/bootstrap/environment.js";

describe("Environment validation", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalDataDir = process.env.PRISM_DATA_DIR;
    const originalJwtSecret = process.env.PRISM_JWT_SECRET;
    const originalUserProfile = process.env.USERPROFILE;
    let testRoot: string | undefined;

    afterEach(() => {
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = originalNodeEnv;
        if (originalDataDir === undefined) delete process.env.PRISM_DATA_DIR;
        else process.env.PRISM_DATA_DIR = originalDataDir;
        if (originalJwtSecret === undefined) delete process.env.PRISM_JWT_SECRET;
        else process.env.PRISM_JWT_SECRET = originalJwtSecret;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        if (testRoot) rmSync(testRoot, { recursive: true, force: true });
    });

    it("persists a development JWT secret when PRISM_DATA_DIR is empty", () => {
        testRoot = mkdtempSync(join(tmpdir(), "prism-environment-test-"));
        process.env.NODE_ENV = "development";
        process.env.PRISM_DATA_DIR = "";
        process.env.PRISM_JWT_SECRET = "";
        process.env.USERPROFILE = testRoot;

        const generated = validateEnvironment();
        const secretPath = join(testRoot, ".prism", ".prism-jwt-secret");
        assert.equal(generated.fatals.length, 0);
        assert.equal(generated.warnings.some((warning) => warning.includes("auto-generation failed")), false);
        assert.ok(generated.resolvedJwtSecret.length >= 32);
        assert.equal(existsSync(secretPath), true);

        process.env.PRISM_JWT_SECRET = "";
        const reloaded = validateEnvironment();
        assert.equal(reloaded.resolvedJwtSecret, generated.resolvedJwtSecret);
    });
});