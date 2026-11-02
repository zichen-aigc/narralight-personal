import localforage from "localforage";
import { throwApiError } from "@/services/api-error";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };
export type RemoteMediaImport = { url: string; provider: "apimart" | "volcengine-ark" | "runninghub" | "richbest"; taskId: string; resultIndex: number; mediaKind: "video"; expiresAt?: string };
const legacyStore = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrl = (key: string, mime = "application/octet-stream") => `/api/local/objects/${encodeURIComponent(key)}?mime=${encodeURIComponent(mime)}`;
const legacyMigrations = new Map<string, Promise<string | undefined>>();

async function hasStoredObject(key: string, mimeType: string) {
    try {
        return (await fetch(objectUrl(key, mimeType), { method: "HEAD" })).ok;
    } catch {
        return false;
    }
}

function migrateLegacyMediaInBackground(key: string) {
    if (key.startsWith("sha256:")) return Promise.resolve(undefined as string | undefined);
    const current = legacyMigrations.get(key);
    if (current) return current;
    const migration = legacyStore
        .getItem<Blob>(key)
        .then(async (legacy) => {
            if (legacy) await uploadBlob(legacy, key);
            return legacy?.type || undefined;
        })
        .catch(() => undefined as string | undefined)
        .finally(() => legacyMigrations.delete(key));
    legacyMigrations.set(key, migration);
    return migration;
}

async function uploadBlob(blob: Blob, alias?: string) {
    const response = await fetch(`/api/local/objects${alias ? `?alias=${encodeURIComponent(alias)}` : ""}`, { method: "POST", headers: { "content-type": blob.type || "application/octet-stream" }, body: blob });
    if (!response.ok) await throwApiError(response, "媒体写入统一对象库失败");
    return (await response.json()) as { storageKey: string; bytes: number; mimeType: string };
}
async function loadBlob(key: string) {
    const response = await fetch(objectUrl(key));
    if (response.ok) return response.blob();
    if (response.status !== 404) await throwApiError(response, "读取统一媒体失败");
    const legacy = await legacyStore.getItem<Blob>(key);
    if (!legacy) return null;
    await uploadBlob(legacy, key);
    return legacy;
}
export async function uploadMediaFile(input: string | Blob, _prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const stored = await uploadBlob(blob);
    const mimeType = blob.type || stored.mimeType || "application/octet-stream";
    const url = objectUrl(stored.storageKey, mimeType);
    const meta = mimeType.startsWith("video/") ? await readVideoMeta(url) : mimeType.startsWith("audio/") ? await readAudioMeta(url) : {};
    return { url, storageKey: stored.storageKey, bytes: stored.bytes, mimeType, ...meta };
}
export async function importRemoteMediaResult(input: RemoteMediaImport): Promise<UploadedFile> {
    const response = await fetch("/api/local/objects/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (!response.ok) await throwApiError(response, "远程视频归档失败");
    const stored = (await response.json()) as UploadedFile;
    const mimeType = stored.mimeType || "video/mp4";
    const url = objectUrl(stored.storageKey, mimeType);
    return { ...stored, url, mimeType, ...(await readVideoMeta(url)) };
}
export async function resolveMediaUrl(key?: string, fallback = "", mimeType?: string) {
    if (!key) return fallback;
    const legacyMimeType = await migrateLegacyMediaInBackground(key);
    const resolvedMimeType = mimeType || legacyMimeType || "application/octet-stream";
    return (legacyMimeType || (await hasStoredObject(key, resolvedMimeType))) ? objectUrl(key, resolvedMimeType) : fallback;
}
export const getMediaBlob = (key: string) => loadBlob(key);
export async function setMediaBlob(key: string, blob: Blob) {
    await uploadBlob(blob, key);
    return objectUrl(key, blob.type);
}
export async function deleteStoredMedia(_keys: Iterable<string>) {}
export async function cleanupUnusedMedia(_used: unknown) {}
export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}
function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const media = document.createElement("video");
        const done = () => resolve({ width: media.videoWidth || 1280, height: media.videoHeight || 720, durationMs: Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : undefined });
        media.onloadedmetadata = done;
        media.onerror = done;
        media.src = url;
    });
}
function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const media = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : undefined });
        media.onloadedmetadata = done;
        media.onerror = done;
        media.src = url;
    });
}
