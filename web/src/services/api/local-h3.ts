import { throwApiError } from "@/services/api-error";

export const LOCAL_H3_CHANNEL_ID = "local-h3";
export const LOCAL_H3_MODEL_ID = "local-h3-base";
export const LOCAL_H3_MODEL_OPTION = `${LOCAL_H3_CHANNEL_ID}::${LOCAL_H3_MODEL_ID}`;
export const LOCAL_H3_PROFILES = [
    { resolution: "864x480", aspectRatio: "16:9", width: 864, height: 480, label: "横屏" },
    { resolution: "480x864", aspectRatio: "9:16", width: 480, height: 864, label: "竖屏" },
    { resolution: "640x640", aspectRatio: "1:1", width: 640, height: 640, label: "方形" },
] as const;
export const LOCAL_H3_DURATIONS = [
    { duration: 5, frames: 124, label: "约5秒" },
    { duration: 10, frames: 243, label: "约10秒" },
] as const;
export const LOCAL_H3_FIXED_PARAMETERS = {
    duration: 5,
    resolution: "864x480",
    aspectRatio: "16:9",
    generateAudio: true,
    referenceMode: "text_to_video",
    outputFormat: "mp4",
} as const;
export type LocalH3Parameters = {
    duration: (typeof LOCAL_H3_DURATIONS)[number]["duration"];
    resolution: (typeof LOCAL_H3_PROFILES)[number]["resolution"];
    aspectRatio: (typeof LOCAL_H3_PROFILES)[number]["aspectRatio"];
    generateAudio: true;
    referenceMode: "text_to_video" | "first_frame" | "first_last_frame";
    outputFormat: "mp4";
};
export type LocalH3Reference = { storageKey: string; mimeType: "image/png" | "image/jpeg" | "image/webp"; role: "first_frame" | "last_frame" };

export function normalizeLocalH3Parameters(input: Partial<LocalH3Parameters> = {}): LocalH3Parameters {
    const profile = LOCAL_H3_PROFILES.find((item) => item.resolution === input.resolution && item.aspectRatio === input.aspectRatio)
        || LOCAL_H3_PROFILES.find((item) => item.resolution === input.resolution)
        || LOCAL_H3_PROFILES[0];
    const duration = LOCAL_H3_DURATIONS.some((item) => item.duration === Number(input.duration)) ? Number(input.duration) as LocalH3Parameters["duration"] : LOCAL_H3_DURATIONS[0].duration;
    const referenceMode = ["first_frame", "first_last_frame"].includes(String(input.referenceMode)) ? input.referenceMode as LocalH3Parameters["referenceMode"] : "text_to_video";
    return { duration, resolution: profile.resolution, aspectRatio: profile.aspectRatio, generateAudio: true, referenceMode, outputFormat: "mp4" };
}

export type LocalH3JobState = "queued" | "leased" | "compiling" | "submitted" | "running" | "rendered" | "uploading" | "verifying" | "completed" | "cancel_requested" | "cancelled" | "failed" | "retryable_failed" | "terminal_failed" | "recovery_pending";
export type LocalH3TaskOverlay = {
    state: LocalH3JobState;
    queuePosition?: number;
    progress?: number;
    cancelRequested: boolean;
    workerOnline: boolean;
    attempt: number;
    updatedAt?: string;
};
export type LocalH3WorkerStatus = {
    online: boolean;
    state: "offline" | "idle" | "busy";
    queueDepth: number;
    activeJobId?: string;
    lastSeenAt?: string;
};
export type LocalH3Job = { jobId: string; state: LocalH3JobState; queuePosition?: number; progress?: number; cancelRequested?: boolean; attempt?: number; createdAt?: string; updatedAt?: string };
export type CreateLocalH3JobResponse = { job: LocalH3Job; task?: unknown; take?: unknown };
export type LocalH3StatusResponse = {
    available?: boolean;
    workerOnline?: boolean;
    busy?: boolean;
    active?: number;
    queued?: number;
    worker?: Partial<LocalH3WorkerStatus>;
    queue?: { depth?: number };
    workers?: Array<{ busy?: boolean; lastSeenAt?: string }>;
} & Partial<LocalH3WorkerStatus>;
export type CreateLocalH3JobInput = {
    takeId: string;
    projectId: string;
    nodeId: string;
    promptOriginalZh: string;
    seed?: number | null;
    parameters: LocalH3Parameters;
    references: LocalH3Reference[];
};

const API_ROOT = "/api/local/h3";

export function isLocalH3Model(model: string | undefined) {
    const value = String(model || "").trim();
    return value === LOCAL_H3_MODEL_ID || value === LOCAL_H3_MODEL_OPTION;
}

export function localH3SeedForTake(takeId: string) {
    let hash = 2166136261;
    for (let index = 0; index < takeId.length; index += 1) {
        hash ^= takeId.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function localH3TaskStatusLabel(localH3: LocalH3TaskOverlay | undefined) {
    if (!localH3) return "等待任务状态";
    if (localH3.cancelRequested || localH3.state === "cancel_requested") return "正在取消";
    const labels: Record<LocalH3JobState, string> = {
        queued: localH3.workerOnline ? "排队" : "工作机离线 · 已排队",
        leased: "准备工作流",
        compiling: "整理中文提示词",
        submitted: "已提交到工作机",
        running: "生成带声音视频",
        rendered: "视频已生成",
        uploading: "上传成片",
        verifying: "验证成片",
        completed: "完成",
        cancel_requested: "正在取消",
        cancelled: "已取消",
        retryable_failed: "等待重试",
        terminal_failed: "失败",
        failed: "失败",
        recovery_pending: "待核对",
    };
    const queue = localH3.state === "queued" && localH3.queuePosition ? ` · 前方 ${Math.max(0, localH3.queuePosition - 1)} 个任务` : "";
    const progress = ["running", "uploading", "verifying"].includes(localH3.state) && Number.isFinite(localH3.progress) ? ` · ${Math.max(0, Math.min(100, Math.round(Number(localH3.progress) * 100)))}%` : "";
    return `${labels[localH3.state]}${queue}${progress}`;
}

export async function createLocalH3Job(input: CreateLocalH3JobInput, signal?: AbortSignal) {
    const seed = Number.isSafeInteger(input.seed) && Number(input.seed) >= 0 ? Number(input.seed) : localH3SeedForTake(input.takeId);
    const parameters = normalizeLocalH3Parameters(input.parameters);
    const response = await fetch(`${API_ROOT}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": input.takeId },
        body: JSON.stringify({ ...input, seed, model: LOCAL_H3_MODEL_ID, parameters }),
        signal,
    });
    if (!response.ok) await throwApiError(response, "本机 H3 任务创建失败");
    const payload = (await response.json()) as CreateLocalH3JobResponse & Partial<LocalH3Job>;
    const jobId = String(payload.jobId || payload.job?.jobId || "").trim();
    if (!jobId) throw Object.assign(new Error("本机 H3 后台未返回任务编号，系统不会自动重提"), { code: "local_h3_job_id_missing" });
    return { ...(payload.job || payload), jobId } as LocalH3Job;
}

export async function readLocalH3Status(signal?: AbortSignal): Promise<LocalH3WorkerStatus> {
    const response = await fetch(`${API_ROOT}/status`, { signal });
    if (!response.ok) await throwApiError(response, "本机 H3 工作站状态读取失败");
    const payload = (await response.json()) as LocalH3StatusResponse;
    const source = payload.worker || payload;
    const online = source.online === true || payload.workerOnline === true || payload.available === true;
    const busy = source.state === "busy" || payload.busy === true || Number(payload.active || 0) > 0;
    return {
        online,
        state: online ? (busy ? "busy" : "idle") : "offline",
        queueDepth: Math.max(0, Number(source.queueDepth ?? payload.queue?.depth ?? payload.queued ?? 0) || 0),
        activeJobId: source.activeJobId,
        lastSeenAt: source.lastSeenAt || payload.workers?.[0]?.lastSeenAt,
    };
}

export async function cancelLocalH3Job(jobId: string) {
    const response = await fetch(`${API_ROOT}/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
    if (!response.ok) await throwApiError(response, "本机 H3 任务取消失败");
    return (await response.json()) as { job?: LocalH3Job } & Partial<LocalH3Job>;
}
