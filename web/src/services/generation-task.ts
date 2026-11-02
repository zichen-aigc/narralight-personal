import { throwApiError } from "@/services/api-error";
import type { LocalH3TaskOverlay } from "@/services/api/local-h3";

export type GenerationTaskProvider = "apimart" | "openai" | "gemini" | "seedance" | "volcengine-ark" | "runninghub" | "richbest" | "888api" | "local-h3" | "plugin";
export type GenerationMediaKind = "image" | "video" | "audio";
export type GenerationTaskStatus = "created" | "pending" | "result_pending" | "submission_unknown" | "completed" | "failed" | "cancelled";
export type ProviderErrorDetails = { httpStatus?: number; code?: string; message?: string; requestId?: string };

export type PersistedGenerationTask = {
    provider: GenerationTaskProvider;
    taskId: string;
    mediaKind: GenerationMediaKind;
    model: string;
    channelId?: string;
    projectId?: string;
    nodeId?: string;
    status: GenerationTaskStatus;
    resultIndex?: number;
    errorCode?: string;
    importedHistory?: boolean;
    readOnly?: boolean;
    providerError?: ProviderErrorDetails;
    localH3?: LocalH3TaskOverlay;
    createdAt?: string;
    updatedAt?: string;
    archivedResult?: { storageKey: string; url: string; mimeType: string; bytes: number };
};

export async function persistGenerationTask(task: PersistedGenerationTask) {
    const response = await fetch(taskUrl(task.provider, task.taskId), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mediaKind: task.mediaKind, model: task.model, channelId: task.channelId, projectId: task.projectId, nodeId: task.nodeId, status: task.status, resultIndex: task.resultIndex, errorCode: task.errorCode }),
    });
    if (!response.ok) await throwApiError(response, "生成任务状态写入失败");
    return (await response.json()) as PersistedGenerationTask;
}

export async function readGenerationTask(provider: GenerationTaskProvider, taskId: string) {
    const response = await fetch(taskUrl(provider, taskId));
    if (response.status === 404) return null;
    if (!response.ok) await throwApiError(response, "生成任务状态读取失败");
    return (await response.json()) as PersistedGenerationTask;
}

export async function listGenerationTasks(filter: { projectId?: string; nodeId?: string; status?: GenerationTaskStatus } = {}) {
    const search = new URLSearchParams();
    if (filter.projectId) search.set("projectId", filter.projectId);
    if (filter.nodeId) search.set("nodeId", filter.nodeId);
    if (filter.status) search.set("status", filter.status);
    const response = await fetch(`/api/local/generation-tasks${search.size ? `?${search}` : ""}`);
    if (!response.ok) await throwApiError(response, "生成任务列表读取失败");
    return ((await response.json()) as { tasks?: PersistedGenerationTask[] }).tasks || [];
}

function taskUrl(provider: GenerationTaskProvider, taskId: string) {
    return `/api/local/generation-tasks/${encodeURIComponent(provider)}/${encodeURIComponent(taskId)}`;
}
