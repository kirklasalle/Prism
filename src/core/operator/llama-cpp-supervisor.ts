import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { join, dirname, basename } from "node:path";
import { existsSync, readdirSync } from "node:fs";

export interface LlamaModelSlot {
    id: number;
    port: number;
    modelAlias: string | null;
    modelPath: string | null;
    pid: number | null;
    status: "empty" | "loading" | "ready" | "error";
    lastActive: number;
    error?: string;
    /** Path to a smaller draft model for speculative decoding. */
    draftModelPath: string | null;
    /** Max tokens the draft model proposes per step (default 16). */
    draftMax: number;
    /** Min draft tokens to use (default 5). */
    draftMin: number;
    /** Min probability threshold for speculation (default 0.9). */
    draftPMin: number;
    /** Number of GPU layers to offload (-1 = all). null = auto. */
    gpuLayers: number | null;
    /** Enable flash attention for reduced memory usage. */
    flashAttn: boolean;
    /** Active context size for this slot. */
    contextSize: number;
}

export interface LlamaSupervisorConfig {
    /** The path for `llama-server`. Defaults to `"llama-server"`. */
    binaryPath: string;
    /** Base port to start assigning from. Default 8081. */
    basePort: number;
    /** Maximum number of parallel models. Default 5. */
    maxSlots: number;
    /** Default context size (num_ctx). Default 4096. */
    defaultContext: number;
    /** Optional directory to scan for local .gguf model files. */
    modelsDir?: string;
}

export interface LlamaLoadOptions {
    ctxSize?: number;
    draftModelPath?: string;
    draftMax?: number;
    draftMin?: number;
    draftPMin?: number;
    gpuLayers?: number;
    flashAttn?: boolean;
}

/**
 * Manages an array of local `llama-server` processes.
 * Ensures up to `maxSlots` models can be loaded. Applies LRU eviction
 * when slots are full. Acts as the mechanical base for Prism's local multi-model capabilities.
 *
 * Supports speculative decoding via draft models, GPU offloading,
 * flash attention, and native tool calling (--jinja).
 */
export class LlamaCppSupervisor extends EventEmitter {
    private readonly slots: LlamaModelSlot[] = [];
    private readonly processes = new Map<number, ChildProcess>();

    constructor(private readonly config: LlamaSupervisorConfig) {
        super();
        for (let i = 0; i < this.config.maxSlots; i++) {
            this.slots.push({
                id: i,
                port: this.config.basePort + i,
                modelAlias: null,
                modelPath: null,
                pid: null,
                status: "empty",
                lastActive: 0,
                draftModelPath: null,
                draftMax: 16,
                draftMin: 5,
                draftPMin: 0.9,
                gpuLayers: null,
                flashAttn: false,
                contextSize: this.config.defaultContext,
            });
        }
    }

    /** Returns the current supervisor configuration. */
    public getConfig(): LlamaSupervisorConfig {
        return { ...this.config };
    }

    public getSnapshot(): LlamaModelSlot[] {
        return this.slots.map(s => ({ ...s }));
    }

    /**
     * Scans the configured `modelsDir` for `.gguf` files, excluding
     * companion projectors (`mmproj-*`). Returns model alias names
     * (filename without `.gguf` extension).
     */
    public discoverLocalModels(): string[] {
        if (!this.config.modelsDir || !existsSync(this.config.modelsDir)) return [];
        try {
            return readdirSync(this.config.modelsDir)
                .filter(f => f.endsWith(".gguf") && !f.toLowerCase().startsWith("mmproj-"))
                .map(f => f.replace(/\.gguf$/i, ""));
        } catch {
            return [];
        }
    }

    /**
     * Maps a model alias back to the full file path in `modelsDir`.
     * Returns null if the file does not exist or no modelsDir is configured.
     */
    public getModelPath(alias: string): string | null {
        if (!this.config.modelsDir) return null;
        const fullPath = join(this.config.modelsDir, alias + ".gguf");
        return existsSync(fullPath) ? fullPath : null;
    }

    /** Returns the port of the running model, or null if not loaded. */
    public getPortForAlias(modelAlias: string): number | null {
        const slot = this.slots.find(s => s.modelAlias === modelAlias && s.status === "ready");
        if (slot) {
            slot.lastActive = Date.now();
            return slot.port;
        }
        return null;
    }

    /** Instructs the supervisor to load a model. Sweeps an LRU slot if full. */
    public async loadModel(modelPath: string, modelAlias: string, ctxSizeOrOpts?: number | LlamaLoadOptions): Promise<LlamaModelSlot> {
        // Normalize options
        const opts: LlamaLoadOptions = typeof ctxSizeOrOpts === "number"
            ? { ctxSize: ctxSizeOrOpts }
            : ctxSizeOrOpts ?? {};

        // 1. Is it already loaded?
        let slot = this.slots.find(s => s.modelAlias === modelAlias || s.modelPath === modelPath);
        if (slot) {
            // Might be loading or ready
            slot.lastActive = Date.now();
            return slot;
        }

        // 2. Find an empty slot
        slot = this.slots.find(s => s.status === "empty" || s.status === "error");

        // 3. Fallback to LRU Eviction
        if (!slot) {
            const evictable = [...this.slots].sort((a, b) => a.lastActive - b.lastActive);
            slot = evictable[0]!;
            await this.unloadSlot(slot.id);
        }

        // 4. Configure slot
        const ctxSize = opts.ctxSize ?? this.config.defaultContext;
        slot.modelAlias = modelAlias;
        slot.modelPath = modelPath;
        slot.status = "loading";
        slot.lastActive = Date.now();
        slot.error = undefined;
        slot.draftModelPath = opts.draftModelPath ?? null;
        slot.draftMax = opts.draftMax ?? 16;
        slot.draftMin = opts.draftMin ?? 5;
        slot.draftPMin = opts.draftPMin ?? 0.9;
        slot.gpuLayers = opts.gpuLayers ?? null;
        slot.flashAttn = opts.flashAttn ?? false;
        slot.contextSize = ctxSize;
        this.emit("slot_updated", slot);

        try {
            await this.spawnProcess(slot, ctxSize);
            slot.status = "ready";
            this.emit("slot_updated", slot);
        } catch (error) {
            slot.status = "error";
            slot.error = String(error);
            this.emit("slot_updated", slot);
        }

        return slot;
    }

    public async unloadModel(modelAlias: string): Promise<boolean> {
        const slot = this.slots.find(s => s.modelAlias === modelAlias);
        if (!slot) return false;
        return this.unloadSlot(slot.id);
    }

    private async unloadSlot(slotId: number): Promise<boolean> {
        const slot = this.slots.find(s => s.id === slotId);
        if (!slot) return false;

        const proc = this.processes.get(slot.id);
        if (proc) {
            proc.kill("SIGTERM");
            this.processes.delete(slot.id);
        }

        slot.status = "empty";
        slot.modelAlias = null;
        slot.modelPath = null;
        slot.pid = null;
        slot.error = undefined;
        slot.draftModelPath = null;
        slot.gpuLayers = null;
        slot.flashAttn = false;
        slot.contextSize = this.config.defaultContext;
        this.emit("slot_updated", slot);
        return true;
    }

    private spawnProcess(slot: LlamaModelSlot, ctxSize: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const args = [
                "--model", slot.modelPath!,
                "--alias", slot.modelAlias!,
                "--port", String(slot.port),
                "--ctx-size", String(ctxSize),
                // Always enable native tool calling (Jinja templates)
                "--jinja",
            ];

            // Multimodal Vision support
            if (slot.modelPath!.toLowerCase().includes("vl")) {
                const modelDir = dirname(slot.modelPath!);
                const mmprojPath = join(modelDir, "mmproj-model-f16.gguf");
                if (existsSync(mmprojPath)) {
                    args.push("--mmproj", mmprojPath);
                }
            }

            // Speculative decoding: draft model
            if (slot.draftModelPath) {
                args.push("--model-draft", slot.draftModelPath);
                args.push("--draft-max", String(slot.draftMax));
                args.push("--draft-min", String(slot.draftMin));
                args.push("--draft-p-min", String(slot.draftPMin));
            }

            // GPU offloading
            if (slot.gpuLayers !== null) {
                args.push("--n-gpu-layers", String(slot.gpuLayers));
            }

            // Flash attention for memory efficiency
            if (slot.flashAttn) {
                args.push("--flash-attn");
            }

            const proc = spawn(this.config.binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
            this.processes.set(slot.id, proc);
            slot.pid = proc.pid ?? null;

            let isReady = false;
            let capturedError = "";

            proc.stdout?.on("data", (data: Buffer) => {
                const text = data.toString();
                if (!isReady && text.includes("HTTP server listening")) {
                    isReady = true;
                    resolve();
                }
            });

            proc.stderr?.on("data", (data: Buffer) => {
                const text = data.toString();
                if (!isReady && text.toLowerCase().includes("error")) {
                    capturedError += text;
                }
                if (!isReady && text.includes("HTTP server listening")) {
                    isReady = true;
                    resolve();
                }
            });

            proc.on("error", (err) => {
                if (!isReady) {
                    reject(new Error(`Failed to start llama-server: ${err.message}`));
                } else {
                    slot.status = "error";
                    slot.error = err.message;
                    this.emit("slot_updated", slot);
                }
            });

            proc.on("exit", (code) => {
                this.processes.delete(slot.id);
                if (!isReady) {
                    reject(new Error(`llama-server exited prematurely with code ${code}. Error logs: ${capturedError}`));
                } else if (slot.status !== "empty") { // Not an intentional unload
                    slot.status = "error";
                    slot.error = `Process crashed with exit code ${code}. Logs: ${capturedError}`;
                    slot.pid = null;
                    this.emit("slot_updated", slot);
                }
            });

            // Timeout logic — 90s for large models with draft model loading
            setTimeout(() => {
                if (!isReady) {
                    proc.kill("SIGKILL");
                    reject(new Error("Timeout waiting for llama-server to report ready. Is the model valid and port free?"));
                }
            }, 90000);
        });
    }

    /** Clean shutdown all managed instances */
    public shutdownAll(): void {
        for (const [_, proc] of this.processes.entries()) {
            if (!proc.killed) {
                proc.kill("SIGKILL");
            }
        }
        this.processes.clear();
    }
}
