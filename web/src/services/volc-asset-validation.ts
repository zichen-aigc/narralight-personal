import { modelOptionName, resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { throwApiError } from "@/services/api-error";

export type VolcAssetClassification = "unclassified" | "ordinary" | "real_person" | "volc_preset_avatar" | "volc_trusted_output";
export type VolcAssetValidationStatus = "unverified" | "not_required" | "credentials_missing" | "integration_pending" | "pending_asset" | "processing" | "active" | "failed" | "expired" | "project_mismatch";
export type VolcAssetMediaKind = "image" | "video" | "audio";
export type VolcAssetGenerationStatus = "unverified" | "not_required" | "verified" | "inaccessible";
export type VolcAssetStatusTone = "success" | "error" | "processing" | "warning" | "default";
export type VolcAssetRegistrationStatus = "relay_queued" | "relay_starting" | "submitting" | "submission_unknown" | "reconciling" | "accelerating" | "processing" | "delayed" | "active" | "failed";
export const VOLC_ASSET_RUNNING_REGISTRATION_STATUSES: readonly VolcAssetRegistrationStatus[] = ["relay_queued", "relay_starting", "submitting", "submission_unknown", "reconciling", "accelerating", "processing", "delayed"];

export type VolcAssetValidationReference = {
    localRef: string;
    projectId?: string;
    mediaKind: VolcAssetMediaKind;
    title?: string;
    previewUrl?: string;
};

export type VolcAssetBinding = {
    localRef: string;
    projectId?: string;
    mediaKind: VolcAssetMediaKind;
    classification: VolcAssetClassification;
    status: VolcAssetValidationStatus;
    provider: "volcengine-ark";
    assetId?: string;
    fileId?: string;
    mimeType?: string;
    sourceHash?: string;
    errorCode?: string;
    errorMessage?: string;
    checkedAt?: string;
    expiresAt?: string;
    generationStatus: VolcAssetGenerationStatus;
    generationChannelId?: string;
    generationErrorCode?: string;
    generationErrorMessage?: string;
    generationProviderHttpStatus?: number;
    generationProviderErrorCode?: string;
    generationProviderErrorMessage?: string;
    generationProviderRequestId?: string;
    generationCheckedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type VolcAssetRegistration = {
    localRef: string;
    projectName: string;
    mediaKind: VolcAssetMediaKind;
    status: VolcAssetRegistrationStatus;
    assetId?: string;
    fileId?: string;
    pollAttemptCount: number;
    nextPollAt?: string;
    delayedAt?: string;
    providerHttpStatus?: number;
    errorCode?: string;
    errorMessage?: string;
    providerErrorCode?: string;
    providerErrorMessage?: string;
    providerRequestId?: string;
    generationWaiting?: number;
    submissionCount?: number;
    attempts?: Array<{ attemptId: string; ordinal: number; status: string; assetId?: string; providerHttpStatus?: number; providerErrorCode?: string; providerErrorMessage?: string; providerRequestId?: string; submittedAt: string; updatedAt: string }>;
    createdAt: string;
    updatedAt: string;
};

export type VolcAssetBatchReviewItem = {
    localRef: string;
    binding?: VolcAssetBinding;
    registration?: VolcAssetRegistration;
    created?: boolean;
    skipped?: boolean;
    error?: string;
    code?: string;
    httpStatus?: number;
    requestId?: string;
};

export type VolcAssetRemoteConfig = {
    credentialsConfigured: boolean;
    relayAvailable: boolean;
    remoteIntegrationEnabled: boolean;
    publicUrlRequired: boolean;
    projectName: string;
};

export type VolcAssetPreflight = {
    required: boolean;
    allowed: boolean;
    visibilityProbeRequired?: boolean;
    channelId?: string;
    credentialsConfigured: boolean;
    remoteIntegrationEnabled: boolean;
    bindings: VolcAssetBinding[];
    blockers: Array<Pick<VolcAssetBinding, "localRef" | "status" | "classification" | "errorCode" | "errorMessage" | "generationStatus" | "generationChannelId">>;
};

const jsonHeaders = { "content-type": "application/json" };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) await throwApiError(response, "火山素材服务请求失败");
    return (await response.json()) as T;
}

export function assetValidationRef(input: { storageKey?: string; assetId?: string; projectId?: string; nodeId?: string }) {
    if (input.storageKey) return `storage:${input.storageKey}`;
    if (input.assetId) return `asset:${input.assetId}`;
    return `node:${input.projectId || "local"}:${input.nodeId || "unknown"}`;
}

export function dedupeVolcAssetReferences(references: VolcAssetValidationReference[]) {
    const seen = new Set<string>();
    return references.filter((reference) => {
        if (seen.has(reference.localRef)) return false;
        seen.add(reference.localRef);
        return true;
    });
}

export function isVolcAssetBindingAllowed(binding?: Pick<VolcAssetBinding, "status" | "generationStatus">) {
    return binding?.status === "not_required" || (binding?.status === "active" && binding.generationStatus !== "inaccessible");
}

export function volcAssetBatchSubmissionReferences(
    references: VolcAssetValidationReference[],
    bindings: readonly Pick<VolcAssetBinding, "localRef" | "classification" | "status">[],
    registrations: Record<string, Pick<VolcAssetRegistration, "projectName"> | undefined>,
    projectName: string,
) {
    const bindingsByRef = new Map(bindings.map((binding) => [binding.localRef, binding]));
    return dedupeVolcAssetReferences(references).filter((reference) => {
        const registrationProject = registrations[reference.localRef]?.projectName;
        if (registrationProject !== undefined && registrationProject !== projectName) return false;
        const binding = bindingsByRef.get(reference.localRef);
        return binding?.classification !== "ordinary" && !["pending_asset", "processing", "active", "not_required"].includes(binding?.status || "unverified");
    });
}

export function isVolcAssetRegistrationRunning(status?: VolcAssetRegistrationStatus) {
    return Boolean(status && VOLC_ASSET_RUNNING_REGISTRATION_STATUSES.includes(status));
}

export function volcAssetRegistrationProgress(registration?: Pick<VolcAssetRegistration, "status">, binding?: Pick<VolcAssetBinding, "status">) {
    if (["not_required", "active", "failed", "expired", "project_mismatch"].includes(binding?.status || "")) return 100;
    switch (registration?.status) {
        case "relay_queued": return 10;
        case "relay_starting": return 30;
        case "submitting": return 50;
        case "submission_unknown":
        case "reconciling": return 60;
        case "accelerating": return 70;
        case "processing": return 82;
        case "delayed": return 88;
        case "active":
        case "failed": return 100;
        default: return 0;
    }
}

export function volcAssetRegistrationDiagnostic(registration?: Pick<VolcAssetRegistration, "providerHttpStatus" | "errorCode" | "errorMessage" | "providerErrorCode" | "providerErrorMessage" | "providerRequestId">) {
    if (!registration) return "";
    return diagnosticSummary(registration.providerHttpStatus, joinedDiagnosticCode(registration.errorCode, registration.providerErrorCode), joinedDiagnosticMessage(registration.errorMessage, registration.providerErrorMessage), registration.providerRequestId);
}

export function volcAssetBindingDiagnostic(binding?: Pick<VolcAssetBinding, "errorCode" | "errorMessage" | "generationErrorCode" | "generationErrorMessage" | "generationProviderHttpStatus" | "generationProviderErrorCode" | "generationProviderErrorMessage" | "generationProviderRequestId">) {
    if (!binding) return "";
    const generationFailure = Boolean(binding.generationErrorCode || binding.generationErrorMessage || binding.generationProviderErrorCode);
    return diagnosticSummary(generationFailure ? binding.generationProviderHttpStatus : undefined, generationFailure ? joinedDiagnosticCode(binding.generationErrorCode, binding.generationProviderErrorCode) : binding.errorCode, generationFailure ? joinedDiagnosticMessage(binding.generationErrorMessage, binding.generationProviderErrorMessage) : binding.errorMessage, generationFailure ? binding.generationProviderRequestId : undefined);
}

export function volcAssetVisibleDiagnostic(registration?: Pick<VolcAssetRegistration, "status" | "providerHttpStatus" | "errorCode" | "errorMessage" | "providerErrorCode" | "providerErrorMessage" | "providerRequestId">, binding?: Pick<VolcAssetBinding, "status" | "generationStatus" | "errorCode" | "errorMessage" | "generationErrorCode" | "generationErrorMessage" | "generationProviderHttpStatus" | "generationProviderErrorCode" | "generationProviderErrorMessage" | "generationProviderRequestId">) {
    const registrationDiagnostic = volcAssetRegistrationDiagnostic(registration);
    const bindingDiagnostic = volcAssetBindingDiagnostic(binding);
    if (binding?.generationStatus === "inaccessible" || binding?.generationErrorCode || binding?.generationErrorMessage || binding?.generationProviderErrorCode || binding?.generationProviderErrorMessage) return bindingDiagnostic || registrationDiagnostic;
    if (registration?.status === "failed" || registration?.errorCode || registration?.errorMessage || registration?.providerErrorCode || registration?.providerErrorMessage) return registrationDiagnostic || bindingDiagnostic;
    if (binding?.status === "failed" || binding?.errorCode || binding?.errorMessage) return bindingDiagnostic || registrationDiagnostic;
    return isVolcAssetRegistrationRunning(registration?.status) ? registrationDiagnostic : "";
}

export function volcAssetBatchItemDiagnostic(item?: Pick<VolcAssetBatchReviewItem, "httpStatus" | "code" | "error" | "requestId">) {
    if (!item) return "";
    return diagnosticSummary(item.httpStatus, item.code, item.error, item.requestId);
}

function diagnosticSummary(httpStatus?: number, code?: string, message?: string, requestId?: string) {
    const parts = [httpStatus ? `HTTP ${httpStatus}` : "", code || "", message || "", requestId ? `Request ID ${requestId}` : ""].filter(Boolean);
    return [...new Set(parts)].join("｜");
}

function joinedDiagnosticCode(localCode?: string, providerCode?: string) {
    return [...new Set([localCode, providerCode].filter(Boolean))].join(" / ");
}

function joinedDiagnosticMessage(localMessage?: string, providerMessage?: string) {
    return [...new Set([localMessage, providerMessage].filter(Boolean))].join("；");
}

export function resolveVolcAssetReferenceUrl(originalUrl: string, localRef: string, bindings: readonly Pick<VolcAssetBinding, "localRef" | "status" | "assetId">[]) {
    const binding = bindings.find((item) => item.localRef === localRef);
    return binding?.status === "active" && binding.assetId ? `asset://${binding.assetId}` : originalUrl;
}

export function volcAssetStatusTone(status: VolcAssetValidationStatus): VolcAssetStatusTone {
    if (status === "active" || status === "not_required") return "success";
    if (status === "failed" || status === "expired" || status === "project_mismatch") return "error";
    if (status === "processing" || status === "pending_asset" || status === "integration_pending") return "processing";
    if (status === "credentials_missing") return "warning";
    return "default";
}

export function volcAssetGenerationStatusTone(status: VolcAssetGenerationStatus): VolcAssetStatusTone {
    if (status === "verified" || status === "not_required") return "success";
    if (status === "inaccessible") return "error";
    return "warning";
}

export function volcAssetGateConfig(config: AiConfig) {
    const selected = config.videoModel || config.model;
    const request = resolveModelRequestConfig(config, selected);
    const channel = resolveModelChannel(config, selected);
    const model = modelOptionName(request.model || selected);
    const required = request.provider === "volcengine-ark" && (model.includes("seedance-2-0") || model.includes("seedance-2-5"));
    return { provider: request.provider, model, channelId: channel.id, required };
}

export async function classifyVolcAsset(reference: VolcAssetValidationReference, classification: "ordinary" | "real_person") {
    return requestJson<{ binding: VolcAssetBinding; credentialsConfigured: boolean; relayAvailable: boolean; remoteIntegrationEnabled: boolean; projectName: string }>(`/api/local/volc-assets/bindings/${encodeURIComponent(reference.localRef)}`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ projectId: reference.projectId, mediaKind: reference.mediaKind, classification }),
    });
}

export function getVolcAssetConfig() {
    return requestJson<VolcAssetRemoteConfig>("/api/local/volc-assets/config");
}

export function submitVolcAssetReview(reference: VolcAssetValidationReference) {
    return requestJson<{ registration: VolcAssetRegistration; created: boolean }>("/api/local/volc-assets/registrations", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(apiReference(reference)),
    });
}

export async function submitVolcAssetReviews(references: VolcAssetValidationReference[]) {
    const items: VolcAssetBatchReviewItem[] = [];
    for (const batch of volcAssetBatches(dedupeVolcAssetReferences(references))) {
        const result = await requestJson<{ items: typeof items }>("/api/local/volc-assets/registrations/batch", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ references: batch.map(apiReference) }),
        });
        items.push(...result.items);
    }
    return { items };
}

export async function getVolcAssetRegistration(localRef: string) {
    const response = await fetch(`/api/local/volc-assets/registrations/${encodeURIComponent(localRef)}`);
    if (response.status === 404) return null;
    if (!response.ok) await throwApiError(response, "火山素材状态读取失败");
    return (await response.json()) as { registration: VolcAssetRegistration; binding?: VolcAssetBinding; remoteIntegrationEnabled: boolean };
}

export function retryVolcAssetGenerationVisibility(localRef: string) {
    return requestJson<{ binding: VolcAssetBinding }>(`/api/local/volc-assets/bindings/${encodeURIComponent(localRef)}/generation-retry`, { method: "POST", headers: jsonHeaders });
}

export async function checkVolcAssets(references: VolcAssetValidationReference[]) {
    type CheckResult = { credentialsConfigured: boolean; relayAvailable: boolean; remoteIntegrationEnabled: boolean; projectName: string; bindings: VolcAssetBinding[]; registrations: VolcAssetRegistration[] };
    let combined: CheckResult | null = null;
    for (const batch of volcAssetBatches(dedupeVolcAssetReferences(references))) {
        const result = await requestJson<CheckResult>("/api/local/volc-assets/batch-check", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ references: batch.map(apiReference) }),
        });
        combined = combined ? { ...result, bindings: [...combined.bindings, ...result.bindings], registrations: [...combined.registrations, ...(result.registrations || [])] } : { ...result, registrations: result.registrations || [] };
    }
    return combined!;
}

export async function preflightVolcAssets(config: AiConfig, references: VolcAssetValidationReference[]): Promise<VolcAssetPreflight> {
    const gate = volcAssetGateConfig(config);
    return requestJson<VolcAssetPreflight>("/api/local/volc-assets/preflight", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ provider: gate.provider, model: gate.model, channelId: gate.channelId, references: dedupeVolcAssetReferences(references).map(apiReference) }),
    });
}

function apiReference(reference: VolcAssetValidationReference) {
    return { localRef: reference.localRef, projectId: reference.projectId, mediaKind: reference.mediaKind };
}

function volcAssetBatches(references: VolcAssetValidationReference[]) {
    const batches: VolcAssetValidationReference[][] = [];
    for (let offset = 0; offset < references.length; offset += 100) batches.push(references.slice(offset, offset + 100));
    return batches.length ? batches : [[]];
}
