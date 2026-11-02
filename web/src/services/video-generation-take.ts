import type { PersistedGenerationTask, ProviderErrorDetails } from "@/services/generation-task";
import { throwApiError } from "@/services/api-error";
import type { UploadedFile } from "@/services/platform-file-storage";
import type { CanvasNodeData } from "@/types/canvas";
import { seedanceCapabilitiesFor } from "@/lib/seedance-model-capabilities";
import { isGrokApimartVideoModel, normalizeGrokApimartVideoSettings } from "@/lib/grok-apimart-video";
import { apimartGrokOfficialVideoCapabilitiesFor, normalizeApimartGrokOfficialVideoSettings } from "@/lib/apimart-grok-official-video";
import { normalizeRunningHubGrokSettings, runningHubGrokCapabilitiesFor } from "@/lib/runninghub-grok-video";
import { assertModelBackendSupported } from "@/lib/backend-model-contract";
import { normalize888ApiVideoSettings } from "@/lib/api888-video-settings";
import { isLocalH3Model, LOCAL_H3_MODEL_ID, normalizeLocalH3Parameters } from "@/services/api/local-h3";

export type VideoGenerationTakeStatus = "created" | "submitting" | "submission_unknown" | "pending" | "result_pending" | "completed" | "failed";
export type VideoGenerationTakeParameters = {
    duration?: number;
    resolution?: string;
    aspectRatio?: string;
    generateAudio?: boolean;
    watermark?: boolean;
    referenceMode?: string;
    outputFormat?: "mp4" | "mov";
};

export type VideoGenerationTake = {
    takeId: string;
    projectId: string;
    nodeId: string;
    status: VideoGenerationTakeStatus;
    provider?: PersistedGenerationTask["provider"];
    taskId?: string;
    model?: string;
    prompt: string;
    parameters: VideoGenerationTakeParameters;
    resultIndex?: number;
    errorCode?: string;
    importedHistory?: boolean;
    readOnly?: boolean;
    providerError?: ProviderErrorDetails;
    createdAt: string;
    updatedAt: string;
    reconciliation?: {
        status: "submitting" | "pending" | "no_match" | "candidates" | "monitoring" | "archive_pending" | "archived" | "failed" | "rejected" | "expired" | "legacy_untracked" | "not_found";
        attemptCount: number;
        consecutiveErrorCount: number;
        phase?: "initial_wait" | "provider_pending" | "query_error" | "result_pending" | "archive_pending" | "submission_reconcile" | "archived" | "terminal" | "expired";
        lastCheckedAt?: string;
        lastSuccessfulCheckAt?: string;
        lastProviderStatus?: string;
        nextCheckAt?: string;
        lastError?: string;
        expiresAt?: string;
        candidates: Array<{ taskId: string; status: string; createdAt?: string; model?: string }>;
    };
    media?: UploadedFile;
};

export type VideoGenerationTakeHistory = {
    takes: VideoGenerationTake[];
    activeTakeId: string | null;
    counts: { completed: number; pending: number; unknown: number; failed: number };
};

export type VideoTakeParameterSource = {
    model?: string;
    videoSeconds?: string;
    seconds?: string;
    vquality?: string;
    size?: string;
    videoGenerateAudio?: string;
    generateAudio?: string;
    videoWatermark?: string;
    watermark?: string;
    videoReferenceMode?: string;
    videoOutputFormat?: "mp4" | "mov";
};

export type LegacyVideoTakeBootstrapInput = {
    projectId: string;
    nodeId: string;
    provider: PersistedGenerationTask["provider"];
    taskId: string;
    model: string;
    resultIndex: number;
    prompt?: string;
    parameters: VideoGenerationTakeParameters;
    storageKey: string;
    mimeType: string;
    bytes?: number;
    durationMs?: number;
};

export async function createVideoGenerationTake(input: { projectId: string; nodeId: string; prompt: string; model?: string; parameters?: VideoGenerationTakeParameters }, recovery?: { existingTaskId: string }) {
    const requestInput = isLocalH3Model(input.model) ? { ...input, model: LOCAL_H3_MODEL_ID, parameters: normalizeLocalH3Parameters(input.parameters as Parameters<typeof normalizeLocalH3Parameters>[0]) } : input;
    if (!recovery || !/^[a-zA-Z0-9_.:-]{3,200}$/.test(recovery.existingTaskId)) assertModelBackendSupported(requestInput.model);
    return requestTake("/api/local/video-generation-takes", { method: "POST", body: JSON.stringify(requestInput) });
}

export async function readVideoGenerationTake(takeId: string) {
    const response = await fetch(takeUrl(takeId));
    if (!response.ok) await throwApiError(response, "视频版本读取失败");
    return (await response.json()) as VideoGenerationTake;
}

export async function updateVideoGenerationTake(
    takeId: string,
    patch: {
        status: VideoGenerationTakeStatus;
        provider?: PersistedGenerationTask["provider"];
        taskId?: string;
        model?: string;
        resultIndex?: number;
        errorCode?: string;
        storageKey?: string;
        mimeType?: string;
        bytes?: number;
        durationMs?: number;
    },
) {
    return requestTake(takeUrl(takeId), { method: "PUT", body: JSON.stringify(patch) });
}

export async function updateVideoTakeFromTask(takeId: string, task: PersistedGenerationTask) {
    return updateVideoGenerationTake(takeId, {
        status: task.status === "cancelled" ? "failed" : task.status,
        provider: task.provider,
        taskId: task.taskId,
        model: task.model,
        resultIndex: task.resultIndex,
        errorCode: task.status === "cancelled" ? "cancelled" : task.errorCode,
    });
}

export async function completeVideoGenerationTake(takeId: string, task: PersistedGenerationTask | undefined, media: UploadedFile) {
    const current = await readVideoGenerationTake(takeId);
    if (current.status === "completed") return current;
    return updateVideoGenerationTake(takeId, {
        status: "completed",
        provider: task?.provider,
        taskId: task?.taskId,
        model: task?.model,
        resultIndex: task?.resultIndex,
        storageKey: media.storageKey,
        mimeType: media.mimeType,
        bytes: media.bytes,
        durationMs: media.durationMs,
    });
}

export async function failVideoGenerationTakeIfSafe(takeId: string, errorCode: string) {
    const current = await readVideoGenerationTake(takeId);
    if (current.status !== "created") return current;
    return updateVideoGenerationTake(takeId, { status: "failed", errorCode });
}

export async function listVideoGenerationTakes(projectId: string, nodeId: string) {
    const search = new URLSearchParams({ projectId, nodeId });
    const response = await fetch(`/api/local/video-generation-takes?${search}`);
    if (!response.ok) await throwApiError(response, "视频节点生成历史读取失败");
    return (await response.json()) as VideoGenerationTakeHistory;
}

export async function adoptVideoGenerationTake(takeId: string) {
    const response = await fetch(`${takeUrl(takeId)}/adopt`, { method: "POST" });
    if (!response.ok) await throwApiError(response, "视频版本采纳失败");
    return (await response.json()) as { take: VideoGenerationTake; activeTakeId: string };
}

export async function bootstrapLegacyVideoGenerationTake(input: { projectId: string; nodeId: string; provider: PersistedGenerationTask["provider"]; taskId: string; model?: string; resultIndex?: number; prompt?: string; parameters?: VideoGenerationTakeParameters; storageKey: string; mimeType: string; bytes?: number; durationMs?: number }) {
    const response = await fetch("/api/local/video-generation-takes/bootstrap", { method: "POST", headers: jsonHeaders, body: JSON.stringify(input) });
    if (!response.ok) await throwApiError(response, "旧视频版本补建失败");
    return (await response.json()) as { take: VideoGenerationTake; created: boolean };
}

export function legacyVideoTakeBootstrapInput(projectId: string, node: CanvasNodeData): LegacyVideoTakeBootstrapInput | null {
    const metadata = node.metadata;
    const storageKey = metadata?.storageKey || "";
    const mimeType = (metadata?.mimeType || "video/mp4").toLowerCase();
    if (node.type !== "video" || !/^sha256:[a-f0-9]{64}$/.test(storageKey) || !["video/mp4", "video/webm", "video/quicktime"].includes(mimeType)) return null;

    const currentTask = metadata?.generationTask;
    const modern = currentTask?.status === "completed" ? currentTask : null;
    const legacyModel = String(metadata?.model || "").trim();
    const legacyProvider = providerFromLegacyModel(legacyModel);
    const provider = modern?.provider || legacyProvider;
    const taskId = String(modern?.taskId || metadata?.upstreamTaskId || "").trim();
    const model = String(modern?.model || legacyModel).trim();
    const legacySucceeded = metadata?.status === "success" && Boolean(legacyProvider);
    if ((!modern && !legacySucceeded) || !provider || !/^[a-zA-Z0-9_.:-]{3,200}$/.test(taskId) || !model || model === "unknown") return null;

    const resultIndex = modern?.resultIndex ?? metadata?.resultIndex ?? 0;
    if (!Number.isSafeInteger(resultIndex) || resultIndex < 0 || resultIndex > 100) return null;
    return {
        projectId,
        nodeId: node.id,
        provider,
        taskId,
        model,
        resultIndex,
        prompt: metadata?.prompt,
        parameters: videoTakeParameters(metadata || {}),
        storageKey,
        mimeType,
        bytes: metadata?.bytes,
        durationMs: metadata?.durationMs,
    };
}

export function videoTakeParameters(source: VideoTakeParameterSource): VideoGenerationTakeParameters {
    if (isLocalH3Model(source.model)) return normalizeLocalH3Parameters({ duration: Number(source.videoSeconds ?? source.seconds) as 5 | 10, resolution: source.vquality as "864x480" | "480x864" | "640x640", aspectRatio: source.size as "16:9" | "9:16" | "1:1", referenceMode: source.videoReferenceMode as "text_to_video" | "first_frame" | "first_last_frame" });
    const durationValue = source.videoSeconds ?? source.seconds;
    const duration = Number(durationValue);
    if (String(source.model || "").startsWith("888api::")) {
        const settings = normalize888ApiVideoSettings(source.model, source.size, durationValue);
        return { duration: settings.seconds, aspectRatio: settings.ratio };
    }
    const officialGrok = apimartGrokOfficialVideoCapabilitiesFor(source.model);
    if (officialGrok) {
        if (officialGrok.workflow === "video_edit") return { referenceMode: "video_edit" };
        const normalized = normalizeApimartGrokOfficialVideoSettings(source.model, { resolution: source.vquality || "", ratio: source.size || "", duration })!;
        return compact({ duration: present(durationValue) ? normalized.duration : undefined, resolution: present(source.vquality) ? normalized.resolution : undefined, aspectRatio: present(source.size) ? normalized.ratio : undefined });
    }
    const runningHubGrok = runningHubGrokCapabilitiesFor(source.model);
    if (runningHubGrok) {
        const normalized = normalizeRunningHubGrokSettings(source.model, { resolution: source.vquality || "", ratio: source.size || "", duration })!;
        return compact({
            duration: runningHubGrok.workflow === "video_edit" ? undefined : normalized.duration,
            resolution: runningHubGrok.resolutions.length ? normalized.resolution : undefined,
            aspectRatio: runningHubGrok.ratios.length ? normalized.ratio : undefined,
            referenceMode: runningHubGrok.workflow,
        });
    }
    if (isGrokApimartVideoModel(source.model)) {
        const normalized = normalizeGrokApimartVideoSettings({ resolution: source.vquality || "", ratio: source.size || "", duration });
        return compact({
            duration: present(durationValue) ? normalized.duration : undefined,
            resolution: present(source.vquality) ? normalized.resolution : undefined,
            aspectRatio: present(source.size) ? normalized.ratio : undefined,
        });
    }
    const outputFormatSupported = Boolean(seedanceCapabilitiesFor(source.model)?.outputFormats?.length);
    return compact({
        duration: Number.isSafeInteger(duration) ? duration : undefined,
        resolution: source.vquality,
        aspectRatio: source.size,
        generateAudio: booleanParameter(source.videoGenerateAudio ?? source.generateAudio),
        watermark: booleanParameter(source.videoWatermark ?? source.watermark),
        referenceMode: source.videoReferenceMode,
        outputFormat: outputFormatSupported ? source.videoOutputFormat || "mp4" : undefined,
    });
}

export function summarizeVideoTakeStatuses(takes: VideoGenerationTake[]) {
    return takes.reduce(
        (counts, take) => {
            if (take.status === "completed") counts.completed += 1;
            else if (take.status === "failed") counts.failed += 1;
            else if (take.status === "submission_unknown") counts.unknown += 1;
            else counts.pending += 1;
            return counts;
        },
        { completed: 0, pending: 0, unknown: 0, failed: 0 },
    );
}

export async function selectVideoReconciliationCandidate(takeId: string, taskId: string) {
    const response = await fetch(`${takeUrl(takeId)}/reconcile/${encodeURIComponent(taskId)}`, { method: "POST" });
    if (!response.ok) await throwApiError(response, "视频任务恢复候选选择失败");
    return (await response.json()) as VideoGenerationTake;
}

export async function checkVideoGenerationTakeNow(takeId: string) {
    const response = await fetch(`${takeUrl(takeId)}/check-now`, { method: "POST" });
    if (!response.ok) await throwApiError(response, "原供应商任务查询失败");
    return (await response.json()) as { take: VideoGenerationTake; checked: boolean; throttled: boolean };
}

const jsonHeaders = { "content-type": "application/json" };
const takeUrl = (takeId: string) => `/api/local/video-generation-takes/${encodeURIComponent(takeId)}`;

async function requestTake(url: string, init: RequestInit) {
    const response = await fetch(url, { ...init, headers: jsonHeaders });
    if (!response.ok) await throwApiError(response, "视频版本写入失败");
    return (await response.json()) as VideoGenerationTake;
}

function compact<T extends Record<string, unknown>>(value: T) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as VideoGenerationTakeParameters;
}

function booleanParameter(value: string | undefined) {
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
}

function present(value: string | undefined) {
    return Boolean(value?.trim());
}

function providerFromLegacyModel(model: string): PersistedGenerationTask["provider"] | null {
    const provider = model.split("::", 1)[0]?.toLowerCase();
    if (provider === "volcengine-ark-gx" || provider === "volcengine-ark") return "volcengine-ark";
    return provider === "apimart" || provider === "openai" || provider === "seedance" || provider === "runninghub" || provider === "richbest" || provider === "888api" || provider === "local-h3" || provider === "plugin" ? provider : null;
}
