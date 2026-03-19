import {
    PluginPackValidator,
    PluginPackManifest,
} from '../src/core/plugins/plugin-pack-validator.js';

/**
 * Plugin Pack Validator Test Suite
 */

const testResults: {
    passed: number;
    failed: number;
    tests: Array<{ name: string; passed: boolean; error?: string }>;
} = {
    passed: 0,
    failed: 0,
    tests: [],
};

const TEST_PACK_PATH = process.cwd();

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) {
        throw new Error(`Assertion failed: ${message}. Expected ${expected}, got ${actual}`);
    }
}

function test(name: string, fn: () => void): void {
    try {
        fn();
        testResults.passed++;
        testResults.tests.push({ name, passed: true });
        console.log(`✓ ${name}`);
    } catch (error) {
        testResults.failed++;
        testResults.tests.push({
            name,
            passed: false,
            error: error instanceof Error ? error.message : String(error),
        });
        console.log(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// Helper: Create valid base manifest
function createValidManifest(): PluginPackManifest {
    return {
        manifest_version: '1.0',
        pack_name: 'test-pack',
        pack_version: '1.0.0',
        description: 'A test plugin pack for validation testing',
        author: {
            name: 'Test Author',
            email: 'test@example.com',
        },
        license: 'MIT',
        adapters: [
            {
                adapter_id: 'test-adapter',
                adapter_type: 'terminal',
                entry_file: 'dist/src/index.js',
                capabilities: ['execute_command'],
                tier_routing: {
                    tier1_keywords: ['ls', 'cat'],
                    tier2_keywords: ['mkdir', 'cp'],
                    tier3_keywords: ['rm', 'sudo'],
                    default_tier: 2,
                },
            },
        ],
        compatibility: {
            prism_min_version: '0.1.0',
            profiles: ['both'],
            node_version: '>=18.0.0',
        },
    };
}

// Test: Valid manifest passes validation
test('Valid manifest passes validation', () => {
    const manifest = createValidManifest();
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(result.valid, 'Manifest should be valid');
    assertEqual(result.errors.length, 0, 'Should have no errors');
});

// Test: Missing manifest_version failure
test('Missing manifest_version causes error', () => {
    const manifest = createValidManifest();
    delete (manifest as any).manifest_version;
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field === 'manifest_version'), 'Should have manifest_version error');
});

// Test: Invalid manifest_version
test('Invalid manifest_version format is rejected', () => {
    const manifest = createValidManifest();
    manifest.manifest_version = '2.0';
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field === 'manifest_version'), 'Should reject version 2.0');
});

// Test: Invalid pack_name format
test('Invalid pack_name format is rejected', () => {
    const manifest = createValidManifest();
    manifest.pack_name = 'Invalid Name!';
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field === 'pack_name'), 'Should reject invalid format');
});

// Test: pack_name too long
test('pack_name exceeding max length is rejected', () => {
    const manifest = createValidManifest();
    manifest.pack_name = 'a'.repeat(200);
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field === 'pack_name'), 'Should reject overly long name');
});

// Test: Invalid semantic version
test('Invalid semantic version is rejected', () => {
    const manifest = createValidManifest();
    manifest.pack_version = 'not-a-version';
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field === 'pack_version'), 'Should reject invalid SemVer');
});

// Test: Missing license
test('Missing license causes error', () => {
    const manifest = createValidManifest();
    delete (manifest as any).license;
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field === 'license'), 'Should have license error');
});

// Test: Unsupported license
test('Unsupported license is rejected', () => {
    const manifest = createValidManifest();
    manifest.license = 'Proprietary-Custom' as any;
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field === 'license'), 'Should reject unsupported license');
});

// Test: Empty adapters array
test('Empty adapters array is rejected', () => {
    const manifest = createValidManifest();
    manifest.adapters = [];
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field === 'adapters'), 'Should reject empty adapters');
});

// Test: Duplicate adapter IDs
test('Duplicate adapter IDs are rejected', () => {
    const manifest = createValidManifest();
    manifest.adapters = [
        manifest.adapters[0],
        {
            ...manifest.adapters[0],
            adapter_id: 'test-adapter', // Duplicate
        },
    ];
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(
        result.errors.some((e: any) => e.field.includes('adapter_id') && e.message.includes('Duplicate')),
        'Should reject duplicate adapter IDs'
    );
});

// Test: Invalid adapter_type
test('Invalid adapter_type is rejected', () => {
    const manifest = createValidManifest();
    manifest.adapters[0].adapter_type = 'invalid-type' as any;
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field.includes('adapter_type')), 'Should reject invalid type');
});

// Test: Empty capabilities
test('Empty capabilities array is rejected', () => {
    const manifest = createValidManifest();
    manifest.adapters[0].capabilities = [];
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field.includes('capabilities')), 'Should reject empty capabilities');
});

// Test: Missing tier_routing
test('Missing tier_routing causes error', () => {
    const manifest = createValidManifest();
    delete (manifest.adapters[0] as any).tier_routing;
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field.includes('tier_routing')), 'Should reject missing tier_routing');
});

// Test: Invalid default_tier
test('Invalid default_tier is rejected', () => {
    const manifest = createValidManifest();
    manifest.adapters[0].tier_routing.default_tier = 5;
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field.includes('default_tier')), 'Should reject tier 5');
});

// Test: Missing compatibility
test('Missing compatibility causes error', () => {
    const manifest = createValidManifest();
    delete (manifest as any).compatibility;
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field === 'compatibility'), 'Should have compatibility error');
});

// Test: Missing prism_min_version
test('Missing prism_min_version causes error', () => {
    const manifest = createValidManifest();
    delete (manifest.compatibility as any).prism_min_version;
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(
        result.errors.some((e: any) => e.field === 'compatibility.prism_min_version'),
        'Should have prism_min_version error'
    );
});

// Test: Empty profiles
test('Empty profiles array is rejected', () => {
    const manifest = createValidManifest();
    manifest.compatibility.profiles = [];
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field === 'compatibility.profiles'), 'Should reject empty profiles');
});

// Test: Invalid profile value
test('Invalid profile value is rejected', () => {
    const manifest = createValidManifest();
    manifest.compatibility.profiles = ['invalid-profile'] as any;
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(result.errors.some((e: any) => e.field === 'compatibility.profiles'), 'Should reject invalid profile');
});

// Test: Unreviewed security status warning
test('Unreviewed security status produces warning', () => {
    const manifest = createValidManifest();
    manifest.security = {
        review_status: 'unreviewed',
    };
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(result.valid, 'Manifest should be valid');
    assert(result.warnings.some((w: any) => w.field === 'security.review_status'), 'Should warn about unreviewed status');
});

// Test: Signature without algorithm warning
test('Signature without algorithm produces warning', () => {
    const manifest = createValidManifest();
    manifest.security = {
        signature: 'base64_encoded_sig...',
    };
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(result.valid, 'Manifest should be valid');
    assert(
        result.warnings.some((w: any) => w.field === 'security.signature'),
        'Should warn about missing signature_algorithm'
    );
});

// Test: Multiple adapters validate correctly
test('Multiple adapters in pack validate correctly', () => {
    const manifest = createValidManifest();
    manifest.adapters.push({
        adapter_id: 'second-adapter',
        adapter_type: 'container',
        entry_file: 'dist/src/index.js',
        capabilities: ['create_container', 'execute_in_container'],
        tier_routing: {
            tier1_keywords: ['ls', 'pwd'],
            tier2_keywords: ['mkdir'],
            tier3_keywords: ['rm'],
            default_tier: 2,
        },
    });
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(result.valid, 'Manifest should be valid with multiple adapters');
    assertEqual(result.errors.length, 0, 'Should have no errors');
});

// Test: Circular dependency detection
test('Circular dependency is detected', () => {
    const manifest = createValidManifest();
    manifest.adapters = [
        {
            adapter_id: 'adapter-a',
            adapter_type: 'terminal',
            entry_file: 'dist/a.js',
            capabilities: ['test'],
            tier_routing: { default_tier: 2 },
            dependencies: [{ adapter_id: 'adapter-b' }],
        },
        {
            adapter_id: 'adapter-b',
            adapter_type: 'terminal',
            entry_file: 'dist/b.js',
            capabilities: ['test'],
            tier_routing: { default_tier: 2 },
            dependencies: [{ adapter_id: 'adapter-a' }], // Circular!
        },
    ];
    const validator = new PluginPackValidator(manifest, '/tmp');
    const result = validator.validate();

    assert(!result.valid, 'Manifest should be invalid');
    assert(
        result.errors.some((e: any) => e.field === 'adapters.dependencies' && e.message.includes('Circular')),
        'Should detect circular dependency'
    );
});

// Test: Valid SemVer variations
test('Valid SemVer variations are accepted', () => {
    const versions = ['1.0.0', '1.2.3', '0.0.1', '10.20.30-beta', '1.0.0-alpha+001', '2.0.0+20130313144700'];

    versions.forEach((version: string) => {
        const manifest = createValidManifest();
        manifest.pack_version = version;
        const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
        const result = validator.validate();

        assert(result.valid, `Should accept SemVer: ${version}`);
    });
});

// Test: Short description warning
test('Very short description produces warning', () => {
    const manifest = createValidManifest();
    manifest.description = 'Short';
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(result.valid, 'Manifest should be valid');
    assert(result.warnings.some((w: any) => w.field === 'description'), 'Should warn about short description');
});

// Test: Result metadata is populated
test('Validation result includes metadata', () => {
    const manifest = createValidManifest();
    const validator = new PluginPackValidator(manifest, TEST_PACK_PATH);
    const result = validator.validate();

    assert(!!result.metadata.timestamp, 'Should have timestamp');
    assert(!!result.metadata.validatorVersion, 'Should have validator version');
    assertEqual(result.metadata.packName, 'test-pack', 'Should record pack name');
    assertEqual(result.metadata.packVersion, '1.0.0', 'Should record pack version');
});

// Summary
console.log('\n' + '='.repeat(60));
console.log('Plugin Pack Validator Test Results');
console.log('='.repeat(60));
console.log(`✓ Passed: ${testResults.passed}`);
console.log(`✗ Failed: ${testResults.failed}`);
console.log(`Total:   ${testResults.tests.length}`);

if (testResults.failed > 0) {
    console.log('\nFailed Tests:');
    testResults.tests
        .filter((t: any) => !t.passed)
        .forEach((t: any) => {
            console.log(`  - ${t.name}: ${t.error}`);
        });
    process.exit(1);
} else {
    console.log('\n✓ All tests passed!');
    process.exit(0);
}
