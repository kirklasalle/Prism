import assert from "node:assert";
import { InMemoryOAuthTokenStore } from "../src/core/operator/oauth-token-store.js";
import { GmailOAuthAdapter } from "../src/adapters/application/email-oauth-adapter.js";
import { OutlookOAuthAdapter } from "../src/adapters/application/outlook-oauth-adapter.js";

export async function testOAuthAdapters(): Promise<void> {
    console.log("  → Testing OAuth Adapters");

    // 1. Token Store Operations
    const store = new InMemoryOAuthTokenStore();
    store.set("gmail", {
        accessToken: "test_access",
        refreshToken: "test_refresh",
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        scopes: ["test_scope"],
        provider: "gmail"
    });

    assert.strictEqual(store.has("gmail"), true);
    const retrieved = store.get("gmail");
    assert.strictEqual(retrieved?.accessToken, "test_access");
    
    const providers = store.listProviders();
    assert.deepStrictEqual(providers, ["gmail"]);
    
    store.clear("gmail");
    assert.strictEqual(store.has("gmail"), false);

    // 2. Gmail OAuth Adapter (Graceful unavailability)
    const oldGmailId = process.env.PRISM_GMAIL_CLIENT_ID;
    const oldGmailSecret = process.env.PRISM_GMAIL_CLIENT_SECRET;
    delete process.env.PRISM_GMAIL_CLIENT_ID;
    delete process.env.PRISM_GMAIL_CLIENT_SECRET;

    const gmailAdapter = new GmailOAuthAdapter(store);
    await new Promise(r => setTimeout(r, 50)); // Wait for tryInit

    const gmailStatus = await gmailAdapter.getStatus();
    assert.strictEqual(gmailStatus.available, false, "Gmail should be unavailable without credentials");
    assert.strictEqual(gmailStatus.connected, false);

    await assert.rejects(
        gmailAdapter.getAuthorizationUrl(),
        /not available/i,
        "Should throw when generating auth URL without credentials"
    );

    if (oldGmailId) process.env.PRISM_GMAIL_CLIENT_ID = oldGmailId;
    if (oldGmailSecret) process.env.PRISM_GMAIL_CLIENT_SECRET = oldGmailSecret;

    // 3. Outlook OAuth Adapter (Graceful unavailability)
    const oldOutlookId = process.env.PRISM_OUTLOOK_CLIENT_ID;
    delete process.env.PRISM_OUTLOOK_CLIENT_ID;

    const outlookAdapter = new OutlookOAuthAdapter(store);
    await new Promise(r => setTimeout(r, 50));

    const outlookStatus = await outlookAdapter.getStatus();
    assert.strictEqual(outlookStatus.available, false, "Outlook should be unavailable without credentials");
    assert.strictEqual(outlookStatus.connected, false);

    await assert.rejects(
        outlookAdapter.getAuthorizationUrl(),
        /not available/i,
        "Should throw when generating auth URL without credentials"
    );

    if (oldOutlookId) process.env.PRISM_OUTLOOK_CLIENT_ID = oldOutlookId;
}
