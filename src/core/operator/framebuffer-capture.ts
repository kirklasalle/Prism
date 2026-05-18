/**
 * Framebuffer Capture Engine — World-class multi-monitor screen capture for agentic vision.
 *
 * Captures all monitors stitched left-to-right using PowerShell + C# System.Drawing interop.
 * DPI-aware for mixed-resolution multi-monitor setups.
 * Supports single-frame capture and burst capture (8-12 FPS) via a single PowerShell invocation.
 * Sharp is optional — falls back to raw PNG if unavailable.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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
$ErrorActionPreference = "Stop"
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
    $minX = [int](($screens | ForEach-Object { $_.Bounds.X } | Measure-Object -Minimum).Minimum)
    $minY = [int](($screens | ForEach-Object { $_.Bounds.Y } | Measure-Object -Minimum).Minimum)
    $maxRight = [int](($screens | ForEach-Object { $_.Bounds.X + $_.Bounds.Width } | Measure-Object -Maximum).Maximum)
    $maxBottom = [int](($screens | ForEach-Object { $_.Bounds.Y + $_.Bounds.Height } | Measure-Object -Maximum).Maximum)
    $totalW = [int]($maxRight - $minX)
    $totalH = [int]($maxBottom - $minY)
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
    kind: "single" | "burst_frame";
    burstId: string | null;
    burstFrameIndex: number | null;
}

export interface ScreengrabGalleryItem {
    kind: "single" | "burst";
    name: string;
    previewName: string;
    size: number;
    mtime: string;
    burstId: string | null;
    frameCount: number;
    sourceFiles: string[];
    playbackFps: number;
    durationSec: number;
}

interface BurstCaptureMetadata {
    burstId: string;
    fps: number;
    durationSec: number;
    files: string[];
    createdAt: string;
}

function classifyScreengrab(name: string): Pick<ScreengrabFile, "kind" | "burstId" | "burstFrameIndex"> {
    const burstMatch = /^burst-(\d{8}-\d{6})-(\d{4})\.png$/i.exec(name);
    if (burstMatch) {
        return {
            kind: "burst_frame",
            burstId: burstMatch[1],
            burstFrameIndex: Number.parseInt(burstMatch[2], 10),
        };
    }

    return {
        kind: "single",
        burstId: null,
        burstFrameIndex: null,
    };
}

function burstMetadataFileName(burstId: string): string {
    return `burst-${burstId}.json`;
}

function readBurstMetadata(dir: string): Map<string, BurstCaptureMetadata> {
    const metadata = new Map<string, BurstCaptureMetadata>();
    const files = readdirSync(dir).filter(name => /^burst-\d{8}-\d{6}\.json$/i.test(name));
    for (const fileName of files) {
        try {
            const fullPath = join(dir, fileName);
            const parsed = JSON.parse(readFileSync(fullPath, "utf-8")) as Partial<BurstCaptureMetadata>;
            if (!parsed || typeof parsed.burstId !== "string" || !Array.isArray(parsed.files)) continue;
            metadata.set(parsed.burstId, {
                burstId: parsed.burstId,
                fps: typeof parsed.fps === "number" && parsed.fps > 0 ? parsed.fps : 8,
                durationSec: typeof parsed.durationSec === "number" && parsed.durationSec > 0 ? parsed.durationSec : Math.max(1, parsed.files.length / 8),
                files: parsed.files.filter((entry): entry is string => typeof entry === "string"),
                createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
            });
        } catch {
            // Ignore malformed sidecar metadata and fall back to filename-derived grouping.
        }
    }
    return metadata;
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
     * Get the framebuffer directory path.
     */
    getFramebufferDirectory(): string {
        return workspaceFramebufferDir();
    }

    /**
     * Read screengrab files with burst classification metadata.
     */
    private scanScreengrabs(): ScreengrabFile[] {
        const dir = workspaceFramebufferDir();
        if (!existsSync(dir)) return [];

        return readdirSync(dir)
            .filter(f => f.endsWith(".png") && f !== "latest.png")
            .map(name => {
                const st = statSync(join(dir, name));
                return {
                    name,
                    size: st.size,
                    mtime: st.mtime.toISOString(),
                    ...classifyScreengrab(name),
                };
            })
            .sort((a, b) => b.mtime.localeCompare(a.mtime));
    }

    /**
     * Capture all monitors into a single PNG buffer.
     *
     * Cross-platform: PowerShell + System.Drawing on Win32, `scrot`/`grim`
     * on Linux (X11/Wayland respectively), `screencapture` on macOS. Raises
     * a clear error when no supported tool is available so callers can show
     * a precise advisory.
     */
    async captureAllMonitors(): Promise<Buffer> {
        if (process.platform === "linux") return this.captureLinux();
        if (process.platform === "darwin") return this.captureDarwin();
        const dir = this.ensureDir();
        const script = captureScript(dir, 1, 0);
        const { stdout, stderr } = await execFileAsync("powershell.exe", [
            "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script,
        ], { timeout: 15_000, maxBuffer: 50 * 1024 * 1024 });
        const base64 = stdout.trim();
        if (!base64) {
            const detail = stderr.trim();
            throw new Error(detail ? `PowerShell returned no image data: ${detail}` : "PowerShell returned no image data");
        }
        return Buffer.from(base64, "base64");
    }

    /** Linux capture — prefer Wayland's `grim`, fall back to X11's `scrot`. */
    private async captureLinux(): Promise<Buffer> {
        const tmp = join(this.ensureDir(), `_tmp-${process.pid}-${Date.now()}.png`);
        const isWayland = Boolean(process.env.WAYLAND_DISPLAY);
        const tools = isWayland ? ["grim", "scrot"] : ["scrot", "grim"];
        let lastErr: unknown;
        for (const tool of tools) {
            try {
                if (tool === "grim") {
                    await execFileAsync("grim", [tmp], { timeout: 15_000 });
                } else {
                    // scrot needs an existing DISPLAY; -o overwrites if needed.
                    await execFileAsync("scrot", ["-o", tmp], { timeout: 15_000 });
                }
                const buf = readFileSync(tmp);
                try { unlinkSync(tmp); } catch { /* best effort */ }
                return buf;
            } catch (err) {
                lastErr = err;
            }
        }
        throw new Error(`Linux framebuffer capture failed: install grim (Wayland) or scrot (X11). Last error: ${String(lastErr)}`);
    }

    /** macOS capture — built-in `screencapture` covers all displays merged. */
    private async captureDarwin(): Promise<Buffer> {
        const tmp = join(this.ensureDir(), `_tmp-${process.pid}-${Date.now()}.png`);
        // -x = silent (no shutter sound), -t png = PNG, -C captures cursor
        await execFileAsync("/usr/sbin/screencapture", ["-x", "-t", "png", tmp], { timeout: 15_000 });
        const buf = readFileSync(tmp);
        try { unlinkSync(tmp); } catch { /* best effort */ }
        return buf;
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
        const { stdout, stderr } = await execFileAsync("powershell.exe", [
            "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script,
        ], { timeout: (durationSec + 10) * 1000, maxBuffer: 10 * 1024 * 1024 });

        const files = stdout.trim().split(/\r?\n/).filter(Boolean);
        if (files.length === 0) {
            const detail = stderr.trim();
            throw new Error(detail ? `PowerShell returned no burst frames: ${detail}` : "PowerShell returned no burst frames");
        }

        const firstBurst = classifyScreengrab(files[0]);
        if (firstBurst.burstId) {
            const metadata: BurstCaptureMetadata = {
                burstId: firstBurst.burstId,
                fps,
                durationSec,
                files,
                createdAt: new Date().toISOString(),
            };
            writeFileSync(join(dir, burstMetadataFileName(firstBurst.burstId)), JSON.stringify(metadata, null, 2) + "\n", "utf-8");
        }

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
        return this.scanScreengrabs().slice(0, limit);
    }

    /**
     * List gallery-ready items, collapsing burst frames into a single representative tile.
     */
    listGalleryItems(limit = 20): ScreengrabGalleryItem[] {
        const files = this.scanScreengrabs();
        const dir = workspaceFramebufferDir();
        const burstMetadata = existsSync(dir) ? readBurstMetadata(dir) : new Map<string, BurstCaptureMetadata>();
        const items: ScreengrabGalleryItem[] = [];
        const burstItems = new Map<string, ScreengrabGalleryItem>();

        for (const file of files) {
            if (file.kind === "single" || !file.burstId) {
                items.push({
                    kind: "single",
                    name: file.name,
                    previewName: file.name,
                    size: file.size,
                    mtime: file.mtime,
                    burstId: null,
                    frameCount: 1,
                    sourceFiles: [file.name],
                    playbackFps: 1,
                    durationSec: 0,
                });
                continue;
            }

            let burstItem = burstItems.get(file.burstId);
            if (!burstItem) {
                const metadata = burstMetadata.get(file.burstId);
                burstItem = {
                    kind: "burst",
                    name: file.name,
                    previewName: file.name,
                    size: file.size,
                    mtime: file.mtime,
                    burstId: file.burstId,
                    frameCount: 0,
                    sourceFiles: metadata?.files ? [...metadata.files] : [],
                    playbackFps: metadata?.fps ?? 8,
                    durationSec: metadata?.durationSec ?? 0,
                };
                burstItems.set(file.burstId, burstItem);
                items.push(burstItem);
            }

            burstItem.frameCount += 1;
            if ((file.burstFrameIndex ?? 0) > (classifyScreengrab(burstItem.previewName).burstFrameIndex ?? 0)) {
                burstItem.name = file.name;
                burstItem.previewName = file.name;
                burstItem.size = file.size;
                burstItem.mtime = file.mtime;
            }
            if (!burstMetadata.has(file.burstId) && !burstItem.sourceFiles.includes(file.name)) {
                burstItem.sourceFiles.push(file.name);
            }
        }

        for (const burstItem of burstItems.values()) {
            if (burstItem.burstId && (!burstMetadata.has(burstItem.burstId) || burstItem.sourceFiles.length === 0)) {
                burstItem.sourceFiles = files
                    .filter(file => file.burstId === burstItem.burstId)
                    .sort((a, b) => (a.burstFrameIndex ?? 0) - (b.burstFrameIndex ?? 0))
                    .map(file => file.name);
            }
            if (burstItem.durationSec <= 0) {
                burstItem.durationSec = burstItem.frameCount / Math.max(1, burstItem.playbackFps);
            }
        }

        return items.slice(0, limit);
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

        const remainingBurstIds = new Set(
            readdirSync(dir)
                .filter(f => f.endsWith(".png") && f !== "latest.png")
                .map(name => classifyScreengrab(name).burstId)
                .filter((burstId): burstId is string => !!burstId),
        );
        const metadataFiles = readdirSync(dir).filter(name => /^burst-\d{8}-\d{6}\.json$/i.test(name));
        for (const metadataFile of metadataFiles) {
            const match = /^burst-(\d{8}-\d{6})\.json$/i.exec(metadataFile);
            if (!match || remainingBurstIds.has(match[1])) continue;
            try { unlinkSync(join(dir, metadataFile)); } catch { /* ignore */ }
        }
    }
}
