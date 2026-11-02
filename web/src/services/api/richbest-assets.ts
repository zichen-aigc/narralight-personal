import axios from "axios";
import localforage from "localforage";

import { getMediaBlob } from "@/services/platform-file-storage";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type MediaKind = "audio" | "video";
type MediaReference = ReferenceAudio | ReferenceVideo;
type AssetBinding = { groupId: string; name: string; assetId?: string; createAttempted?: boolean };
type GroupBinding = { name: string; groupId?: string; createAttempted?: boolean };
type AssetStore = Pick<ReturnType<typeof localforage.createInstance>, "getItem" | "setItem">;
type RequestOptions = { projectId?: string; signal?: AbortSignal; store?: AssetStore };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "richbest_asset_refs" });
const pending = new Map<string, Promise<string>>();
const pendingGroups = new Map<string, Promise<string>>();
const headers = { Authorization: "Bearer server-managed" };

function route(channelId: string, path: string) {
    return `/api/local/ai/${encodeURIComponent(channelId)}${path}`;
}

function body(value: unknown): Record<string, unknown> {
    let current = value;
    for (let depth = 0; depth < 3; depth++) {
        if (!current || typeof current !== "object" || Array.isArray(current)) break;
        const record = current as Record<string, unknown>;
        if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) break;
        current = record.data;
    }
    return current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, ...keys: string[]) {
    return String(keys.map((key) => record[key]).find((value) => typeof value === "string" && value) || "");
}

function items(value: unknown): Record<string, unknown>[] {
    let current = value;
    for (let depth = 0; depth < 4; depth++) {
        if (Array.isArray(current)) return current.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
        if (!current || typeof current !== "object") break;
        const record = current as Record<string, unknown>;
        const list = [record.items, record.list, record.records, record.assets, record.assetGroups, record.groups, record.results].find(Array.isArray);
        if (Array.isArray(list)) return list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
        current = record.data;
    }
    throw new Error("瑞池素材列表响应格式未知，已停止上传以避免重复登记");
}

async function sha256(input: Blob | string) {
    const bytes = typeof input === "string" ? new TextEncoder().encode(input) : await input.arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (part) => part.toString(16).padStart(2, "0")).join("");
}

async function groupId(channelId: string, projectId: string, assetStore: AssetStore, signal?: AbortSignal) {
    const key = `group:${channelId}:${projectId}`;
    const pendingGroup = pendingGroups.get(key);
    if (pendingGroup) return pendingGroup;
    const operation = createOrFindGroup(key, channelId, projectId, assetStore, signal).finally(() => pendingGroups.delete(key));
    pendingGroups.set(key, operation);
    return operation;
}

async function createOrFindGroup(key: string, channelId: string, projectId: string, assetStore: AssetStore, signal?: AbortSignal) {
    const saved = await assetStore.getItem<GroupBinding>(key);
    if (saved?.groupId) return saved.groupId;
    const name = saved?.name || `叙光参考-${(await sha256(projectId)).slice(0, 24)}`;
    const params = new URLSearchParams({ name, pageNumber: "1", pageSize: "50" });
    const found = items((await axios.get(route(channelId, `/api/asset-group/list?${params}`), { headers, signal })).data)
        .find((item) => stringField(item, "name", "Name") === name);
    const existingId = found && stringField(found, "groupId", "id", "GroupId");
    if (existingId) {
        await assetStore.setItem(key, { name, groupId: existingId });
        return existingId;
    }
    if (saved?.createAttempted) throw new Error("瑞池素材组创建结果尚未确认，请在瑞池工具核对；已阻止重复创建和付费生成");
    await assetStore.setItem(key, { name, createAttempted: true });
    const created = body((await axios.post(route(channelId, "/api/asset-group/create"), { name, description: "叙光画布参考素材" }, { headers, signal })).data);
    const createdId = stringField(created, "groupId", "id", "GroupId");
    if (!createdId) throw new Error("瑞池未返回素材组 ID，请核对原创建结果；已阻止付费生成");
    await assetStore.setItem(key, { name, groupId: createdId });
    return createdId;
}

async function mediaBlob(reference: MediaReference) {
    if (reference.storageKey) {
        const stored = await getMediaBlob(reference.storageKey);
        if (stored) return stored;
    }
    if (reference.url.startsWith("blob:") || reference.url.startsWith("data:") || reference.url.startsWith("/api/local/objects/")) {
        const response = await fetch(reference.url);
        if (response.ok) return response.blob();
    }
    throw new Error(`无法读取本地参考素材“${reference.name}”，未提交供应商`);
}

function checkedMedia(blob: Blob, reference: MediaReference, kind: MediaKind) {
    const declaredMime = (reference.type || blob.type).toLowerCase();
    const mime = declaredMime === "audio/x-wav" ? "audio/wav" : declaredMime;
    const allowed = kind === "audio" ? ["audio/wav", "audio/mpeg"] : ["video/mp4", "video/quicktime"];
    const limit = kind === "audio" ? 15_000_000 : 200_000_000;
    if (!allowed.includes(mime) || blob.size <= 0 || blob.size > limit) throw new Error(`瑞池参考${kind === "audio" ? "音频" : "视频"}格式或大小不符合接口要求，未提交供应商`);
    if (reference.durationMs && (reference.durationMs < 2_000 || reference.durationMs > 30_000)) throw new Error("瑞池参考素材时长必须为 2～30 秒，未提交供应商");
    return mime;
}

export async function activeAsset(channelId: string, assetId: string, signal?: AbortSignal, intervalMs = 3_000) {
    for (let attempt = 0; attempt < 40; attempt++) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const params = new URLSearchParams({ assetId });
        const record = body((await axios.get(route(channelId, `/api/asset/get?${params}`), { headers, signal })).data);
        const asset = record.asset && typeof record.asset === "object" ? record.asset as Record<string, unknown> : record;
        const returnedId = stringField(asset, "assetId", "id", "AssetId");
        if (returnedId && returnedId !== assetId) throw new Error("瑞池返回了不匹配的素材 ID，未提交付费视频请求");
        const status = stringField(asset, "status", "Status").toLowerCase();
        if (status === "active") return `asset://${assetId}`;
        if (status === "failed") throw new Error(`瑞池素材审核失败：${stringField(asset, "errorMessage", "message") || assetId}；未提交付费视频请求`);
        if (!status || !["processing", "pending", "submitted"].includes(status)) throw new Error(`瑞池素材状态无法确认（${status || "空"}），未提交付费视频请求`);
        if (attempt < 39 && intervalMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error("瑞池素材仍在审核中，请稍后重试；未提交付费视频请求");
}

async function resolveLocalAsset(channelId: string, reference: MediaReference, kind: MediaKind, options: RequestOptions) {
    if (reference.url.startsWith("asset://")) return activeAsset(channelId, reference.url.slice("asset://".length), options.signal);
    const publicUrl = /^https:\/\//i.test(reference.url) ? reference.url : "";
    const blob = publicUrl ? null : await mediaBlob(reference);
    const mime = blob ? checkedMedia(blob, reference, kind) : "";
    const hash = /^sha256:([a-f0-9]{64})$/i.exec(reference.storageKey || "")?.[1] || await sha256(blob || publicUrl);
    const key = `asset:${channelId}:${options.projectId || "local"}:${kind}:${hash}`;
    const current = pending.get(key);
    if (current) return current;
    const operation = (async () => {
        const assetStore = options.store || store;
        const group = await groupId(channelId, options.projectId || "local", assetStore, options.signal);
        const name = `NL-${kind}-${hash.slice(0, 48)}`;
        const saved = await assetStore.getItem<AssetBinding>(key);
        if (saved?.assetId) return activeAsset(channelId, saved.assetId, options.signal);
        const params = new URLSearchParams({ groupId: group, name, pageNumber: "1", pageSize: "50" });
        const found = items((await axios.get(route(channelId, `/api/asset/list?${params}`), { headers, signal: options.signal })).data)
            .find((item) => stringField(item, "name", "Name") === name);
        const existingId = found && stringField(found, "assetId", "id", "AssetId");
        if (existingId) {
            await assetStore.setItem(key, { groupId: group, name, assetId: existingId });
            return activeAsset(channelId, existingId, options.signal);
        }
        if (saved?.createAttempted) throw new Error("瑞池素材登记结果尚未确认，请在瑞池工具核对；已阻止重复登记和付费生成");
        let url = publicUrl;
        let uploadId = "";
        let assetType = kind === "audio" ? "Audio" : "Video";
        if (blob) {
            const extension = mime === "audio/wav" ? "wav" : mime === "audio/mpeg" ? "mp3" : mime === "video/quicktime" ? "mov" : "mp4";
            const form = new FormData();
            form.append("file", new File([blob], `${name}.${extension}`, { type: mime }));
            const uploaded = body((await axios.post(route(channelId, "/api/asset/upload-file"), form, { headers, signal: options.signal })).data);
            url = stringField(uploaded, "url");
            uploadId = stringField(uploaded, "uploadId");
            assetType = stringField(uploaded, "assetType") || assetType;
            if (!url || !uploadId || assetType !== (kind === "audio" ? "Audio" : "Video")) throw new Error("瑞池上传响应缺少可信素材身份，未登记素材或提交视频");
        }
        await assetStore.setItem(key, { groupId: group, name, createAttempted: true });
        const created = body((await axios.post(route(channelId, "/api/asset/create"), { groupId: group, url, ...(uploadId ? { uploadId } : {}), assetType, name }, { headers, signal: options.signal })).data);
        const assetId = stringField(created, "assetId", "id", "AssetId");
        if (!assetId) throw new Error("瑞池未返回素材 ID，请核对原登记结果；已阻止付费视频请求");
        await assetStore.setItem(key, { groupId: group, name, assetId });
        return activeAsset(channelId, assetId, options.signal);
    })().finally(() => pending.delete(key));
    pending.set(key, operation);
    return operation;
}

export async function resolveRichBestMediaAssets(channelId: string, videos: ReferenceVideo[], audios: ReferenceAudio[], options: RequestOptions = {}) {
    const videoUrls: string[] = [];
    const audioUrls: string[] = [];
    for (const video of videos) videoUrls.push(await resolveLocalAsset(channelId, video, "video", options));
    for (const audio of audios) audioUrls.push(await resolveLocalAsset(channelId, audio, "audio", options));
    return { videoUrls, audioUrls };
}
