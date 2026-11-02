import { apiErrorFromResponse } from "@/services/api-error";

export type VideoPlaybackSource = {
    src: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
};

export type PreparedVideoPlaybackSource = VideoPlaybackSource & {
    optimized?: boolean;
};

type PlaybackPriority = number | (() => number);
type PreparationSubscriber = {
    resolve: (value: PreparedVideoPlaybackSource) => void;
    reject: (reason?: unknown) => void;
    priority: PlaybackPriority;
    signal?: AbortSignal;
    abort?: () => void;
};
type PreparationJob = {
    cacheKey: string;
    source: VideoPlaybackSource;
    storageKey: string;
    mimeType: string;
    order: number;
    running: boolean;
    controller: AbortController;
    subscribers: Set<PreparationSubscriber>;
};

const prepared = new Map<string, PreparedVideoPlaybackSource>();
const preparationJobs = new Map<string, PreparationJob>();
const pendingPreparations: PreparationJob[] = [];
const sha256StorageKey = /^sha256:[a-f0-9]{64}$/;
const localObjectOrigin = "http://narralight.local";
let activePreparations = 0;
let preparationOrder = 0;

export function resolveVideoStorageKey(source: Pick<VideoPlaybackSource, "src" | "storageKey">) {
    if (sha256StorageKey.test(source.storageKey || "")) return source.storageKey!;
    try {
        const currentOrigin = typeof location === "undefined" ? "" : location.origin;
        const acceptedOrigin = currentOrigin || localObjectOrigin;
        const url = new URL(source.src, acceptedOrigin);
        if (url.origin !== acceptedOrigin) return "";
        const match = /^\/api\/local\/objects\/([^/]+)$/.exec(url.pathname);
        const storageKey = match ? decodeURIComponent(match[1]) : "";
        return sha256StorageKey.test(storageKey) ? storageKey : "";
    } catch {
        return "";
    }
}

function priorityValue(priority: PlaybackPriority) {
    try {
        const value = typeof priority === "function" ? priority() : priority;
        return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
    } catch {
        return Number.MAX_SAFE_INTEGER;
    }
}

function jobPriority(job: PreparationJob) {
    let priority = Number.MAX_SAFE_INTEGER;
    for (const subscriber of job.subscribers) priority = Math.min(priority, priorityValue(subscriber.priority));
    return priority;
}

function abortError() {
    return typeof DOMException === "undefined" ? Object.assign(new Error("Aborted"), { name: "AbortError" }) : new DOMException("Aborted", "AbortError");
}

function detachSubscriber(job: PreparationJob, subscriber: PreparationSubscriber, reason?: unknown) {
    if (!job.subscribers.delete(subscriber)) return;
    if (subscriber.signal && subscriber.abort) subscriber.signal.removeEventListener("abort", subscriber.abort);
    if (reason) subscriber.reject(reason);
    if (job.subscribers.size) return;
    if (job.running) job.controller.abort();
    else {
        const index = pendingPreparations.indexOf(job);
        if (index >= 0) pendingPreparations.splice(index, 1);
        preparationJobs.delete(job.cacheKey);
    }
}

function settleJob(job: PreparationJob, result: PreparedVideoPlaybackSource, retryable = false) {
    if (!retryable) prepared.set(job.cacheKey, result);
    const subscribers = [...job.subscribers];
    job.subscribers.clear();
    for (const subscriber of subscribers) {
        if (subscriber.signal && subscriber.abort) subscriber.signal.removeEventListener("abort", subscriber.abort);
        subscriber.resolve(result);
    }
}

function pumpPreparations() {
    if (activePreparations || !pendingPreparations.length) return;
    pendingPreparations.sort((left, right) => jobPriority(left) - jobPriority(right) || left.order - right.order);
    const preparation = pendingPreparations.shift()!;
    if (!preparation.subscribers.size) {
        preparationJobs.delete(preparation.cacheKey);
        pumpPreparations();
        return;
    }
    preparation.running = true;
    activePreparations = 1;
    void fetch("/api/local/media/prepare-video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storageKey: preparation.storageKey, mimeType: preparation.mimeType, bytes: preparation.source.bytes }),
        signal: preparation.controller.signal,
    })
        .then(async (response) => {
            if (!response.ok) throw await apiErrorFromResponse(response, "视频播放优化失败");
            const result = (await response.json()) as { optimized: boolean; retryable?: boolean; media: { storageKey: string; url: string; mimeType: string; bytes: number } };
            settleJob(preparation, { src: result.media.url, storageKey: result.media.storageKey, mimeType: result.media.mimeType, bytes: result.media.bytes, optimized: result.optimized }, Boolean(result.retryable));
        })
        .catch((error) => {
            if (preparation.subscribers.size && error?.name !== "AbortError") {
                settleJob(preparation, { src: preparation.source.src, storageKey: preparation.storageKey, mimeType: preparation.mimeType, bytes: preparation.source.bytes, optimized: false }, true);
            }
        })
        .finally(() => {
            preparationJobs.delete(preparation.cacheKey);
            activePreparations = 0;
            pumpPreparations();
        });
}

export function prepareLocalVideoPlayback(source: VideoPlaybackSource, options: { priority?: PlaybackPriority; signal?: AbortSignal } = {}): Promise<PreparedVideoPlaybackSource> {
    const storageKey = resolveVideoStorageKey(source);
    const mimeType = (source.mimeType || "video/mp4").toLowerCase();
    if (!storageKey || !["video/mp4", "video/quicktime"].includes(mimeType)) return Promise.resolve({ src: source.src, mimeType });
    const cacheKey = `${storageKey}:${mimeType}`;
    const cached = prepared.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    if (options.signal?.aborted) return Promise.reject(abortError());
    let job = preparationJobs.get(cacheKey);
    if (!job) {
        job = { cacheKey, source, storageKey, mimeType, order: ++preparationOrder, running: false, controller: new AbortController(), subscribers: new Set() };
        preparationJobs.set(cacheKey, job);
        pendingPreparations.push(job);
    }
    return new Promise<PreparedVideoPlaybackSource>((resolve, reject) => {
        const subscriber: PreparationSubscriber = { resolve, reject, priority: options.priority ?? 0, signal: options.signal };
        if (options.signal) {
            subscriber.abort = () => detachSubscriber(job!, subscriber, abortError());
            options.signal.addEventListener("abort", subscriber.abort, { once: true });
        }
        job!.subscribers.add(subscriber);
        pumpPreparations();
    });
}
