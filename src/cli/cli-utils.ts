/**
 * PRISM CLI Utilities — Pure Node.js readline helpers for interactive CLI wizards.
 * Zero external dependencies: uses built-in readline and ANSI escape codes.
 */
import * as readline from "node:readline";

// ──────────────────────────────────────────────────────────────────────────────
// ANSI Color Utilities
// ──────────────────────────────────────────────────────────────────────────────

const ESC = "\x1b[";

export const ansi = {
    reset: `${ESC}0m`,
    bold: `${ESC}1m`,
    dim: `${ESC}2m`,
    underline: `${ESC}4m`,
    // Foreground
    red: `${ESC}31m`,
    green: `${ESC}32m`,
    yellow: `${ESC}33m`,
    blue: `${ESC}34m`,
    magenta: `${ESC}35m`,
    cyan: `${ESC}36m`,
    white: `${ESC}37m`,
    gray: `${ESC}90m`,
    // Cursor / line control
    clearLine: `${ESC}2K`,
    cursorUp: (n = 1) => `${ESC}${n}A`,
    cursorToCol: (col = 0) => `${ESC}${col}G`,
    hideCursor: `${ESC}?25l`,
    showCursor: `${ESC}?25h`,
};

export function color(text: string, ...codes: string[]): string {
    return codes.join("") + text + ansi.reset;
}

// ──────────────────────────────────────────────────────────────────────────────
// Symbols
// ──────────────────────────────────────────────────────────────────────────────

export const sym = {
    check: "✓",
    cross: "✗",
    arrow: "→",
    bullet: "●",
    circle: "○",
    bar: "█",
    barEmpty: "░",
    ellipsis: "…",
    diamond: "◆",
};

// ──────────────────────────────────────────────────────────────────────────────
// Step Header / Check Printing
// ──────────────────────────────────────────────────────────────────────────────

export function printBanner(): void {
    console.log("");
    console.log(color("  ╔══════════════════════════════════════╗", ansi.cyan, ansi.bold));
    console.log(color("  ║        PRISM CLI Setup Wizard        ║", ansi.cyan, ansi.bold));
    console.log(color("  ╚══════════════════════════════════════╝", ansi.cyan, ansi.bold));
    console.log("");
}

export function printStep(stepNum: number, totalSteps: number, title: string): void {
    const progress = Array.from({ length: totalSteps }, (_, i) =>
        i < stepNum ? color(sym.bar, ansi.cyan) : color(sym.barEmpty, ansi.gray)
    ).join("");
    console.log("");
    console.log(`  ${progress}  ${color(`Step ${stepNum}/${totalSteps}`, ansi.gray)}`);
    console.log(color(`  ${sym.diamond} ${title}`, ansi.cyan, ansi.bold));
    console.log(color("  " + "─".repeat(40), ansi.gray));
}

export function printCheck(label: string, passed: boolean, detail?: string): void {
    const icon = passed ? color(sym.check, ansi.green) : color(sym.cross, ansi.red);
    const labelText = passed ? label : color(label, ansi.red);
    const suffix = detail ? color(` — ${detail}`, ansi.gray) : "";
    console.log(`  ${icon} ${labelText}${suffix}`);
}

export function printInfo(message: string): void {
    console.log(color(`  ℹ ${message}`, ansi.gray));
}

export function printSuccess(message: string): void {
    console.log(color(`  ${sym.check} ${message}`, ansi.green, ansi.bold));
}

export function printError(message: string): void {
    console.log(color(`  ${sym.cross} ${message}`, ansi.red, ansi.bold));
}

export function printWarning(message: string): void {
    console.log(color(`  ⚠ ${message}`, ansi.yellow));
}

// ──────────────────────────────────────────────────────────────────────────────
// Readline Helpers
// ──────────────────────────────────────────────────────────────────────────────

function createInterface(): readline.Interface {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

/**
 * Prompt for free-text input with optional default.
 */
export async function prompt(question: string, defaultValue?: string): Promise<string> {
    const rl = createInterface();
    const defaultHint = defaultValue ? color(` (${defaultValue})`, ansi.gray) : "";
    return new Promise<string>((resolve) => {
        rl.question(`  ${question}${defaultHint}: `, (answer) => {
            rl.close();
            resolve(answer.trim() || defaultValue || "");
        });
    });
}

/**
 * Y/N confirmation prompt.
 */
export async function confirm(question: string, defaultYes = true): Promise<boolean> {
    const hint = defaultYes ? "[Y/n]" : "[y/N]";
    const answer = await prompt(`${question} ${color(hint, ansi.gray)}`);
    if (!answer) return defaultYes;
    return answer.toLowerCase().startsWith("y");
}

/**
 * Masked input for secrets (API keys, passwords).
 */
export async function maskedInput(question: string): Promise<string> {
    return new Promise<string>((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        // Intercept output to mask characters
        const originalWrite = process.stdout.write.bind(process.stdout);
        let collecting = false;
        let buffer = "";

        process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
            if (collecting && typeof chunk === "string") {
                // Only mask the user's typed characters, not the prompt itself
                const masked = chunk.replace(/./g, "*");
                return (originalWrite as Function).call(process.stdout, masked, ...args);
            }
            return (originalWrite as Function).call(process.stdout, chunk, ...args);
        }) as typeof process.stdout.write;

        rl.question(`  ${question}: `, (answer) => {
            collecting = false;
            process.stdout.write = originalWrite;
            rl.close();
            resolve(answer.trim());
        });

        collecting = true;
        buffer = "";
    });
}

/**
 * Interactive selection menu with arrow-key navigation.
 */
export interface SelectOption {
    label: string;
    value: string;
    description?: string;
}

export async function select(
    question: string,
    options: SelectOption[],
    defaultIndex = 0,
): Promise<string> {
    if (options.length === 0) throw new Error("select() requires at least one option.");

    return new Promise<string>((resolve) => {
        let selectedIdx = defaultIndex;

        function render(initial = false): void {
            // Move cursor up to overwrite previous render (except on first render)
            if (!initial) {
                process.stdout.write(ansi.cursorUp(options.length));
            }
            for (let i = 0; i < options.length; i++) {
                const opt = options[i];
                const pointer = i === selectedIdx ? color(` ${sym.arrow} `, ansi.cyan, ansi.bold) : "   ";
                const label = i === selectedIdx
                    ? color(opt.label, ansi.cyan, ansi.bold)
                    : color(opt.label, ansi.white);
                const desc = opt.description ? color(` — ${opt.description}`, ansi.gray) : "";
                process.stdout.write(`${ansi.clearLine}${pointer}${label}${desc}\n`);
            }
        }

        console.log(`  ${question}`);
        render(true);

        // Raw mode for keypress detection
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        process.stdin.resume();

        const onKeypress = (data: Buffer): void => {
            const key = data.toString();

            // Up arrow: \x1b[A
            if (key === "\x1b[A" || key === "k") {
                selectedIdx = Math.max(0, selectedIdx - 1);
                render();
                return;
            }
            // Down arrow: \x1b[B
            if (key === "\x1b[B" || key === "j") {
                selectedIdx = Math.min(options.length - 1, selectedIdx + 1);
                render();
                return;
            }
            // Enter
            if (key === "\r" || key === "\n") {
                cleanup();
                resolve(options[selectedIdx].value);
                return;
            }
            // Ctrl+C
            if (key === "\x03") {
                cleanup();
                process.exit(2);
            }
        };

        function cleanup(): void {
            process.stdin.removeListener("data", onKeypress);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
            }
            process.stdin.pause();
        }

        process.stdin.on("data", onKeypress);
    });
}

/**
 * Simple inline spinner for async operations.
 */
export function spinner(message: string): { stop: (result: string) => void } {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;
    process.stdout.write(ansi.hideCursor);

    const interval = setInterval(() => {
        process.stdout.write(`\r  ${color(frames[i % frames.length], ansi.cyan)} ${message}`);
        i++;
    }, 80);

    return {
        stop(result: string) {
            clearInterval(interval);
            process.stdout.write(`\r${ansi.clearLine}  ${result}\n`);
            process.stdout.write(ansi.showCursor);
        },
    };
}
