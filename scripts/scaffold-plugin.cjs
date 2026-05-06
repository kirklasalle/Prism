#!/usr/bin/env node
/**
 * scripts/scaffold-plugin.cjs
 *
 * Phase G — Plugin SDK scaffolder. Emits a starter adapter pack layout under a
 * target directory. Generates a working `plugin.manifest.json`, README,
 * capability stub, and a smoke test wiring.
 *
 * Usage:
 *   npm run plugin:scaffold -- --id my-org.demo-pack --name "Demo Pack" --out tmp/demo-pack
 *
 * No external dependencies. All output is plain text.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
    const args = { id: "", name: "", out: "", description: "Starter PRISM adapter pack." };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--id") args.id = argv[++i];
        else if (a === "--name") args.name = argv[++i];
        else if (a === "--out") args.out = argv[++i];
        else if (a === "--description") args.description = argv[++i];
    }
    if (!args.id || !args.name || !args.out) {
        console.error("Usage: scaffold-plugin --id <reverse.dns.id> --name <\"Display Name\"> --out <path> [--description <text>]");
        process.exit(2);
    }
    return args;
}

function emitManifest(args) {
    return JSON.stringify({
        formatVersion: 1,
        id: args.id,
        name: args.name,
        version: "0.1.0",
        description: args.description,
        license: "Apache-2.0",
        minPrismVersion: "0.7.0",
        capabilities: [
            {
                id: `${args.id}.hello`,
                name: "hello",
                tier: 0,
                scopes: [],
                description: "Returns a friendly greeting. Replace with your real capability."
            }
        ],
        tags: ["scaffold", "starter"],
        tier: 0
    }, null, 2);
}

function emitReadme(args) {
    return `# ${args.name}\n\n${args.description}\n\n` +
        `## Build\n\n\`\`\`\nnpm install\nnpm test\n\`\`\`\n\n` +
        `## Sign (optional)\n\n` +
        `See \`docs/PLUGIN_SDK_AUTHORING_GUIDE.md\` §2.\n`;
}

function emitCapabilityStub() {
    return `// src/capabilities/hello.js\n` +
        `// Replace this stub with your real capability implementation.\n` +
        `// PRISM invokes this entrypoint via the manifest \`capabilities[].name\`.\n\n` +
        `exports.hello = async function hello(input, ctx) {\n` +
        `    const name = (input && input.name) || "world";\n` +
        `    ctx.activity?.emit({ type: "plugin.hello", name });\n` +
        `    return { greeting: "hello, " + name };\n` +
        `};\n`;
}

function emitSmokeTest() {
    return `// test/smoke.test.js\n` +
        `// Loads the manifest and invokes the hello capability against a mock context.\n\n` +
        `const test = require("node:test");\n` +
        `const assert = require("node:assert");\n` +
        `const { hello } = require("../src/capabilities/hello.js");\n\n` +
        `test("hello capability responds", async () => {\n` +
        `    const out = await hello({ name: "PRISM" }, { activity: { emit: () => {} } });\n` +
        `    assert.strictEqual(out.greeting, "hello, PRISM");\n` +
        `});\n`;
}

function emitPackageJson(args) {
    return JSON.stringify({
        name: args.id,
        version: "0.1.0",
        description: args.description,
        scripts: { test: "node --test test/" },
        license: "Apache-2.0"
    }, null, 2);
}

function emitChangelog(args) {
    return `# ${args.name} Changelog\n\n## 0.1.0 — initial scaffold\n`;
}

function emitGitignore() {
    return ["node_modules/", "*.log", "tmp/", "*.sig", "*.sig.json"].join("\n") + "\n";
}

function writeFile(targetPath, contents) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, contents, "utf-8");
}

function scaffold(args) {
    const out = path.resolve(process.cwd(), args.out);
    if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
        throw new Error(`Refusing to overwrite non-empty directory: ${out}`);
    }
    writeFile(path.join(out, "plugin.manifest.json"), emitManifest(args));
    writeFile(path.join(out, "package.json"), emitPackageJson(args));
    writeFile(path.join(out, "README.md"), emitReadme(args));
    writeFile(path.join(out, "CHANGELOG.md"), emitChangelog(args));
    writeFile(path.join(out, ".gitignore"), emitGitignore());
    writeFile(path.join(out, "src", "capabilities", "hello.js"), emitCapabilityStub());
    writeFile(path.join(out, "test", "smoke.test.js"), emitSmokeTest());
    return out;
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2));
    try {
        const out = scaffold(args);
        console.log(`Scaffolded plugin pack at: ${out}`);
        console.log("Next: cd into the directory, run `npm install && npm test`.");
    } catch (err) {
        console.error("Scaffold failed:", err.message);
        process.exit(1);
    }
}

module.exports = { scaffold, parseArgs };
