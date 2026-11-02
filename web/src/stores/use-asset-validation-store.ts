import { create } from "zustand";

import { isSharedEventOwner, SharedEventSource } from "@/lib/shared-event-source";
import { checkVolcAssets, classifyVolcAsset, getVolcAssetConfig, getVolcAssetRegistration, preflightVolcAssets, retryVolcAssetGenerationVisibility, submitVolcAssetReview, submitVolcAssetReviews, type VolcAssetBinding, type VolcAssetRegistration, type VolcAssetRemoteConfig, type VolcAssetValidationReference } from "@/services/volc-asset-validation";
import type { AiConfig } from "@/stores/use-config-store";

type AssetValidationStore = {
    bindings: Record<string, VolcAssetBinding>;
    registrations: Record<string, VolcAssetRegistration>;
    config: VolcAssetRemoteConfig;
    busy: Record<string, boolean>;
    loadConfig: () => Promise<VolcAssetRemoteConfig>;
    check: (references: VolcAssetValidationReference[]) => Promise<VolcAssetBinding[]>;
    refreshBatch: (references: VolcAssetValidationReference[]) => Promise<VolcAssetBinding[]>;
    classify: (reference: VolcAssetValidationReference, classification: "ordinary" | "real_person") => Promise<VolcAssetBinding>;
    submitReview: (reference: VolcAssetValidationReference) => Promise<VolcAssetRegistration>;
    submitBatchReview: (references: VolcAssetValidationReference[]) => ReturnType<typeof submitVolcAssetReviews>;
    refreshRegistration: (reference: VolcAssetValidationReference) => Promise<VolcAssetRegistration | null>;
    retryGenerationVisibility: (reference: VolcAssetValidationReference) => Promise<VolcAssetBinding>;
    preflight: (config: AiConfig, references: VolcAssetValidationReference[]) => ReturnType<typeof preflightVolcAssets>;
};

function mergeBindings(bindings: VolcAssetBinding[]) {
    useAssetValidationStore.setState((state) => ({ bindings: { ...state.bindings, ...Object.fromEntries(bindings.map((binding) => [binding.localRef, binding])) } }));
}

function setBusy(references: VolcAssetValidationReference[], busy: boolean) {
    useAssetValidationStore.setState((state) => ({ busy: { ...state.busy, ...Object.fromEntries(references.map((reference) => [reference.localRef, busy])) } }));
}

export const useAssetValidationStore = create<AssetValidationStore>(() => ({
    bindings: {},
    registrations: {},
    config: { credentialsConfigured: false, relayAvailable: false, remoteIntegrationEnabled: false, publicUrlRequired: false, projectName: "default" },
    busy: {},
    loadConfig: async () => {
        const config = await getVolcAssetConfig();
        useAssetValidationStore.setState({ config });
        return config;
    },
    check: async (references) => {
        if (!references.length) return [];
        setBusy(references, true);
        try {
            const result = await checkVolcAssets(references);
            mergeBindings(result.bindings);
            useAssetValidationStore.setState((state) => ({ registrations: { ...state.registrations, ...Object.fromEntries(result.registrations.map((registration) => [registration.localRef, registration])) }, config: { credentialsConfigured: result.credentialsConfigured, relayAvailable: result.relayAvailable, remoteIntegrationEnabled: result.remoteIntegrationEnabled, publicUrlRequired: false, projectName: result.projectName } }));
            return result.bindings;
        } finally {
            setBusy(references, false);
        }
    },
    refreshBatch: async (references) => {
        if (!references.length) return [];
        const result = await checkVolcAssets(references);
        mergeBindings(result.bindings);
        useAssetValidationStore.setState((state) => ({ registrations: { ...state.registrations, ...Object.fromEntries(result.registrations.map((registration) => [registration.localRef, registration])) }, config: { credentialsConfigured: result.credentialsConfigured, relayAvailable: result.relayAvailable, remoteIntegrationEnabled: result.remoteIntegrationEnabled, publicUrlRequired: false, projectName: result.projectName } }));
        return result.bindings;
    },
    classify: async (reference, classification) => {
        setBusy([reference], true);
        try {
            const result = await classifyVolcAsset(reference, classification);
            mergeBindings([result.binding]);
            useAssetValidationStore.setState((state) => ({ config: { ...state.config, credentialsConfigured: result.credentialsConfigured, relayAvailable: result.relayAvailable ?? state.config.relayAvailable, remoteIntegrationEnabled: result.remoteIntegrationEnabled, publicUrlRequired: false, projectName: result.projectName } }));
            return result.binding;
        } finally {
            setBusy([reference], false);
        }
    },
    submitReview: async (reference) => {
        setBusy([reference], true);
        try {
            const result = await submitVolcAssetReview(reference);
            useAssetValidationStore.setState((state) => ({ registrations: { ...state.registrations, [reference.localRef]: result.registration } }));
            return result.registration;
        } finally {
            setBusy([reference], false);
        }
    },
    submitBatchReview: async (references) => {
        if (!references.length) return { items: [] };
        setBusy(references, true);
        try {
            const result = await submitVolcAssetReviews(references);
            mergeBindings(result.items.flatMap((item) => item.binding ? [item.binding] : []));
            useAssetValidationStore.setState((state) => ({ registrations: { ...state.registrations, ...Object.fromEntries(result.items.flatMap((item) => item.registration ? [[item.localRef, item.registration]] : [])) } }));
            return result;
        } finally {
            setBusy(references, false);
        }
    },
    refreshRegistration: async (reference) => {
        const result = await getVolcAssetRegistration(reference.localRef);
        if (!result) return null;
        useAssetValidationStore.setState((state) => ({ registrations: { ...state.registrations, [reference.localRef]: result.registration }, ...(result.remoteIntegrationEnabled === undefined ? {} : { config: { ...state.config, remoteIntegrationEnabled: result.remoteIntegrationEnabled } }) }));
        if (result.binding) mergeBindings([result.binding]);
        return result.registration;
    },
    retryGenerationVisibility: async (reference) => {
        setBusy([reference], true);
        try {
            const result = await retryVolcAssetGenerationVisibility(reference.localRef);
            mergeBindings([result.binding]);
            return result.binding;
        } finally {
            setBusy([reference], false);
        }
    },
    preflight: async (config, references) => {
        const result = await preflightVolcAssets(config, references);
        mergeBindings(result.bindings);
        return result;
    },
}));

let eventSource: SharedEventSource | null = null;

export function startAssetValidationSync() {
    if (eventSource || typeof window === "undefined") return () => undefined;
    eventSource = new SharedEventSource("/api/local/events", { eventTypes: ["volc-asset-validation"] });
    eventSource.addEventListener("open", (event) => {
        if (!isSharedEventOwner(event)) return;
        const references = Object.values(useAssetValidationStore.getState().bindings).map(({ localRef, projectId, mediaKind }) => ({ localRef, projectId, mediaKind }));
        if (!references.length) return;
        void checkVolcAssets(references).then((result) => {
            mergeBindings(result.bindings);
            useAssetValidationStore.setState((state) => ({ registrations: { ...state.registrations, ...Object.fromEntries(result.registrations.map((registration) => [registration.localRef, registration])) }, config: { credentialsConfigured: result.credentialsConfigured, relayAvailable: result.relayAvailable, remoteIntegrationEnabled: result.remoteIntegrationEnabled, publicUrlRequired: false, projectName: result.projectName } }));
        }).catch(() => undefined);
    });
    eventSource.addEventListener("volc-asset-validation", (event) => {
        try {
            const payload = JSON.parse((event as MessageEvent).data) as { binding?: VolcAssetBinding; registration?: VolcAssetRegistration };
            const binding = payload.binding;
            if (binding) mergeBindings([binding]);
            if (payload.registration) useAssetValidationStore.setState((state) => ({ registrations: { ...state.registrations, [payload.registration!.localRef]: payload.registration! } }));
        } catch {}
    });
    return () => undefined;
}
