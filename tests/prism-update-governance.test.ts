import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

describe("PRISM update governance integration", () => {
    const root = process.cwd();
    const orchestrator = readFileSync(join(root, "scripts", "prism-update.cjs"), "utf8");

    it("runs every coordinated governance gate before restart", () => {
        const requiredCommands = [
            "npm run security:directive-integrity",
            "npm run governance:artifacts:check",
            "npm run governance:key-rotation:verify",
            "npm run governance:erratum:check",
        ];
        for (const command of requiredCommands) {
            assert.match(orchestrator, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        }

        const verificationIndex = orchestrator.indexOf("Verifying coordinated governance artifacts");
        const restartIndex = orchestrator.indexOf("Restarting Prism gateway/server");
        assert.ok(verificationIndex >= 0, "governance verification stage is missing");
        assert.ok(restartIndex > verificationIndex, "runtime restart must occur after governance verification");
    });

    it("keeps Windows and POSIX wrappers on the shared orchestrator", () => {
        const windowsWrapper = readFileSync(join(root, "update.bat"), "utf8");
        const posixWrapper = readFileSync(join(root, "update.sh"), "utf8");
        assert.match(windowsWrapper, /node scripts\/prism-update\.cjs %\*/);
        assert.match(posixWrapper, /node scripts\/prism-update\.cjs "\$@"/);
    });
});