import { APP_VERSION } from "@/constant/env";
import { acceptRuntimeIdentity, currentRuntimeIdentity } from "@/lib/runtime-version-guard";
import { probeBackendModelContracts } from "@/lib/backend-model-contract";
import { useRuntimeStore } from "@/stores/use-runtime-store";

/** Synthetic contract/amounts for unit tests only; never attests a real provider. */
export async function confirmSyntheticOfficialBackend() {
    acceptRuntimeIdentity({ appVersion: APP_VERSION, runtimeId: currentRuntimeIdentity()?.runtimeId || "synthetic-contract-runtime" });
    useRuntimeStore.setState({ status: "personal" });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
        new Response(
            JSON.stringify({
                status: "verified",
                sourceUrl: "https://apimart.ai/api/pricing/models/all",
                catalogVersion: "apimart-grok-official-live-synthetic",
                platformImageLimit: 30,
                editSourceRelayAvailable: true,
                capturedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 600000).toISOString(),
                models: {
                    "grok-imagine-video": { rates: { "480p": 1000, "720p": 2000 }, imageMicrousd: 100, videoMicrousd: 1000 },
                    "grok-imagine-video-1.5": { rates: { "480p": 1000, "720p": 2000, "1080p": 3000 }, imageMicrousd: 100, videoMicrousd: null },
                },
            }),
            { headers: { "content-type": "application/json" } },
        )) as typeof fetch;
    try {
        await probeBackendModelContracts();
    } finally {
        globalThis.fetch = original;
    }
}
