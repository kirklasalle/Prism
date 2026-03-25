import assert from "node:assert";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserProfileManager } from "../src/core/operator/browser-profile-manager.js";
import { ActivityBus } from "../src/core/activity/bus.js";

// Use a temp directory for test isolation
const TEST_PROFILES_DIR = join(process.cwd(), "tmp", "test-browser-profiles");

function cleanTestDir() {
    if (existsSync(TEST_PROFILES_DIR)) {
        rmSync(TEST_PROFILES_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_PROFILES_DIR, { recursive: true });
}

// Subclass to override profilesRoot for test isolation
class TestBrowserProfileManager extends BrowserProfileManager {
    private testRoot: string;
    constructor(testRoot: string, activityBus?: ActivityBus, sessionId?: string) {
        super(activityBus, sessionId);
        this.testRoot = testRoot;
    }
    // Override private method via prototype trick — use (this as any) approach
}

// Since profilesRoot is private, we need a different approach: monkey-patch after construction
function createTestManager(activityBus?: ActivityBus, sessionId?: string): BrowserProfileManager {
    const mgr = new BrowserProfileManager(activityBus, sessionId);
    // Override the private profilesRoot to use test directory
    (mgr as any).profilesRoot = () => TEST_PROFILES_DIR;
    return mgr;
}

async function testCreateProfile(): Promise<void> {
    cleanTestDir();
    const mgr = createTestManager();
    const profile = mgr.createProfile({
        prismUserEmail: "Kirk@PrismAI.com",
        executionProfileSegment: "business",
    });

    assert.ok(profile.profileId.startsWith("profile-"), "profileId should have prefix");
    assert.strictEqual(profile.prismUserEmail, "kirk@prismai.com", "Email should be lowercased");
    assert.strictEqual(profile.executionProfileSegment, "business");
    assert.strictEqual(profile.sessionCount, 0);
    assert.ok(profile.createdAt, "Should have createdAt timestamp");
    assert.ok(profile.displayName.toLowerCase().includes("kirk@prismai.com"), "Display name should include email");

    // Verify on-disk persistence
    const manifestPath = join(TEST_PROFILES_DIR, profile.profileId, "profile-manifest.json");
    assert.ok(existsSync(manifestPath), "Manifest should be written to disk");

    const diskManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    assert.strictEqual(diskManifest.profileId, profile.profileId);
    console.log("  ✓ createProfile persists manifest to disk");
}

async function testListProfiles(): Promise<void> {
    cleanTestDir();
    const mgr = createTestManager();

    // Empty initially
    assert.strictEqual(mgr.listProfiles().length, 0, "Should start empty");

    mgr.createProfile({ prismUserEmail: "a@test.com", executionProfileSegment: "individual" });
    mgr.createProfile({ prismUserEmail: "b@test.com", executionProfileSegment: "business" });

    const profiles = mgr.listProfiles();
    assert.strictEqual(profiles.length, 2, "Should list 2 profiles");
    assert.ok(profiles.every(p => p.hasStorageState === false), "No storage state yet");
    console.log("  ✓ listProfiles returns all created profiles");
}

async function testGetProfile(): Promise<void> {
    cleanTestDir();
    const mgr = createTestManager();

    assert.strictEqual(mgr.getProfile("nonexistent"), null, "Nonexistent returns null");

    const created = mgr.createProfile({ prismUserEmail: "test@example.com", executionProfileSegment: "individual" });
    const fetched = mgr.getProfile(created.profileId);
    assert.ok(fetched, "Should find created profile");
    assert.strictEqual(fetched!.profileId, created.profileId);
    assert.strictEqual(fetched!.prismUserEmail, "test@example.com");
    assert.strictEqual(fetched!.hasStorageState, false);
    console.log("  ✓ getProfile returns profile by ID");
}

async function testDeleteProfile(): Promise<void> {
    cleanTestDir();
    const mgr = createTestManager();

    assert.strictEqual(mgr.deleteProfile("nonexistent"), false, "Delete nonexistent returns false");

    const profile = mgr.createProfile({ prismUserEmail: "del@test.com", executionProfileSegment: "individual" });
    assert.ok(mgr.getProfile(profile.profileId), "Should exist before delete");

    const deleted = mgr.deleteProfile(profile.profileId);
    assert.strictEqual(deleted, true, "Delete should return true");
    assert.strictEqual(mgr.getProfile(profile.profileId), null, "Should be gone after delete");
    assert.strictEqual(mgr.listProfiles().length, 0, "List should be empty");
    console.log("  ✓ deleteProfile removes profile from disk");
}

async function testStorageStateIO(): Promise<void> {
    cleanTestDir();
    const mgr = createTestManager();

    const profile = mgr.createProfile({ prismUserEmail: "storage@test.com", executionProfileSegment: "business" });

    // No storage state initially
    assert.strictEqual(mgr.loadStorageState(profile.profileId), undefined, "No state initially");

    // Save storage state
    const mockState = {
        cookies: [{ name: "session", value: "abc123", domain: ".example.com", path: "/" }],
        origins: [{ origin: "https://example.com", localStorage: [{ name: "key", value: "val" }] }],
    };
    mgr.saveStorageState(profile.profileId, mockState);

    // Load it back
    const loaded = mgr.loadStorageState(profile.profileId);
    assert.ok(loaded, "Should load saved state");
    assert.deepStrictEqual(loaded, mockState, "Loaded state should match saved state");

    // Profile should now report hasStorageState
    const info = mgr.getProfile(profile.profileId);
    assert.strictEqual(info!.hasStorageState, true, "Should have storage state flag");
    console.log("  ✓ saveStorageState/loadStorageState round-trips correctly");
}

async function testRecordSessionLaunch(): Promise<void> {
    cleanTestDir();
    const mgr = createTestManager();

    const profile = mgr.createProfile({ prismUserEmail: "launch@test.com", executionProfileSegment: "individual" });
    assert.strictEqual(profile.sessionCount, 0);

    mgr.recordSessionLaunch(profile.profileId);
    const updated = mgr.getProfile(profile.profileId);
    assert.strictEqual(updated!.sessionCount, 1, "Session count should increment");

    mgr.recordSessionLaunch(profile.profileId);
    mgr.recordSessionLaunch(profile.profileId);
    const updated2 = mgr.getProfile(profile.profileId);
    assert.strictEqual(updated2!.sessionCount, 3, "Session count should be 3 after 3 launches");
    console.log("  ✓ recordSessionLaunch increments session count");
}

async function testActivityBusEmission(): Promise<void> {
    cleanTestDir();
    const bus = new ActivityBus();
    const events: string[] = [];
    bus.subscribe({ onEvent: (e) => events.push(e.operation) });

    const mgr = createTestManager(bus, "test-session");

    mgr.createProfile({ prismUserEmail: "bus@test.com", executionProfileSegment: "business" });
    assert.ok(events.includes("browser.profile.created"), "Should emit browser.profile.created");

    const profiles = mgr.listProfiles();
    mgr.saveStorageState(profiles[0].profileId, { cookies: [] });
    assert.ok(events.includes("browser.profile.saved"), "Should emit browser.profile.saved");

    mgr.deleteProfile(profiles[0].profileId);
    assert.ok(events.includes("browser.profile.deleted"), "Should emit browser.profile.deleted");
    console.log("  ✓ ActivityBus events emitted for profile lifecycle");
}

async function testEmailNormalization(): Promise<void> {
    cleanTestDir();
    const mgr = createTestManager();

    const profile = mgr.createProfile({
        prismUserEmail: "  KIRK@PrismAI.COM  ",
        executionProfileSegment: "business",
        operatorEmail: " Op@Company.ORG ",
    });

    assert.strictEqual(profile.prismUserEmail, "kirk@prismai.com", "Email lowercased and trimmed");
    assert.strictEqual(profile.operatorEmail, "op@company.org", "Operator email lowercased and trimmed");
    console.log("  ✓ Email addresses are normalized on create");
}

export async function testBrowserProfileManager(): Promise<void> {
    console.log("BrowserProfileManager");
    await testCreateProfile();
    await testListProfiles();
    await testGetProfile();
    await testDeleteProfile();
    await testStorageStateIO();
    await testRecordSessionLaunch();
    await testActivityBusEmission();
    await testEmailNormalization();

    // Clean up
    if (existsSync(TEST_PROFILES_DIR)) {
        rmSync(TEST_PROFILES_DIR, { recursive: true, force: true });
    }
}
