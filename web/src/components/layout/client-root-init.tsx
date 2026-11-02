import { Alert, Button, Spin } from "antd";
import { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { App } from "antd";

import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { stripAgentCredentialsFromHash } from "@/lib/agent/agent-url-bootstrap";
import { checkPlatformHealth, platformClientId, subscribePlatformState } from "@/lib/platform-storage";
import { RUNTIME_STALE_EVENT, startRuntimeIdentityWatch, type RuntimeStaleDetail } from "@/lib/runtime-version-guard";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { syncPluginStoreFromAuthority } from "@/lib/canvas/plugin-loader";
import { useAssetStore } from "@/stores/use-asset-store";
import { CONFIG_STORE_KEY, useConfigStore } from "@/stores/use-config-store";
import { useRuntimeStore } from "@/stores/use-runtime-store";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { shouldShowCanvasSyncNotice } from "./canvas-sync-notice";
import { probeBackendModelContracts, resetBackendModelContracts } from "@/lib/backend-model-contract";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const [platformReady, setPlatformReady] = useState<boolean | null>(null);
    const [platformError, setPlatformError] = useState("");
    const [platformRecovering, setPlatformRecovering] = useState(false);
    const [runtimeStale, setRuntimeStale] = useState<RuntimeStaleDetail | null>(null);
    const [reconnectEpoch, setReconnectEpoch] = useState(0);
    const connectedOnceRef = useRef(false);
    const identityStatus = useRuntimeStore((state) => state.status);

    const identityError = useRuntimeStore((state) => state.error);
    const initializeIdentity = useRuntimeStore((state) => state.initialize);

    const appReady = platformReady === true && identityStatus === "personal";

    useEffect(() => {
        if (!appReady || runtimeStale) {
            resetBackendModelContracts();
            return;
        }
        void probeBackendModelContracts();
        return resetBackendModelContracts;
    }, [appReady, reconnectEpoch, runtimeStale]);

    useLayoutEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        const fragmentBootstrap = stripAgentCredentialsFromHash(window.location.hash);
        const legacyQueryBootstrap = searchParams.has("agentUrl") || searchParams.has("agentToken");
        if (fragmentBootstrap || legacyQueryBootstrap) {
            sessionStorage.setItem("infinite-canvas:agent-auto-connect", "1");
            searchParams.delete("agentUrl");
            searchParams.delete("agentToken");
            window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${fragmentBootstrap?.remainingHash ?? window.location.hash}`);
        }
        localStorage.removeItem("canvas-agent-token");
        let active = true;
        let retryTimer: number | null = null;
        let retryDelay = 800;
        let reconnecting = false;
        let needsReconnect = false;
        const runtimeInvalid = (event: Event) => setRuntimeStale((event as CustomEvent<RuntimeStaleDetail>).detail);
        const stopRuntimeWatch = startRuntimeIdentityWatch();
        window.addEventListener(RUNTIME_STALE_EVENT, runtimeInvalid);
        const connected = async (recovered: boolean) => {
            if (!active) return;
            needsReconnect = false;
            connectedOnceRef.current = true;
            setPlatformReady(true);
            setPlatformRecovering(false);
            setPlatformError("");
            retryDelay = 800;
            await initializeIdentity(recovered);
            if (!active || !recovered) return;
            setReconnectEpoch((value) => value + 1);
            void message.success("本机平台连接已恢复，画布已重新核对并解除只读");
        };
        const scheduleReconnect = () => {
            if (!active || retryTimer !== null || reconnecting) return;
            retryTimer = window.setTimeout(async () => {
                retryTimer = null;
                reconnecting = true;
                try {
                    await checkPlatformHealth();
                    await connected(true);
                } catch (error) {
                    if (!active) return;
                    setPlatformError(error instanceof Error ? error.message : String(error));
                    retryDelay = Math.min(Math.round(retryDelay * 1.7), 10000);
                } finally {
                    reconnecting = false;
                    if (active && needsReconnect) scheduleReconnect();
                }
            }, retryDelay);
        };
        void checkPlatformHealth()
            .then(() => connected(false))
            .catch((error) => {
                if (!active) return;
                setPlatformError(error instanceof Error ? error.message : String(error));
                setPlatformReady(false);
                setPlatformRecovering(true);
                needsReconnect = true;
                scheduleReconnect();
            });
        const offline = (event: Event) => {
            setPlatformError(String((event as CustomEvent).detail || "本地平台服务已断开"));
            setPlatformRecovering(true);
            needsReconnect = true;
            if (!connectedOnceRef.current) setPlatformReady(false);
            scheduleReconnect();
        };
        window.addEventListener("infinite-canvas:platform-offline", offline);
        return () => {
            active = false;
            stopRuntimeWatch();
            if (retryTimer !== null) window.clearTimeout(retryTimer);
            window.removeEventListener("infinite-canvas:platform-offline", offline);
            window.removeEventListener(RUNTIME_STALE_EVENT, runtimeInvalid);
        };
    }, [initializeIdentity, message]);

    useEffect(() => {
        if (!appReady) return;
        const stores: Record<string, { rehydrate: () => Promise<void> | void }> = {
            "infinite-canvas:canvas_store": useCanvasStore.persist,
            "infinite-canvas:asset_store": useAssetStore.persist,
            [CONFIG_STORE_KEY]: useConfigStore.persist,
            "infinite-canvas:prompt_source_store_v2": usePromptSourceStore.persist,
            "infinite-canvas:theme_store": useThemeStore.persist,
        };
        void Promise.all([useConfigStore.persist.rehydrate(), usePromptSourceStore.persist.rehydrate(), useThemeStore.persist.rehydrate()]).catch((error) => {
            void message.error(error instanceof Error ? error.message : "读取统一存储失败");
        });
        const pending = new Map<string, Promise<void>>();
        const lastNoticeAt = new Map<string, number>();
        const unsubscribe = subscribePlatformState((event) => {
            const store = event.key === "infinite-canvas:plugin_store" ? { rehydrate: () => syncPluginStoreFromAuthority(event.deleted) } : stores[event.key];
            if (!store) return;
            if (event.key === "infinite-canvas:canvas_store" && !useCanvasStore.persist.hasHydrated()) return;
            if (event.key === "infinite-canvas:asset_store" && !useAssetStore.persist.hasHydrated()) return;
            const previous = pending.get(event.key) || Promise.resolve();
            const current = previous
                .catch(() => undefined)
                .then(async () => {
                    await store.rehydrate();
                    if (shouldShowCanvasSyncNotice(event, window.location.pathname, platformClientId)) {
                        const now = Date.now();
                        const resource = event.leaseResource!;
                        if (now - (lastNoticeAt.get(resource) || 0) > 3000) {
                            lastNoticeAt.set(resource, now);
                            void message.info("同一画布已在另一个浏览器更新，当前页面已同步");
                        }
                    }
                });
            pending.set(event.key, current);
            const clearPending = () => {
                if (pending.get(event.key) === current) pending.delete(event.key);
            };
            void current.then(clearPending, clearPending);
        });
        const conflict = () => void message.error("检测到跨浏览器写入冲突，已停止覆盖；请刷新页面确认最新版本");
        const readonly = () => void message.warning("当前画布由另一个浏览器编辑，本页面已停止写入");
        window.addEventListener("infinite-canvas:platform-conflict", conflict);
        window.addEventListener("infinite-canvas:platform-readonly", readonly);
        return () => {
            unsubscribe();
            window.removeEventListener("infinite-canvas:platform-conflict", conflict);
            window.removeEventListener("infinite-canvas:platform-readonly", readonly);
        };
    }, [appReady, message, reconnectEpoch]);

    if (runtimeStale)
        return (
            <div className="mx-auto flex h-screen max-w-2xl items-center px-6">
                <Alert
                    type="warning"
                    showIcon
                    title="当前页面版本已停止操作"
                    description={
                        runtimeStale.reason === "version"
                            ? `这个页面是 ${runtimeStale.pageVersion}，当前工作台是 ${runtimeStale.currentVersion}。为避免旧页面改动当前数据，请刷新后继续。`
                            : "本机工作台已经重新启动。为避免旧页面继续修改数据，请刷新后进入当前运行实例。"
                    }
                    action={
                        <Button type="primary" onClick={() => window.location.reload()}>
                            刷新进入当前版本
                        </Button>
                    }
                />
            </div>
        );

    if (platformReady === null)
        return (
            <div className="flex h-screen items-center justify-center">
                <Spin description="正在连接本机统一数据平台" />
            </div>
        );
    if (!platformReady)
        return (
            <div className="mx-auto flex h-screen max-w-2xl items-center px-6">
                <Alert
                    type="error"
                    showIcon
                    title="本机统一数据平台未连接，画布已锁定为不可操作状态"
                    description={platformError || "请先启动叙光本机平台服务。为防止不同浏览器形成独立副本，本页面不会回退到浏览器存储。"}
                    action={<Button onClick={() => window.location.reload()}>重新连接</Button>}
                />
            </div>
        );

    if (identityStatus === "idle" || identityStatus === "loading")
        return (
            <div className="flex h-screen items-center justify-center">
                <Spin description="正在读取部署配置" />
            </div>
        );
    if (identityStatus === "error")
        return (
            <div className="mx-auto flex h-screen max-w-2xl items-center px-6">
                <Alert
                    type="error"
                    showIcon
                    title="无法确认工作台部署配置"
                    description={identityError || "请检查本机平台配置后重试。"}
                    action={<Button onClick={() => void initializeIdentity(true)}>重新读取</Button>}
                />
            </div>
        );

    return (
        <>
            <PlatformSchedulers />
            {children}
            {platformRecovering ? (
                <div className="pointer-events-none fixed inset-x-0 top-3 z-[1000] flex justify-center px-4">
                    <Alert
                        className="pointer-events-auto max-w-2xl shadow-lg"
                        type="warning"
                        showIcon
                        title="连接暂时中断，画布已保留为只读"
                        description={platformError ? `${platformError}；正在自动重连，恢复前不会写入或排队任何更改。` : "正在自动重连，恢复前不会写入或排队任何更改。"}
                    />
                </div>
            ) : null}
        </>
    );
}

function PlatformSchedulers() {
    usePromptSourceScheduler();
    return null;
}
