import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { UploadedFile } from "@/services/platform-file-storage";
import { createVideoGenerationTask, storeGeneratedVideo, waitForVideoGenerationTask, type VideoGenerationTask, type VideoGenerationTaskState } from "@/services/api/video";
import { persistGenerationTask, readGenerationTask, type PersistedGenerationTask } from "@/services/generation-task";

export type VideoTaskOwner = { projectId?: string; nodeId: string; takeId?: string; primaryEditVideoId?: string };
export type VideoTaskProgress = (record: PersistedGenerationTask, state?: VideoGenerationTaskState) => void | Promise<void>;

export async function createPersistedVideoTask(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], owner: VideoTaskOwner, signal?: AbortSignal) {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, { signal, localTakeId: owner.takeId, primaryEditVideoId: owner.primaryEditVideoId, projectId: owner.projectId, nodeId: owner.nodeId });
    const managed = platformManaged(task);
    const record = (managed ? await readGenerationTask(task.provider, task.id) : null) || (await persistVideoState(task, owner, "pending"));
    if (managed && (!record.projectId || !record.nodeId) && (owner.projectId || owner.nodeId)) return { task, record: await persistVideoState(task, owner, record.status, record.resultIndex, record.errorCode) };
    return { task, record };
}

export async function recoverAndStoreVideoTask(config: AiConfig, task: VideoGenerationTask, owner: VideoTaskOwner, options: { signal?: AbortSignal; onProgress?: VideoTaskProgress; maxPolls?: number; pollDelayMs?: number } = {}): Promise<UploadedFile> {
    if (platformManaged(task)) return waitForPlatformManagedVideoTask(task, options);
    let lastState: VideoGenerationTaskState = { status: "pending" };
    let lastStatus: string = "pending";
    await update("pending");
    try {
        const result = await waitForVideoGenerationTask(config, task, {
            signal: options.signal,
            maxPolls: options.maxPolls,
            pollDelayMs: options.pollDelayMs,
            onState: async (state) => {
                lastState = state;
                lastStatus = state.status;
                if (state.status === "pending") await update("pending", undefined, state);
                if (state.status === "result_pending") await update("result_pending", undefined, state);
                if (state.status === "failed") await update("failed", undefined, state, "upstream_failed");
            },
        });
        const stored = await storeGeneratedVideo(result);
        await update("completed", result.resultIndex, { status: "completed", result });
        return stored;
    } catch (error) {
        const recoverable = lastStatus === "result_pending" || lastStatus === "completed";
        await update(recoverable ? "result_pending" : "failed", undefined, lastState, recoverable ? (lastStatus === "completed" ? "archive_failed" : "result_not_ready") : "poll_failed");
        throw error;
    }

    async function update(status: PersistedGenerationTask["status"], resultIndex?: number, state?: VideoGenerationTaskState, errorCode?: string) {
        const record = await persistVideoState(task, owner, status, resultIndex, errorCode);
        await options.onProgress?.(record, state);
    }
}

async function waitForPlatformManagedVideoTask(task: VideoGenerationTask, options: { signal?: AbortSignal; onProgress?: VideoTaskProgress; maxPolls?: number; pollDelayMs?: number }): Promise<UploadedFile> {
    const maxPolls = options.maxPolls ?? 1200;
    const pollDelayMs = options.pollDelayMs ?? 3000;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const record = await readGenerationTask(task.provider, task.id);
        if (record) {
            await options.onProgress?.(record);
            if (record.status === "completed" && record.archivedResult) return record.archivedResult;
            if (record.status === "failed" || record.status === "cancelled") throw new Error(providerFailureMessage(record));
        }
        if (attempt < maxPolls - 1) await wait(pollDelayMs, options.signal);
    }
    throw new Error(`任务 ${task.id} 仍由本地平台后台处理，可稍后从生成历史继续查看；系统不会重新提交。`);
}

function providerFailureMessage(record: PersistedGenerationTask) {
    const details = record.providerError;
    const parts = [details?.message, details?.code, details?.httpStatus ? `HTTP ${details.httpStatus}` : "", details?.requestId ? `Request ID ${details.requestId}` : ""].filter(Boolean);
    return parts.length ? parts.join(" · ") : `视频任务失败（${record.errorCode || "provider_failed"}）`;
}

function platformManaged(task: VideoGenerationTask) {
    return task.provider === "apimart" || task.provider === "volcengine-ark" || task.provider === "runninghub" || task.provider === "richbest" || task.provider === "888api" || task.provider === "local-h3";
}

function wait(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = globalThis.setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                globalThis.clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

export function videoTaskMetadata(record: PersistedGenerationTask) {
    return {
        provider: record.provider,
        taskId: record.taskId,
        mediaKind: "video" as const,
        model: record.model,
        status: record.status,
        resultIndex: record.resultIndex,
        errorCode: record.errorCode,
        providerError: record.providerError,
        localH3: record.localH3,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

async function persistVideoState(task: VideoGenerationTask, owner: VideoTaskOwner, status: PersistedGenerationTask["status"], resultIndex?: number, errorCode?: string) {
    return persistGenerationTask({ provider: task.provider, taskId: task.id, mediaKind: "video", model: task.model, projectId: owner.projectId, nodeId: owner.nodeId, status, resultIndex, errorCode });
}
