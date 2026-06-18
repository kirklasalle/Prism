import { LlmProviderManager } from "./src/core/operator/llm-provider-manager.js";
import { ChatSessionStore } from "./src/core/operator/chat-session-store.js";
import { workspaceDbPath } from "./src/core/config/workspace-resolver.js";

async function main() {
    const dbPath = workspaceDbPath();
    const chatStore = new ChatSessionStore(dbPath);
    const settings = chatStore.listProviderSettings();
    const manager = new LlmProviderManager(process.env, settings);
    const catalog = await manager.getCatalog({ providerId: "google", model: null });
    console.log("Active Provider:", catalog.activeProviderId);
    console.log("Active Model:", catalog.activeModel);
    const google = catalog.providers.find(p => p.id === "google");
    if (google) {
        console.log("Google Provider Details:");
        console.log("  Enabled:", google.enabled);
        console.log("  Default Model:", google.defaultModel);
        console.log("  Models Count:", google.models.length);
        console.log("  Models (First 5):", google.models.slice(0, 5));
        console.log("  Includes Default Model:", google.models.includes(google.defaultModel || ""));
    }
}
main().catch(console.error);
