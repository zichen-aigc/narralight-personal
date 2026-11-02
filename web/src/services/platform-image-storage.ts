import localforage from "localforage";
import { readImageMeta } from "@/lib/image-utils";
import { throwApiError } from "@/services/api-error";
export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};
export type RemoteImageSource = {
    url: string;
    provider?: "apimart";
    taskId?: string;
    resultIndex?: number;
    expiresAt?: string;
};
const legacyStore = localforage.createInstance({
    name: "infinite-canvas",
    storeName: "image_files",
});
const objectUrl = (key: string, mime = "image/png") => `/api/local/objects/${encodeURIComponent(key)}?mime=${encodeURIComponent(mime)}`;
const legacyMigrations = new Map<string, Promise<string | undefined>>();
async function hasStoredObject(key: string, mimeType: string) {
    try {
        return (
            await fetch(objectUrl(key, mimeType), {
                method: "HEAD",
            })
        ).ok;
    } catch {
        return false;
    }
}
function migrateLegacyImageInBackground(key: string) {
    if (!key.startsWith("image:")) return Promise.resolve(undefined as string | undefined);
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
    const response = await fetch(`/api/local/objects${alias ? `?alias=${encodeURIComponent(alias)}` : ""}`, {
        method: "POST",
        headers: {
            "content-type": blob.type || "application/octet-stream",
        },
        body: blob,
    });
    if (!response.ok) await throwApiError(response, "图片写入统一对象库失败");
    return (await response.json()) as {
        storageKey: string;
        bytes: number;
        mimeType: string;
    };
}
async function importRemoteImage(source: RemoteImageSource) {
    const response = await fetch("/api/local/objects/import", {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify(source),
    });
    if (!response.ok) await throwApiError(response, "生成图片写入统一对象库失败");
    return (await response.json()) as {
        storageKey: string;
        bytes: number;
        mimeType: string;
    };
}
async function loadBlob(key: string) {
    const response = await fetch(objectUrl(key));
    if (response.ok) return response.blob();
    if (response.status !== 404) await throwApiError(response, "读取统一图片失败");
    const legacy = await legacyStore.getItem<Blob>(key);
    if (!legacy) return null;
    await uploadBlob(legacy, key);
    return legacy;
}
export async function uploadImage(input: string | Blob | RemoteImageSource): Promise<UploadedImage> {
    const remoteSource =
        typeof input === "object" && !(input instanceof Blob)
            ? input
            : typeof input === "string"
              ? {
                    url: input,
                }
              : null;
    const imported = remoteSource && /^https:\/\/(?:upload\.apimart\.ai|getapib\.org)\//i.test(remoteSource.url) ? await importRemoteImage(remoteSource) : null;
    const blob = imported ? null : remoteSource ? await (await fetch(remoteSource.url)).blob() : (input as Blob);
    const stored = imported || (await uploadBlob(blob!));
    const mimeType = blob?.type || stored.mimeType || "image/png";
    const url = objectUrl(stored.storageKey, mimeType);
    const meta = await readImageMeta(url);
    return {
        url,
        storageKey: stored.storageKey,
        width: meta.width,
        height: meta.height,
        bytes: stored.bytes,
        mimeType,
    };
}
export async function uploadGeneratedImage(image: { dataUrl: string; remoteUrl?: string; upstreamTaskId?: string; remoteExpiresAt?: string; resultIndex?: number }) {
    return uploadImage(
        image.remoteUrl
            ? {
                  url: image.remoteUrl,
                  provider: "apimart",
                  taskId: image.upstreamTaskId,
                  resultIndex: image.resultIndex,
                  expiresAt: image.remoteExpiresAt,
              }
            : image.dataUrl,
    );
}
export async function imageToBlob(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    if (image.storageKey) {
        const stored = await loadBlob(image.storageKey);
        if (stored) return stored;
    }
    const url = image.dataUrl || image.url || "";
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) await throwApiError(response, "读取图片失败");
    return response.blob();
}
export async function resolveImageUrl(key?: string, fallback = "", mimeType?: string) {
    if (!key) return fallback;
    const legacyMimeType = await migrateLegacyImageInBackground(key);
    const resolvedMimeType = mimeType || legacyMimeType || "image/png";
    return legacyMimeType || (await hasStoredObject(key, resolvedMimeType)) ? objectUrl(key, resolvedMimeType) : fallback;
}
export const getImageBlob = (key: string) => loadBlob(key);
export async function setImageBlob(key: string, blob: Blob) {
    await uploadBlob(blob, key);
    return objectUrl(key, blob.type || "image/png");
}
export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    const response = await fetch(url);
    if (!response.ok) await throwApiError(response, "读取图片失败");
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}
export async function deleteStoredImages(_keys: Iterable<string>) {}
export async function cleanupUnusedImages(_used: unknown) {}
export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && (value.storageKey.startsWith("image:") || value.storageKey.startsWith("sha256:"))) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}
