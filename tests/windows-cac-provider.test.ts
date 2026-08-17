import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";
import { WindowsCacProvider } from "../src/core/iam/cac/providers/windows-cac-provider.js";
import type { CacAuthRequest } from "../src/core/iam/cac/types.js";

describe("Windows CAC Provider & Smart Card Authentication", () => {
    let provider: WindowsCacProvider;

    beforeEach(() => {
        provider = new WindowsCacProvider();
    });

    it("initializes with correct id and name", () => {
        assert.equal(provider.id, "windows-cac");
        assert.equal(provider.name, "Windows Smart Card Provider");
    });

    it("authenticates successfully with mock_development method", async () => {
        const request: CacAuthRequest = {
            method: "mock_development",
            operatorPrivilege: "administrator",
            securityLevel: "secret",
            tenantId: "tenant-defense-01",
            clientIp: "127.0.0.1",
            userAgent: "Prism-Console/0.23.0",
            sessionTimeoutMs: 3600000,
        };

        const response = await provider.authenticate(request);

        assert.equal(response.success, true);
        assert.ok(response.sessionId?.startsWith("session_"));
        assert.equal(response.privilegeLevel, "administrator");
        assert.equal(response.securityLevel, "secret");
        assert.ok(response.certificateInfo);
        assert.equal(response.certificateInfo.commonName, "DOE.JOHN.MIDDLE.1234567890");
        assert.equal(response.certificateInfo.cacId, "1234567890");
        assert.equal(response.certificateInfo.email, "john.doe@example.mil");
        assert.equal(response.certificateInfo.revocationStatus, "valid");

        // Audit Trail Assertions
        assert.ok(response.auditInfo);
        assert.equal(response.auditInfo.result, "success");
        assert.equal(response.auditInfo.method, "mock_development");
        assert.equal(response.auditInfo.clientIp, "127.0.0.1");
        assert.equal(response.auditInfo.metadata?.securityLevel, "secret");
    });

    it("handles missing certificate data in certificate auth method", async () => {
        const request: CacAuthRequest = {
            method: "certificate",
            operatorPrivilege: "operator",
            securityLevel: "confidential",
            tenantId: "tenant-01",
            clientIp: "127.0.0.1",
        };

        const response = await provider.authenticate(request);

        assert.equal(response.success, false);
        assert.equal(response.errorCode, "certificate_invalid");
        assert.ok(response.error?.includes("Certificate data is required"));
        assert.ok(response.auditInfo);
        assert.equal(response.auditInfo.result, "failure");
    });

    it("rejects unsupported authentication method gracefully", async () => {
        const request: CacAuthRequest = {
            method: "invalid_method" as any,
            operatorPrivilege: "read_only",
            securityLevel: "unclassified",
            tenantId: "tenant-01",
            clientIp: "127.0.0.1",
        };

        const response = await provider.authenticate(request);

        assert.equal(response.success, false);
        assert.equal(response.errorCode, "system_error");
        assert.ok(response.error?.includes("Unsupported authentication method"));
    });

    it("extracts CAC ID correctly from standard DoD subject formats", () => {
        const extractMethod = (provider as any).extractCacId.bind(provider);
        assert.equal(extractMethod("SMITH.JANE.ANN.9876543210"), "9876543210");
        assert.equal(extractMethod("LASALLE.KIRK.A.1122334455"), "1122334455");
        assert.equal(extractMethod("INVALID.NAME.FORMAT"), "");
    });
});
