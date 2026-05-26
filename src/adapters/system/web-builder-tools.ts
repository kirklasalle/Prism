import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";

/**
 * Tool for initializing a premium, obsidian-glassmorphic responsive website boilerplate.
 */
export class WebPageInitializeTool implements Tool {
    readonly name = "web_page_initialize";
    readonly contract = {
        version: "1.0.0",
        args: {
            path: { type: "string", required: true },
            theme: { type: "string" },
            title: { type: "string" },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const projectDir = String(request.args.path ?? "");
        const theme = String(request.args.theme ?? "obsidian-glass");
        const title = String(request.args.title ?? "PRISM Specular Portal");

        try {
            await fs.mkdir(projectDir, { recursive: true });
            
            const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Plus+Jakarta+Sans:wght@300;400;500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <!-- Refraction Glow Canvas Background -->
    <div class="glow-container">
        <div class="glow-orb orb-purple"></div>
        <div class="glow-orb orb-blue"></div>
    </div>

    <!-- Main Navigation Header -->
    <header class="prism-header">
        <div class="logo">
            <span class="logo-symbol">⚡</span>
            <span class="logo-text">PRISM</span>
        </div>
        <nav class="nav-links">
            <a href="#features" class="active">Features</a>
            <a href="#about">Refraction</a>
            <a href="#telemetry">Live Status</a>
        </nav>
        <button class="cta-button mini">Launch Operator</button>
    </header>

    <main id="app-root">
        <!-- Components injected here -->
    </main>

    <footer class="prism-footer">
        <p>&copy; 2026 PRISM Spectrum Refraction. All light processed.</p>
    </footer>

    <script src="script.js"></script>
</body>
</html>`;

            const cssContent = `/* Premium Obsidian-Glass Theme Core */
:root {
    --bg-dark: #09090e;
    --card-bg: rgba(22, 22, 34, 0.7);
    --border-color: rgba(139, 92, 246, 0.25);
    --text-primary: #f8fafc;
    --text-muted: #94a3b8;
    --violet-glow: #8b5cf6;
    --blue-glow: #3b82f6;
    --neon-cyan: #00f0ff;
    --font-heading: 'Outfit', sans-serif;
    --font-body: 'Plus Jakarta Sans', sans-serif;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    background-color: var(--bg-dark);
    color: var(--text-primary);
    font-family: var(--font-body);
    overflow-x: hidden;
    min-height: 100vh;
}

/* Iridescent glow animations */
.glow-container {
    position: fixed;
    inset: 0;
    z-index: -1;
    overflow: hidden;
}

.glow-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(140px);
    opacity: 0.25;
    animation: orbMove 15s infinite ease-in-out alternate;
}

.orb-purple {
    width: 50vw;
    height: 50vw;
    background: radial-gradient(circle, var(--violet-glow) 0%, transparent 70%);
    top: -10%;
    left: -10%;
}

.orb-blue {
    width: 60vw;
    height: 60vw;
    background: radial-gradient(circle, var(--blue-glow) 0%, transparent 70%);
    bottom: -15%;
    right: -10%;
    animation-delay: -5s;
}

@keyframes orbMove {
    0% { transform: translate(0, 0) scale(1); }
    100% { transform: translate(10%, 8%) scale(1.1); }
}

/* Frosted Obsidian Header */
.prism-header {
    position: sticky;
    top: 0;
    z-index: 100;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 6%;
    background: rgba(9, 9, 14, 0.75);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-heading);
    font-weight: 800;
    font-size: 20px;
    background: linear-gradient(90deg, #a78bfa, #38bdf8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.logo-symbol {
    -webkit-text-fill-color: initial;
}

.nav-links {
    display: flex;
    gap: 32px;
}

.nav-links a {
    color: var(--text-muted);
    text-decoration: none;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.3s ease;
}

.nav-links a:hover, .nav-links a.active {
    color: var(--text-primary);
    text-shadow: 0 0 10px rgba(167, 139, 250, 0.5);
}

/* Glass Buttons */
.cta-button {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.3));
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    padding: 12px 28px;
    border-radius: 9999px;
    font-weight: 600;
    cursor: pointer;
    backdrop-filter: blur(6px);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.cta-button:hover {
    box-shadow: 0 0 25px rgba(139, 92, 246, 0.4);
    border-color: rgba(167, 139, 250, 0.6);
    transform: translateY(-2px);
}

.cta-button.mini {
    padding: 8px 18px;
    font-size: 13px;
}

/* Footer styling */
.prism-footer {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
    font-size: 13px;
    border-top: 1px solid rgba(255, 255, 255, 0.03);
    margin-top: 60px;
}`;

            const jsContent = `/* Interactive glow pointer and visual particles */
document.addEventListener('DOMContentLoaded', () => {
    // Add particle container dynamically
    const main = document.getElementById('app-root');
    const followGlow = document.createElement('div');
    followGlow.className = 'mouse-follow-glow';
    followGlow.style.cssText = 'position:fixed;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle, rgba(0,240,255,0.08) 0%, transparent 70%);pointer-events:none;transform:translate(-50%, -50%);z-index:9999;opacity:0;transition:opacity 0.5s ease;';
    document.body.appendChild(followGlow);

    document.addEventListener('mousemove', (e) => {
        followGlow.style.opacity = '1';
        followGlow.style.left = e.clientX + 'px';
        followGlow.style.top = e.clientY + 'px';
    });

    document.addEventListener('mouseleave', () => {
        followGlow.style.opacity = '0';
    });
});`;

            await fs.writeFile(path.join(projectDir, "index.html"), htmlContent, "utf-8");
            await fs.writeFile(path.join(projectDir, "style.css"), cssContent, "utf-8");
            await fs.writeFile(path.join(projectDir, "script.js"), jsContent, "utf-8");

            return {
                ok: true,
                output: {
                    initialized: true,
                    path: projectDir,
                    files: ["index.html", "style.css", "script.js"],
                    theme,
                },
                sideEffects: [{ type: "file", description: `Initialized web directory inside ${projectDir}` }],
            };
        } catch (err: unknown) {
            return { ok: false, output: { error: String(err) } };
        }
    }
}

/**
 * Tool to dynamically inject a premium component (Hero Grid, pricing panels, modal systems)
 */
export class WebComponentInjectTool implements Tool {
    readonly name = "web_component_inject";
    readonly contract = {
        version: "1.0.0",
        args: {
            filePath: { type: "string", required: true },
            componentType: { type: "string", required: true, enum: ["hero", "features", "testimonials", "live-dashboard"] },
            title: { type: "string" },
            subtitle: { type: "string" },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const filePath = String(request.args.filePath ?? "");
        const componentType = String(request.args.componentType ?? "hero");
        const title = String(request.args.title ?? "Specular Refraction Engine");
        const subtitle = String(request.args.subtitle ?? "Dramatically scaling parallel cognitive hemispheres into absolute consensus.");

        try {
            const htmlContent = await fs.readFile(filePath, "utf-8");
            
            // Build component markups
            let markup = "";
            let cssMarkup = "";

            if (componentType === "hero") {
                markup = `
        <section class="prism-section hero-section" id="features">
            <div class="hero-content">
                <span class="badge-tag">SOTA COGNITIVE COOPERATION</span>
                <h1>${title}</h1>
                <p>${subtitle}</p>
                <div class="hero-buttons">
                    <button class="cta-button">Initiate Spectrum Loop</button>
                    <button class="cta-button secondary" onclick="alert('Accessing knowledge archives...')">View Blueprint</button>
                </div>
            </div>
            <div class="specular-sphere-preview">
                <div class="sphere-glass">
                    <div class="ring-core ring-1"></div>
                    <div class="ring-core ring-2"></div>
                </div>
            </div>
        </section>`;

                cssMarkup = `
/* Hero Component Styling */
.prism-section {
    padding: 80px 8%;
    display: flex;
    align-items: center;
    gap: 40px;
    flex-wrap: wrap;
}

.hero-section {
    min-height: 80vh;
}

.hero-content {
    flex: 1;
    min-width: 320px;
}

.badge-tag {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 9999px;
    background: rgba(139, 92, 246, 0.12);
    border: 1px solid rgba(139, 92, 246, 0.3);
    color: #a78bfa;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.8px;
    margin-bottom: 20px;
}

.hero-content h1 {
    font-family: var(--font-heading);
    font-size: 48px;
    font-weight: 800;
    line-height: 1.15;
    margin-bottom: 24px;
}

.hero-content p {
    color: var(--text-muted);
    font-size: 16px;
    line-height: 1.6;
    margin-bottom: 32px;
}

.hero-buttons {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
}

.cta-button.secondary {
    background: transparent;
    border-color: rgba(255, 255, 255, 0.1);
}

.cta-button.secondary:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.25);
}

/* Glass sphere preview design */
.specular-sphere-preview {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    min-width: 320px;
}

.sphere-glass {
    position: relative;
    width: 300px;
    height: 300px;
    background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.1), transparent 60%);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 50%;
    backdrop-filter: blur(12px);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4), inset 0 10px 20px rgba(255,255,255,0.1);
    animation: floatSphere 6s infinite ease-in-out;
}

.ring-core {
    position: absolute;
    inset: 20px;
    border: 1px dashed rgba(167, 139, 250, 0.35);
    border-radius: 50%;
    animation: spinRing 12s linear infinite;
}

.ring-2 {
    inset: 40px;
    border: 1px dotted rgba(56, 189, 248, 0.4);
    animation-duration: 8s;
    animation-direction: reverse;
}

@keyframes floatSphere {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-12px); }
}

@keyframes spinRing {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}`;
            } else if (componentType === "features") {
                markup = `
        <section class="prism-section features-section" id="about">
            <h2 class="section-title">Cooperative Refraction Triad</h2>
            <div class="features-grid">
                <div class="feature-card">
                    <div class="feat-icon">🧠</div>
                    <h3>Logical Hemisphere</h3>
                    <p>Enforces perfect deterministic constraints, strict syntax schemas, and zero-day threat prevention guardrails.</p>
                </div>
                <div class="feature-card">
                    <div class="feat-icon">🎨</div>
                    <h3>Creative Hemisphere</h3>
                    <p>Forges stunning HSL gradients, frosted obsidians, and high-fidelity fluid visual designs that delight users.</p>
                </div>
                <div class="feature-card">
                    <div class="feat-icon">⚡</div>
                    <h3>Consensus Refractor</h3>
                    <p>Orchestrates Left and Right processes in parallel, validating alignments prior to final runtime output compilation.</p>
                </div>
            </div>
        </section>`;

                cssMarkup = `
/* Features Grid Component styling */
.features-section {
    flex-direction: column;
    align-items: center;
}

.section-title {
    font-family: var(--font-heading);
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 40px;
    text-align: center;
    background: linear-gradient(90deg, #fff, var(--text-muted));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.features-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 24px;
    width: 100%;
}

.feature-card {
    background: var(--card-bg);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 32px;
    backdrop-filter: blur(8px);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.feature-card:hover {
    border-color: var(--border-color);
    box-shadow: 0 10px 30px rgba(139, 92, 246, 0.15);
    transform: translateY(-4px);
}

.feat-icon {
    font-size: 28px;
    margin-bottom: 20px;
}`;
            }

            // Inject HTML inside the <main id="app-root"> container
            const mainPlaceholder = '<main id="app-root">';
            const mainIndex = htmlContent.indexOf(mainPlaceholder);

            if (mainIndex === -1) {
                return { ok: false, output: { error: "Could not find target <main id='app-root'> placeholder in HTML file." } };
            }

            const insertPosition = mainIndex + mainPlaceholder.length;
            const updatedHtml = htmlContent.slice(0, insertPosition) + markup + htmlContent.slice(insertPosition);

            // Append CSS to style.css
            const cssPath = path.join(path.dirname(filePath), "style.css");
            let styleContent = "";
            try { styleContent = await fs.readFile(cssPath, "utf-8"); } catch (_) { /* ignore */ }
            const updatedCss = styleContent + "\n\n" + cssMarkup;

            await fs.writeFile(filePath, updatedHtml, "utf-8");
            await fs.writeFile(cssPath, updatedCss, "utf-8");

            return {
                ok: true,
                output: {
                    injected: true,
                    filePath,
                    componentType,
                },
                sideEffects: [{ type: "file", description: `Injected component ${componentType} into ${filePath}` }],
            };

        } catch (err: unknown) {
            return { ok: false, output: { error: String(err) } };
        }
    }
}

/**
 * Tool for wiring web assets (CDNs, stylesheets) dynamically
 */
export class WebAssetsOptimizeTool implements Tool {
    readonly name = "web_assets_optimize";
    readonly contract = {
        version: "1.0.0",
        args: {
            filePath: { type: "string", required: true },
            library: { type: "string", required: true, enum: ["lucide-icons", "gsap-animation", "google-fonts"] },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const filePath = String(request.args.filePath ?? "");
        const library = String(request.args.library ?? "");

        try {
            let htmlContent = await fs.readFile(filePath, "utf-8");

            let scriptTag = "";
            if (library === "lucide-icons") {
                scriptTag = '\n    <script src="https://unpkg.com/lucide@latest"></script>';
            } else if (library === "gsap-animation") {
                scriptTag = '\n    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>';
            }

            if (scriptTag && !htmlContent.includes(scriptTag.trim())) {
                const bodyClose = "</body>";
                const insertPos = htmlContent.indexOf(bodyClose);
                if (insertPos !== -1) {
                    htmlContent = htmlContent.slice(0, insertPos) + scriptTag + "\n" + htmlContent.slice(insertPos);
                    await fs.writeFile(filePath, htmlContent, "utf-8");
                }
            }

            return {
                ok: true,
                output: {
                    optimized: true,
                    library,
                    filePath,
                },
            };

        } catch (err: unknown) {
            return { ok: false, output: { error: String(err) } };
        }
    }
}

/**
 * Tool for performing local sandbox DOM validation checks
 */
export class WebVisualAuditTool implements Tool {
    readonly name = "web_visual_audit";
    readonly contract = {
        version: "1.0.0",
        args: {
            filePath: { type: "string", required: true },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const filePath = String(request.args.filePath ?? "");
        try {
            const htmlContent = await fs.readFile(filePath, "utf-8");
            
            // Basic audits: check for script tags, CSS tags, missing links
            const hasStyle = htmlContent.includes('link rel="stylesheet"') || htmlContent.includes('<style>');
            const hasScript = htmlContent.includes('src="script.js"') || htmlContent.includes('<script>');
            const brokenImages = (htmlContent.match(/<img[^>]+src=""[^>]*>/gi) || []).length;
            const divMismatches = (htmlContent.match(/<div/g) || []).length !== (htmlContent.match(/<\/div>/g) || []).length;

            const passes = hasStyle && hasScript && brokenImages === 0 && !divMismatches;

            return {
                ok: true,
                output: {
                    passes,
                    audits: {
                        styleReferenced: hasStyle,
                        scriptReferenced: hasScript,
                        emptyImageTags: brokenImages,
                        unclosedDivs: divMismatches,
                    },
                },
            };
        } catch (err: unknown) {
            return { ok: false, output: { error: String(err) } };
        }
    }
}

/**
 * Tool for performing granular surgery edits (drop-in replacements) on files in the Prism IDE.
 */
export class PrismIdeModifyTool implements Tool {
    readonly name = "prism_ide_modify";
    readonly contract = {
        version: "1.0.0",
        args: {
            filePath: { type: "string", required: true },
            targetContent: { type: "string", required: true },
            replacementContent: { type: "string", required: true },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const filePath = String(request.args.filePath ?? "");
        const targetContent = String(request.args.targetContent ?? "");
        const replacementContent = String(request.args.replacementContent ?? "");

        try {
            const content = await fs.readFile(filePath, "utf-8");
            
            // Validate unique occurrence of targetContent to prevent bad edits
            const firstIndex = content.indexOf(targetContent);
            if (firstIndex === -1) {
                return {
                    ok: false,
                    output: { error: `Target content not found in the file: ${filePath}` }
                };
            }
            
            const lastIndex = content.lastIndexOf(targetContent);
            if (firstIndex !== lastIndex) {
                return {
                    ok: false,
                    output: { error: `Multiple occurrences of target content found. Please provide more context lines to ensure uniqueness.` }
                };
            }

            const updatedContent = content.slice(0, firstIndex) + replacementContent + content.slice(firstIndex + targetContent.length);

            // Simple AST / Brackets validation for basic syntax checking
            const hasBalancedBrackets = (str: string): boolean => {
                const stack: string[] = [];
                const open = ["{", "[", "("];
                const close = ["}", "]", ")"];
                const pairs: Record<string, string> = { "}": "{", "]": "[", ")": "(" };
                for (let i = 0; i < str.length; i++) {
                    if (open.includes(str[i])) {
                        stack.push(str[i]);
                    } else if (close.includes(str[i])) {
                        if (stack.length === 0 || stack.pop() !== pairs[str[i]]) {
                            return false;
                        }
                    }
                }
                return stack.length === 0;
            };

            const isJs = filePath.endsWith(".js") || filePath.endsWith(".ts");
            let lintWarning = "";
            if (isJs && !hasBalancedBrackets(updatedContent)) {
                lintWarning = "Warning: Brackets are unbalanced. This might introduce parsing errors.";
            }

            await fs.writeFile(filePath, updatedContent, "utf-8");

            return {
                ok: true,
                output: {
                    modified: true,
                    filePath,
                    lintWarning: lintWarning || undefined,
                },
                sideEffects: [{ type: "file", description: `Modified file content in ${filePath}` }],
            };
        } catch (err: unknown) {
            return { ok: false, output: { error: String(err) } };
        }
    }
}

/**
 * Tool for performing comprehensive diagnostic and compliance audits on web project codebases.
 */
export class PrismIdeLintTool implements Tool {
    readonly name = "prism_ide_lint";
    readonly contract = {
        version: "1.0.0",
        args: {
            filePath: { type: "string", required: true },
        },
    } as const;

    async execute(request: ToolRequest): Promise<ToolResult> {
        const filePath = String(request.args.filePath ?? "");
        const dir = path.dirname(filePath);

        try {
            const htmlContent = await fs.readFile(filePath, "utf-8");
            
            // 1. Audit structural tags
            const divOpenCount = (htmlContent.match(/<div/g) || []).length;
            const divCloseCount = (htmlContent.match(/<\/div>/g) || []).length;
            const isDivBalanced = divOpenCount === divCloseCount;

            // 2. Audit stylesheet references
            const cssMatch = htmlContent.match(/<link[^>]+href="([^"]+\.css)"/g);
            const missingStylesheets: string[] = [];
            if (cssMatch) {
                for (const matchStr of cssMatch) {
                    const hrefMatch = matchStr.match(/href="([^"]+)"/);
                    if (hrefMatch) {
                        const href = hrefMatch[1];
                        if (!href.startsWith("http://") && !href.startsWith("https://")) {
                            const fullCssPath = path.join(dir, href);
                            try {
                                await fs.access(fullCssPath);
                            } catch (_) {
                                missingStylesheets.push(href);
                            }
                        }
                    }
                }
            }

            // 3. Audit script references
            const scriptMatch = htmlContent.match(/<script[^>]+src="([^"]+\.js)"/g);
            const missingScripts: string[] = [];
            if (scriptMatch) {
                for (const matchStr of scriptMatch) {
                    const srcMatch = matchStr.match(/src="([^"]+)"/);
                    if (srcMatch) {
                        const src = srcMatch[1];
                        if (!src.startsWith("http://") && !src.startsWith("https://")) {
                            const fullJsPath = path.join(dir, src);
                            try {
                                await fs.access(fullJsPath);
                            } catch (_) {
                                missingScripts.push(src);
                            }
                        }
                    }
                }
            }

            // 4. Audit images and accessibility tags
            const imgMatch = htmlContent.match(/<img[^>]+/g) || [];
            const missingAlts: number = imgMatch.filter(tag => !tag.includes('alt=')).length;

            const passes = isDivBalanced && missingStylesheets.length === 0 && missingScripts.length === 0;

            return {
                ok: true,
                output: {
                    passes,
                    diagnostics: {
                        isDivBalanced,
                        divOpenCount,
                        divCloseCount,
                        missingStylesheets,
                        missingScripts,
                        missingAltsOnImages: missingAlts,
                    }
                }
            };
        } catch (err: unknown) {
            return { ok: false, output: { error: String(err) } };
        }
    }
}

