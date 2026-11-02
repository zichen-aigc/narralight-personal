import axios, { AxiosHeaders } from "axios";

import { APP_VERSION } from "@/constant/env";

export const RUNTIME_STALE_EVENT = "infinite-canvas:runtime-stale";

export type RuntimeIdentity = { appVersion: string; runtimeId: string };
export type RuntimeStaleDetail = { pageVersion: string; currentVersion: string; reason: "version" | "instance" };

const nativeFetch = globalThis.fetch.bind(globalThis);
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
let accepted: RuntimeIdentity | null = null;
let stale: RuntimeStaleDetail | null = null;
let fetchInstalled = false;
let axiosInstalled = false;
const runtimeObservers = new Set<() => void>();
export function currentRuntimeIdentity() { return stale ? null : accepted; }
export function subscribeRuntimeIdentity(listener: () => void) { runtimeObservers.add(listener); return () => { runtimeObservers.delete(listener); }; }

function runtimeError(detail: RuntimeStaleDetail) {
    return Object.assign(new Error(detail.reason === "version" ? `当前页面是 ${detail.pageVersion}，工作台已更新为 ${detail.currentVersion}` : "工作台运行实例已经更新，请刷新页面"), {
        code: "client_runtime_stale",
        detail,
    });
}

function markStale(detail: RuntimeStaleDetail): never {
    stale = detail;
    runtimeObservers.forEach((listener) => listener());
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<RuntimeStaleDetail>(RUNTIME_STALE_EVENT, { detail }));
    throw runtimeError(detail);
}

function parseRuntime(value: unknown): RuntimeIdentity {
    const payload = value as Partial<RuntimeIdentity> | null;
    if (!payload?.appVersion || !payload.runtimeId) throw new Error("本机平台没有返回版本身份");
    return { appVersion: payload.appVersion, runtimeId: payload.runtimeId };
}

export function acceptRuntimeIdentity(value: unknown) {
    const next = parseRuntime(value);
    if (next.appVersion !== APP_VERSION) return markStale({ pageVersion: APP_VERSION, currentVersion: next.appVersion, reason: "version" });
    if (accepted && accepted.runtimeId !== next.runtimeId) return markStale({ pageVersion: APP_VERSION, currentVersion: next.appVersion, reason: "instance" });
    const changed = accepted?.runtimeId !== next.runtimeId;
    accepted = next;
    stale = null;
    if (changed) runtimeObservers.forEach((listener) => listener());
    return next;
}

export async function probeRuntimeIdentity() {
    const response = await nativeFetch("/api/local/health", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(`本机平台版本检查失败（HTTP ${response.status}）`);
    return acceptRuntimeIdentity(await response.json());
}

function staleDetail(currentVersion = APP_VERSION): RuntimeStaleDetail {
    return { pageVersion: APP_VERSION, currentVersion, reason: currentVersion !== APP_VERSION ? "version" : "instance" };
}

async function checkStaleResponse(response: Response) {
    if (response.status !== 409) return response;
    const payload = await response.clone().json().catch(() => null) as { code?: string; currentVersion?: string } | null;
    if (payload?.code === "client_runtime_stale") return markStale(staleDetail(payload.currentVersion || APP_VERSION));
    return response;
}

function isLocalMutation(input: RequestInfo | URL, init?: RequestInit) {
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (safeMethods.has(method) || typeof location === "undefined") return false;
    try {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        return url.origin === location.origin && url.pathname.startsWith("/api/local/");
    } catch {
        return false;
    }
}

export function installRuntimeFetchGuard() {
    if (fetchInstalled || typeof window === "undefined") return;
    fetchInstalled = true;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!isLocalMutation(input, init)) return nativeFetch(input, init);
        const identityHeaders = await getRuntimeRequestHeaders();
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
        Object.entries(identityHeaders).forEach(([key, value]) => headers.set(key, value));
        return checkStaleResponse(await nativeFetch(input, { ...init, headers }));
    }) as typeof fetch;
}

export async function getRuntimeRequestHeaders() {
    if (stale) throw runtimeError(stale);
    const identity = accepted || (await probeRuntimeIdentity());
    return { "x-narralight-web-version": APP_VERSION, "x-narralight-runtime-id": identity.runtimeId };
}

export function installRuntimeAxiosGuard() {
    if (axiosInstalled || typeof window === "undefined") return;
    axiosInstalled = true;
    axios.interceptors.request.use(async (config) => {
        if (!isLocalMutation(config.url || "", { method: config.method })) return config;
        const headers = AxiosHeaders.from(config.headers);
        for (const [key, value] of Object.entries(await getRuntimeRequestHeaders())) headers.set(key, value);
        config.headers = headers;
        return config;
    });
    axios.interceptors.response.use(undefined, (error) => {
        if (axios.isAxiosError(error) && error.response?.status === 409 && error.response.data?.code === "client_runtime_stale") {
            return Promise.reject(markStale(staleDetail(String(error.response.data.currentVersion || APP_VERSION))));
        }
        return Promise.reject(error);
    });
}

export function startRuntimeIdentityWatch() {
    if (typeof window === "undefined") return () => undefined;
    let timer: number | undefined;
    let checking = false;
    const check = () => {
        if (checking || stale || document.visibilityState !== "visible") return;
        checking = true;
        void probeRuntimeIdentity().catch((error) => {
            if ((error as { code?: string })?.code !== "client_runtime_stale") return;
        }).finally(() => { checking = false; });
    };
    const schedule = () => { window.clearInterval(timer); timer = window.setInterval(check, 15_000); };
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", check);
    schedule();
    return () => {
        window.clearInterval(timer);
        window.removeEventListener("focus", check);
        window.removeEventListener("pageshow", check);
        document.removeEventListener("visibilitychange", check);
    };
}
