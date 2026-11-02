export type ApimartMediaKind = "image" | "video" | "audio";
export type ApimartTaskRecord = Record<string, unknown>;
export type ApimartNormalizedResult = { url: string; resultIndex: number; expiresAt?: string };
export type ApimartTaskDiagnostic = {
    status: string;
    taskKeys: string[];
    resultKeys: string[];
    collectionCount: number;
};

const COLLECTION_KEYS: Record<ApimartMediaKind, string> = { image: "images", video: "videos", audio: "audios" };
const MEDIA_URL_KEYS: Record<ApimartMediaKind, string[]> = {
    image: ["image_url", "url"],
    video: ["video_url", "url"],
    audio: ["audio_url", "url"],
};
const DIRECT_URL_KEYS: Record<ApimartMediaKind, string[]> = {
    image: ["image_url", "url"],
    video: ["video_url", "url"],
    audio: ["audio_url", "url"],
};

export function apimartTaskRecord(payload: unknown): ApimartTaskRecord {
    if (!payload || typeof payload !== "object") return {};
    const root = payload as ApimartTaskRecord;
    const data = root.data;
    if (Array.isArray(data)) return (data[0] && typeof data[0] === "object" ? data[0] : {}) as ApimartTaskRecord;
    return data && typeof data === "object" ? (data as ApimartTaskRecord) : root;
}

export function normalizeApimartMediaResults(payload: unknown, mediaKind: ApimartMediaKind): ApimartNormalizedResult[] {
    const task = apimartTaskRecord(payload);
    const result = task.result && typeof task.result === "object" && !Array.isArray(task.result) ? (task.result as ApimartTaskRecord) : {};
    const taskExpiresAt = normalizeExpiresAt(task.expires_at ?? task.expiresAt ?? result.expires_at ?? result.expiresAt);
    const values = new Map<string, string | undefined>();
    const collectionKey = COLLECTION_KEYS[mediaKind];

    for (const container of [result, task]) {
        const containerExpiresAt = normalizeExpiresAt(container.expires_at ?? container.expiresAt) || taskExpiresAt;
        const collection = Array.isArray(container[collectionKey]) ? (container[collectionKey] as unknown[]).slice(0, 100) : [];
        for (const item of collection) {
            if (typeof item === "string" || Array.isArray(item)) {
                appendUrls(values, item, containerExpiresAt);
                continue;
            }
            if (!item || typeof item !== "object") continue;
            const record = item as ApimartTaskRecord;
            const itemExpiresAt = normalizeExpiresAt(record.expires_at ?? record.expiresAt) || containerExpiresAt;
            for (const key of MEDIA_URL_KEYS[mediaKind]) appendUrls(values, record[key], itemExpiresAt);
        }
        for (const key of DIRECT_URL_KEYS[mediaKind]) appendUrls(values, container[key], containerExpiresAt);
    }

    return [...values].map(([url, expiresAt], resultIndex) => ({ url, resultIndex, ...(expiresAt ? { expiresAt } : {}) }));
}

export function describeApimartTask(payload: unknown, mediaKind: ApimartMediaKind): ApimartTaskDiagnostic {
    const task = apimartTaskRecord(payload);
    const result = task.result && typeof task.result === "object" && !Array.isArray(task.result) ? (task.result as ApimartTaskRecord) : {};
    const collectionKey = COLLECTION_KEYS[mediaKind];
    const collection = Array.isArray(result[collectionKey]) ? result[collectionKey] : Array.isArray(task[collectionKey]) ? task[collectionKey] : [];
    return {
        status: typeof task.status === "string" ? task.status.toLowerCase() : "unknown",
        taskKeys: Object.keys(task).filter(isDiagnosticKey).sort().slice(0, 30),
        resultKeys: Object.keys(result).filter(isDiagnosticKey).sort().slice(0, 30),
        collectionCount: collection.length,
    };
}

function appendUrls(target: Map<string, string | undefined>, value: unknown, expiresAt?: string) {
    const candidates = Array.isArray(value) ? value.slice(0, 20) : [value];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && /^https?:\/\//i.test(candidate) && !target.has(candidate)) target.set(candidate, expiresAt);
    }
}

function normalizeExpiresAt(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value).slice(0, 100) : undefined;
}

function isDiagnosticKey(key: string) {
    return /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) && !/(authorization|token|secret|key|prompt|url)/i.test(key);
}
