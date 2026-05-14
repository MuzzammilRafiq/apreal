import { AuthStorage, ModelRegistry, SettingsManager } from '@earendil-works/pi-coding-agent';

async function run() {
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    const settingsManager = SettingsManager.create(process.cwd());

    console.log("--- 1) Default Agent Dir / Auth Path ---");
    // Try to find the storage path
    const homeDir = (authStorage as any).homeDir;
    console.log("AuthStorage Home:", homeDir || "N/A");

    console.log("\n--- 2) authStorage.list() ---");
    const authedProviders = authStorage.list();
    console.log("Authenticated Providers:", authedProviders);

    console.log("\n--- 3) modelRegistry.getAvailable() Count ---");
    const availableModels = [...modelRegistry.getAvailable()];
    console.log("Total Available Models:", availableModels.length);

    console.log("\n--- 4) Counts Grouped by Provider ---");
    const grouped: Record<string, string[]> = {};
    for (const m of availableModels) {
        if (!grouped[m.provider]) grouped[m.provider] = [];
        grouped[m.provider].push(m.id);
    }

    for (const [provider, ids] of Object.entries(grouped)) {
        console.log(`${provider}: ${ids.length} models (Examples: ${ids.slice(0, 3).join(", ")})`);
    }

    console.log("\n--- BuildProvidersPayload Logic ---");
    // session.ts logic
    const providers = Object.entries(grouped).map(([id, ids]) => ({
        id,
        models: ids.map(mid => ({ id: mid, name: mid })),
        isConfigured: authedProviders.includes(id)
    }));
    providers.sort((a, b) => a.id.localeCompare(b.id));

    console.log("Provider Counts (from mirrored logic):", providers.length);
    providers.forEach(p => {
        console.log(`- ${p.id}: ${p.models.length} models, configured: ${p.isConfigured}`);
    });
}

run().catch(console.error);
