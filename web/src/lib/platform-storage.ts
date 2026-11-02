import { StateStorage } from "zustand/middleware";
import localforage from "localforage";

import { randomId } from "@/lib/utils";
import { SharedEventSource } from "@/lib/shared-event-source";
import { acceptRuntimeIdentity } from "@/lib/runtime-version-guard";
import { localApiError, throwApiError } from "@/services/api-error";

const STATE_BASE = "/api/local/state/";

export const platformClientId = randomId();
const versions = new Map<string, number>();
const values = new Map<string, string>();
const stateOperations = new Map<string, Promise<void>>();
const legacyStore = localforage.createInstance({ name: "infinite-canvas", storeName: "app_state" });
let platformWritesBlocked = false;

export type PlatformStateEvent = { key: string; version: number; updatedAt: string; deleted?: boolean; clientId?: string; leaseResource?: string };

function announceOffline(error: unknown) {
    if (typeof window === "undefined") return;
    platformWritesBlocked = true;
    window.dispatchEvent(new CustomEvent("infinite-canvas:platform-offline", { detail: error instanceof Error ? error.message : String(error) }));
}

function announceOnline() {
    platformWritesBlocked = false;
    if (typeof window !== "undefined") window.dispatchEvent(new Event("infinite-canvas:platform-online"));
}

function assertPlatformWritable() {
    if (platformWritesBlocked) throw localApiError("platform_readonly_offline", "本地平台连接正在恢复，画布保持只读且不会排队写入");
}

async function platformFetch(input: RequestInfo | URL, init?: RequestInit) {
    try {
        const response = await fetch(input, { ...init, cache: "no-store", credentials: "same-origin" });
        if (typeof window !== "undefined") {
            if (response.status === 401) {
            }
            if (response.status === 428) {
            }
        }
        return response;
    } catch (error) {
        const diagnostic = localApiError("platform_network_error", "本地平台服务不可用，已停止写入以防止浏览器数据分叉");
        announceOffline(diagnostic);
        throw diagnostic;
    }
}

async function readRemote(name: string) {
    const response = await platformFetch(`${STATE_BASE}${encodeURIComponent(name)}`);
    if (response.status === 404) {
        versions.delete(name);
        values.delete(name);
        return null;
    }
    if (!response.ok) await throwApiError(response, "读取统一存储失败");
    const result = (await response.json()) as { value: string; version: number };
    versions.set(name, result.version);
    values.set(name, result.value);
    return result;
}

// Event-driven reconciliation must observe the current authority exactly as-is.
// Unlike startup hydration, a missing key here must not import stale browser data.
export async function readPlatformStateAuthority(name: string) {
    if (typeof window === "undefined") return null;
    return (await readRemote(name))?.value ?? null;
}

async function importLegacy(name: string) {
    const indexedDbValue = await legacyStore.getItem<string>(name);
    const value = indexedDbValue || window.localStorage.getItem(name);
    if (!value) return null;
    const response = await platformFetch(`${STATE_BASE}${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value, expectedVersion: 0, clientId: platformClientId, migration: "legacy-browser" }),
    });
    if (response.status === 409) return readRemote(name);
    if (!response.ok) await throwApiError(response, "迁移浏览器数据失败");
    const result = (await response.json()) as { version: number };
    versions.set(name, result.version);
    values.set(name, value);
    if (name === "infinite-canvas:ai_config_store") {
        await legacyStore.removeItem(name);
        window.localStorage.removeItem(name);
    }
    return { value, version: result.version };
}

function sameJsonValue(left: unknown, right: unknown) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function mergeCanvasState(baseValue: string | undefined, localValue: string, remoteValue: string) {
    if (!baseValue) return null;
    try {
        const base = JSON.parse(baseValue) as { state?: { projects?: Array<Record<string, unknown>> } };
        const local = JSON.parse(localValue) as { state?: { projects?: Array<Record<string, unknown>> } };
        const remote = JSON.parse(remoteValue) as { state?: { projects?: Array<Record<string, unknown>> } };
        const baseProjects = new Map((base.state?.projects || []).map((project) => [String(project.id || ""), project]));
        const localProjects = new Map((local.state?.projects || []).map((project) => [String(project.id || ""), project]));
        const remoteProjects = new Map((remote.state?.projects || []).map((project) => [String(project.id || ""), project]));
        const ids = [...new Set([...localProjects.keys(), ...remoteProjects.keys(), ...baseProjects.keys()])].filter(Boolean);
        const projects: Array<Record<string, unknown>> = [];
        for (const id of ids) {
            const baseProject = baseProjects.get(id);
            const localProject = localProjects.get(id);
            const remoteProject = remoteProjects.get(id);
            const localChanged = !sameJsonValue(localProject, baseProject);
            const remoteChanged = !sameJsonValue(remoteProject, baseProject);
            if (localChanged && remoteChanged && !sameJsonValue(localProject, remoteProject)) return null;
            const selected = localChanged ? localProject : remoteProject;
            if (selected) projects.push(selected);
        }
        projects.sort((left, right) => Date.parse(String(right.updatedAt || "")) - Date.parse(String(left.updatedAt || "")));
        return JSON.stringify({ ...remote, ...local, state: { ...(remote.state || {}), ...(local.state || {}), projects } });
    } catch {
        return null;
    }
}

let streamAccessProbe: Promise<void> | null = null;

function announceEventStreamFailure() {
    if (streamAccessProbe) return;
    streamAccessProbe = (async () => {
        try {
            const metaResponse = await fetch("/api/local/meta", { cache: "no-store", credentials: "same-origin" });
            if (!metaResponse.ok) throw new Error(`HTTP ${metaResponse.status}`);
            const meta = (await metaResponse.json()) as { profile?: string };

            announceOffline("统一存储事件连接已断开");
        } catch (error) {
            announceOffline(error);
        } finally {
            streamAccessProbe = null;
        }
    })();
}

async function ensureVersion(name: string) {
    if (versions.has(name)) return versions.get(name)!;
    const current = await readRemote(name);
    return current?.version || 0;
}

function serializeStateOperation(name: string, operation: () => Promise<void>) {
    const previous = stateOperations.get(name) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    stateOperations.set(name, current);
    return current.finally(() => {
        if (stateOperations.get(name) === current) stateOperations.delete(name);
    });
}

export const platformStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        const current = await readPlatformStateAuthority(name);
        if (current !== null) return current;

        return (await importLegacy(name))?.value || null;
    },
    setItem: (name, value) =>
        serializeStateOperation(name, async () => {
            if (typeof window === "undefined") return;

            assertPlatformWritable();
            let expectedVersion = await ensureVersion(name);
            let baseValue = values.get(name);
            let desiredValue = value;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                const response = await platformFetch(`${STATE_BASE}${encodeURIComponent(name)}`, {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ value: desiredValue, expectedVersion, clientId: platformClientId }),
                });
                if (response.status === 409) {
                    const conflict = (await response.json()) as { actualVersion?: number };
                    const remote = await readRemote(name);
                    const merged = name === "infinite-canvas:canvas_store" && remote ? mergeCanvasState(baseValue, desiredValue, remote.value) : null;
                    if (!remote || !merged) {
                        if (Number.isSafeInteger(conflict.actualVersion)) versions.set(name, conflict.actualVersion!);
                        window.dispatchEvent(new CustomEvent("infinite-canvas:platform-conflict", { detail: { key: name, ...conflict } }));
                        throw new Error(`统一存储版本冲突：${name}，已保留远程新版本`);
                    }
                    baseValue = remote.value;
                    desiredValue = merged;
                    expectedVersion = remote.version;
                    continue;
                }
                if (!response.ok) await throwApiError(response, "写入统一存储失败");
                const result = (await response.json()) as { version: number };
                versions.set(name, result.version);
                values.set(name, desiredValue);
                return;
            }
            window.dispatchEvent(new CustomEvent("infinite-canvas:platform-conflict", { detail: { key: name } }));
            throw new Error(`统一存储版本冲突：${name}，重试次数已用完`);
        }),
    removeItem: (name) =>
        serializeStateOperation(name, async () => {
            if (typeof window === "undefined") return;

            assertPlatformWritable();
            const response = await platformFetch(`${STATE_BASE}${encodeURIComponent(name)}`, { method: "DELETE" });
            if (!response.ok) await throwApiError(response, "删除统一存储失败");
            versions.delete(name);
            values.delete(name);
        }),
};

export async function checkPlatformHealth() {
    const response = await platformFetch("/api/local/health");
    if (!response.ok) await throwApiError(response, "本地平台健康检查失败");
    const result = (await response.json()) as { ok?: boolean; loopbackOnly?: boolean; appVersion?: string; runtimeId?: string };
    if (!result.ok || !result.loopbackOnly) throw new Error("本地平台安全状态无效");
    acceptRuntimeIdentity(result);
    announceOnline();
    return result;
}

export function isPlatformWriteBlocked() {
    return platformWritesBlocked;
}

export function subscribePlatformState(onState: (event: PlatformStateEvent) => void) {
    const source = new SharedEventSource("/api/local/events", { eventTypes: ["state"] });
    source.addEventListener("state", (message) => {
        const event = JSON.parse((message as MessageEvent).data) as PlatformStateEvent;
        if (event.clientId === platformClientId) return;
        onState(event);
    });
    source.onerror = announceEventStreamFailure;
    return () => source.close();
}

export type PlatformLeaseEvent = { resource: string; clientId?: string; expiresAt?: string; released?: boolean; expired?: boolean; takeover?: boolean };

export function subscribePlatformLeases(onLease: (event: PlatformLeaseEvent) => void) {
    const source = new SharedEventSource("/api/local/events", { eventTypes: ["lease"] });
    source.addEventListener("lease", (message) => onLease(JSON.parse((message as MessageEvent).data) as PlatformLeaseEvent));
    source.onerror = announceEventStreamFailure;
    return () => source.close();
}

export { legacyStore };
