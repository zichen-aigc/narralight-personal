import { API888_CHANNEL_ID, API888_PRICE_VERSION, API888_PROVIDER, api888Models } from "./provider-888api.mjs";

const LEGACY_CAPABILITIES = new Set(["image", "video", "text", "audio"]);
const safeText = (value, max = 180) => {
    if (typeof value !== "string") return "";
    const text = Array.from(value.trim()).slice(0, max).join("");
    try { encodeURIComponent(text); return text; } catch { return ""; }
};
const offeringIdFor = (connectionId, modelId) => `${encodeURIComponent(connectionId)}::${encodeURIComponent(modelId)}`;

// This is an intentionally non-executable projection of the old channel
// configuration. A browser-supplied capability or price never becomes a
// server-approved request contract merely by appearing in this catalog.
export function projectProviderCatalog(channels = []) {
    const connections = [];
    const offerings = [];
    const seenConnections = new Set();
    const seenOfferings = new Set();
    for (const channel of Array.isArray(channels) ? channels : []) {
        const connectionId = safeText(channel?.id, 100);
        if (!connectionId || connectionId === API888_CHANNEL_ID || channel?.provider === API888_PROVIDER || seenConnections.has(connectionId)) continue;
        seenConnections.add(connectionId);
        connections.push({ connectionId, displayName: safeText(channel?.name) || connectionId, provider: safeText(channel?.provider, 100) || "custom", apiFormat: safeText(channel?.apiFormat, 40), adapterStatus: "legacy_runtime", configurationSource: "legacy_ai_config" });
        for (const model of Array.isArray(channel?.models) ? channel.models : []) {
            const modelId = safeText(model?.name);
            const offeringId = offeringIdFor(connectionId, modelId);
            if (!modelId || seenOfferings.has(offeringId)) continue;
            seenOfferings.add(offeringId);
            offerings.push({ offeringId, connectionId, modelId, displayName: modelId, declaredCapability: LEGACY_CAPABILITIES.has(model?.capability) ? model.capability : null, operations: [], contractStatus: "legacy_unverified", availability: "legacy_runtime", publicPrice: null });
        }
    }
    connections.push({ connectionId: API888_CHANNEL_ID, displayName: "888API", provider: API888_PROVIDER, apiFormat: "openai", adapterStatus: "pilot_closed", configurationSource: "server_fixed" });
    for (const model of api888Models()) offerings.push({
        offeringId: offeringIdFor(API888_CHANNEL_ID, model.modelId),
        connectionId: API888_CHANNEL_ID,
        modelId: model.modelId,
        displayName: model.modelId,
        declaredCapability: model.kind,
        operations: model.operations,
        contractStatus: "public_docs_unverified",
        availability: "pilot_closed",
        publicPrice: { currency: "RMB", billingUnit: model.billingUnit, unitPriceMicrounits: model.unitPriceMicrormb, catalogVersion: model.priceVersion, source: model.priceSource, quality: "public_price_estimate" },
    });
    return { schemaVersion: 1, catalogVersion: `server-catalog-v1:${API888_PRICE_VERSION}`, executionAuthority: false, connections, offerings };
}
