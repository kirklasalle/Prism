/**
 * Framebuffer Capture Engine — World-class multi-monitor screen capture for agentic vision.
 *
 * Captures all monitors stitched left-to-right using PowerShell + C# System.Drawing interop.
 * DPI-aware for mixed-resolution multi-monitor setups.
 * Supports single-frame capture and burst capture (8-12 FPS) via a single PowerShell invocation.
 * Sharp is optional — falls back to raw PNG if unavailable.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { workspaceFramebufferDir } from "../config/workspace-resolver.js";

const execFileAsync = promisify(execFile);

// ── Sharp lazy loader (optional dependency) ──────────────────────────────────

let _sharp: typeof import("sharp") | null | undefined;
async function getSharp(): Promise<typeof import("sharp") | null> {
    if (_sharp !== undefined) return _sharp;
    try {
        _sharp = (await import("sharp")).default;
        return _sharp;
    } catch {
        _sharp = null;
        return null;
    }
}

// ── PowerShell C# capture script ─────────────────────────────────────────────

/**
 * Generates the PowerShell/C# script for screen capture.
 * - Calls SetProcessDPIAware() for true pixel coordinates on mixed-DPI setups.
 * - Enumerates Screen.AllScreens, sorts left-to-right by Bounds.X.
 * - Single capture: stitches all monitors into one PNG, writes base64 to stdout.
 * - Burst capture: loops N frames at target interval, writes files to outputDir.
 */
function captureScript(outputDir: string, burstCount: number, intervalMs: number): string {
    // Escape backslashes for C# string literal
    const safeDir = outputDir.replace(/\\/g, "\\\\");
    return `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DpiHelper {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
[DpiHelper]::SetProcessDPIAware() | Out-Null

function Capture-AllScreens {
    param([string]$OutPath)
    $screens = [System.Windows.Forms.Screen]::AllScreens | Sort-Object { $_.Bounds.X }
    $minX = ($screens | Measure-Object -Property { $_.Bounds.X } -Minimum).Minimum
    $minY = ($screens | Measure-Object -Property { $_.Bounds.Y } -Minimum).Minimum
    $maxRight = ($screens | ForEach-Object { $_.Bounds.X + $_.Bounds.Width } | Measure-Object -Maximum).Maximum
    $maxBottom = ($screens | ForEach-Object { $_.Bounds.Y + $_.Bounds.Height } | Measure-Object -Maximum).Maximum
    $totalW = $maxRight - $minX
    $totalH = $maxBottom - $minY
    $bmp = New-Object System.Drawing.Bitmap($totalW, $totalH)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Black)
    foreach ($scr in $screens) {
        $srcX = $scr.Bounds.X
        $srcY = $scr.Bounds.Y
        $w = $scr.Bounds.Width
        $h = $scr.Bounds.Height
        $g.CopyFromScreen($srcX, $srcY, ($srcX - $minX), ($srcY - $minY), (New-Object System.Drawing.Size($w, $h)))
    }
    $g.Dispose()
    if ($OutPath -eq "STDOUT") {
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        $bytes = $ms.ToArray()
        $ms.Dispose()
        [Convert]::ToBase64String($bytes)
    } else {
        $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        Write-Output $OutPath
    }
}

$burstCount = ${burstCount}
$intervalMs = ${intervalMs}
$outDir = "${safeDir}"

if ($burstCount -le 1) {
    Capture-AllScreens -OutPath "STDOUT"
} else {
    $ts = (Get-Date -Format "yyyyMMdd-HHmmss")
    for ($i = 0; $i -lt $burstCount; $i++) {
        $frameStart = [System.Diagnostics.Stopwatch]::GetTimestamp()
        $fname = "burst-$ts-$($i.ToString('D4')).png"
        $fpath = Join-Path $outDir $fname
        Capture-AllScreens -OutPath $fpath
        Write-Output $fname
        if ($i -lt ($burstCount - 1)) {
            $elapsed = (([System.Diagnostics.Stopwatch]::GetTimestamp() - $frameStart) * 1000 / [System.Diagnostics.Stopwatch]::Frequency)
            $sleepMs = [Math]::Max(0, $intervalMs - $elapsed)
            if ($sleepMs -gt 0) { Start-Sleep -Milliseconds ([int]$sleepMs) }
        }
    }
}
`;
}

// ── File metadata type ───────────────────────────────────────────────────────

export interface ScreengrabFile {
    name: string;
    size: number;
    mtime: string;
}

// ── FramebufferCapture class ─────────────────────────────────────────────────

export class FramebufferCapture {
    private lastBurstTime = 0;
    private static readonly BURST_COOLDOWN_MS = 10_000;
    private static readonly MAX_FILES = 300;
    private static readonly MAX_DISK_MB = 500;
    private static readonly MAX_WIDTH = 1920;

    private ensureDir(): string {
        const dir = workspaceFramebufferDir();
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    /**
     * Capture all monitors into a single PNG buffer.
     */
    async captureAllMonitors(): Promise<Buffer> {
        const dir = this.ensureDir();
        const script = captureScript(dir, 1, 0);
        const { stdout } = await execFileAsync("powershell.exe", [
            "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script,
        ], { timeout: 15_000, maxBuffer: 50 * 1024 * 1024 });
        const base64 = stdout.trim();
        return Buffer.from(base64, "base64");
    }

    /**
     * Capture a single frame, process with sharp (optional), save to framebuffer dir.
     * Returns the filename of the saved screengrab.
     */
    async captureSingle(): Promise<{ filename: string; sizeBytes: number; timestamp: string }> {
        const dir = this.ensureDir();
        const raw = await this.captureAllMonitors();

        // Process with sharp if available (resize + compress)
        let processed: Buffer;
        const sharp = await getSharp();
        if (sharp) {
            const meta = await sharp(raw).metadata();
            if (meta.width && meta.width > FramebufferCapture.MAX_WIDTH) {
                processed = await sharp(raw)
                    .resize({ width: FramebufferCapture.MAX_WIDTH, withoutEnlargement: true })
                    .png({ compressionLevel: 6 })
                    .toBuffer();
            } else {
                processed = await sharp(raw).png({ compressionLevel: 6 }).toBuffer();
            }
        } else {
            processed = raw;
        }

        const timestamp = new Date().toISOString();
        const safeTs = timestamp.replace(/[:.]/g, "-");
        const filename = `capture-${safeTs}.png`;

        // Write timestamped file + latest.png
        writeFileSync(join(dir, filename), processed);
        writeFileSync(join(dir, "latest.png"), processed);

        // Cleanup old files
        this.cleanup();

        return { filename, sizeBytes: processed.length, timestamp };
    }

    /**
     * Burst capture at target FPS via single PowerShell invocation.
     * Returns array of filenames.
     */
    async burstCapture(fps = 8, durationSec = 2): Promise<{ files: string[]; frames: number }> {
        // Enforce cooldown
        const now = Date.now();
        if (now - this.lastBurstTime < FramebufferCapture.BURST_COOLDOWN_MS) {
            const waitSec = Math.ceil((FramebufferCapture.BURST_COOLDOWN_MS - (now - this.lastBurstTime)) / 1000);
            throw new Error(`Burst cooldown: wait ${waitSec}s before next burst`);
        }

        // Clamp parameters
        fps = Math.max(1, Math.min(15, fps));
        durationSec = Math.max(0.5, Math.min(5, durationSec));
        const frameCount = Math.round(fps * durationSec);
        const intervalMs = Math.round(1000 / fps);

        const dir = this.ensureDir();
        const script = captureScript(dir, frameCount, intervalMs);

        this.lastBurstTime = Date.now();
        const { stdout } = await execFileAsync("powershell.exe", [
            "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script,
        ], { timeout: (durationSec + 10) * 1000, maxBuffer: 10 * 1024 * 1024 });

        const files = stdout.trim().split(/\r?\n/).filter(Boolean);

        // Update latest.png with the last burst frame
        if (files.length > 0) {
            const lastFrame = join(dir, files[files.length - 1]);
            if (existsSync(lastFrame)) {
                const { copyFileSync } = await import("node:fs");
                copyFileSync(lastFrame, join(dir, "latest.png"));
            }
        }

        this.cleanup();
        return { files, frames: files.length };
    }

    /**
     * Get the path to the latest screengrab, or null if none exists.
     */
    getLatestPath(): string | null {
        const dir = workspaceFramebufferDir();
        const latest = join(dir, "latest.png");
        return existsSync(latest) ? latest : null;
    }

    /**
     * List screengrabs sorted by mtime descending.
     */
    listScreengrabs(limit = 60): ScreengrabFile[] {
        const dir = workspaceFramebufferDir();
        if (!existsSync(dir)) return [];
        const entries = readdirSync(dir)
            .filter(f => f.endsWith(".png") && f !== "latest.png")
            .map(name => {
                const st = statSync(join(dir, name));
                return { name, size: st.size, mtime: st.mtime.toISOString() };
            })
            .sort((a, b) => b.mtime.localeCompare(a.mtime));
        return entries.slice(0, limit);
    }

    /**
     * Prune old screengrabs by file count and total disk usage.
     */
    cleanup(): void {
        const dir = workspaceFramebufferDir();
        if (!existsSync(dir)) return;
        const files = readdirSync(dir)
            .filter(f => f.endsWith(".png") && f !== "latest.png")
            .map(name => {
                const st = statSync(join(dir, name));
                return { name, size: st.size, mtime: st.mtime.getTime() };
            })
            .sort((a, b) => a.mtime - b.mtime); // oldest first

        // Prune by count
        while (files.length > FramebufferCapture.MAX_FILES) {
            const oldest = files.shift()!;
            try { unlinkSync(join(dir, oldest.name)); } catch { /* ignore */ }
        }

        // Prune by total size
        let totalBytes = files.reduce((sum, f) => sum + f.size, 0);
        const maxBytes = FramebufferCapture.MAX_DISK_MB * 1024 * 1024;
        while (totalBytes > maxBytes && files.length > 0) {
            const oldest = files.shift()!;
            totalBytes -= oldest.size;
            try { unlinkSync(join(dir, oldest.name)); } catch { /* ignore */ }
        }
    }
}
