// Route coverage audit: inline routes in dashboard-service.ts handle() vs
// URLs referenced in routes/*.ts handlers. Used to prove dead-twin status
// before excision (Phase 2 refactor).
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const routesDir = join(process.cwd(), "src", "core", "operator", "routes");
const handlerText = readdirSync(routesDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `\n<<<FILE:${f}>>>\n` + readFileSync(join(routesDir, f), "utf8"))
    .join("\n");

const probes = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : readFileSync(join(process.cwd(), "scripts", "route-probes.txt"), "utf8").split(/\r?\n/).filter(Boolean);
for (const probe of probes) {
    const files = new Set();
    let idx = 0;
    const re = new RegExp(probe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    // find which files contain the probe
    const fileChunks = handlerText.split(/<<<FILE:(.+?)>>>/);
    for (let i = 1; i < fileChunks.length; i += 2) {
        const name = fileChunks[i];
        const body = fileChunks[i + 1] ?? "";
        const count = (body.match(re) || []).length;
        if (count > 0) files.add(`${name}(${count})`);
    }
    console.log(`${probe} => ${files.size > 0 ? [...files].join(", ") : "!!! NOT FOUND IN ANY HANDLER !!!"}`);
}
