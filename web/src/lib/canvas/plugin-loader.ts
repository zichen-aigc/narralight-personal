import { type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import { stageNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";
import { getPluginRuntime, stagePluginCSS } from "@/lib/canvas/plugin-runtime";
import { usePluginStore } from "@/stores/canvas/use-plugin-store";
import type { CanvasPlugin } from "@/types/canvas-plugin";
import i18n from "@/i18n";
import { throwApiError } from "@/services/api-error";
import { localPluginUrls, mustFetchPluginSource } from "@/lib/canvas/plugin-security";
import { useRuntimeStore } from "@/stores/use-runtime-store";

const cleanups = new Map<string, () => void>();

function once(dispose: () => void) {
    let active = true;
    return () => {
        if (!active) return;
        active = false;
        dispose();
    };
}

function disposeAll(disposers: Array<() => void>) {
    for (const dispose of [...disposers].reverse()) {
        try {
            dispose();
        } catch (error) {
            console.error("[plugin] Cleanup failed", error);
        }
    }
}

// A remote plugin may export CanvasPlugin directly or a factory that receives runtime and returns CanvasPlugin.
// The factory uses runtime.React so the bundle does not need its own React copy.
async function evaluatePluginSource(source: string): Promise<CanvasPlugin> {
    if (/\bimport\s*(?:\(\s*)?["']https?:\/\//i.test(source)) {
        throw new Error("本地安全模式拒绝插件在运行时导入远程可执行代码");
    }
    const blob = new Blob([source], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
        const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown; plugin?: unknown };
        const exported = mod.default ?? mod.plugin;
        const plugin = typeof exported === "function" ? (exported as (runtime: unknown) => unknown)(getPluginRuntime()) : exported;
        assertPlugin(plugin);
        return plugin;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function assertPlugin(plugin: unknown): asserts plugin is CanvasPlugin {
    const value = plugin as Partial<CanvasPlugin> | null;
    if (!value || typeof value !== "object") throw new Error(i18n.t("canvas.pluginErrors.invalidExport"));
    if (!value.id || !Array.isArray(value.nodes) || !value.nodes.length) throw new Error(i18n.t("canvas.pluginErrors.missingFields"));
}

function stagePluginActivation(plugin: CanvasPlugin) {
    const runtime = getPluginRuntime();
    const disposers: Array<() => void> = [];
    const commits: Array<() => void> = [];
    const track = (dispose: () => void) => {
        const tracked = once(dispose);
        disposers.push(tracked);
        return tracked;
    };
    const injectCSS = (css: string, key?: string) => {
        const staged = stagePluginCSS(css, key);
        commits.push(staged.commit);
        return track(staged.dispose);
    };
    try {
        const nodes = stageNodeDefinitions(plugin.nodes, plugin.id);
        commits.push(nodes.commit);
        track(nodes.dispose);
        const activationRuntime = {
            ...runtime,
            injectCSS,
            on: (event: string, handler: (payload: unknown) => void) => track(runtime.on(event, handler)),
        };
        // Inject declared styles when enabled and remove them when disabled or uninstalled.
        if (plugin.css) injectCSS(plugin.css, plugin.id);
        const cleanup = plugin.setup?.(activationRuntime);
        if (typeof cleanup === "function") track(cleanup);
    } catch (error) {
        disposeAll(disposers);
        throw error;
    }
    const previousCleanup = cleanups.get(plugin.id);
    let settled = false;
    return {
        commit: () => {
            if (settled) return;
            settled = true;
            commits.forEach((commit) => commit());
            previousCleanup?.();
            cleanups.set(plugin.id, () => disposeAll(disposers));
        },
        rollback: () => {
            if (settled) return;
            settled = true;
            disposeAll(disposers);
        },
    };
}

export function activatePlugin(plugin: CanvasPlugin) {
    stagePluginActivation(plugin).commit();
}

export function deactivatePlugin(pluginId: string) {
    try {
        cleanups.get(pluginId)?.();
    } finally {
        cleanups.delete(pluginId);

        unregisterPluginNodes(pluginId);
    }
}

async function fetchPluginSource(url: string) {
    const response = await fetch(url);
    if (!response.ok) await throwApiError(response, i18n.t("canvas.pluginErrors.downloadFailed", { status: response.status }));
    return response.text();
}

// Add a cache-busting parameter so watch builds load the latest output.
function withCacheBust(url: string) {
    return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

// Install or replace a plugin from a URL and enable it immediately.
// bustCache bypasses HTTP/CDN caches during upgrades while persisting a clean URL without the timestamp query.
export async function installPluginFromUrl(url: string, opts?: { official?: boolean; local?: boolean; bustCache?: boolean }) {
    if (!url.startsWith("/plugins/")) throw new Error("本地安全模式只允许安装仓库内已审核插件，远程 URL 插件已禁用");
    const profile = useRuntimeStore.getState().meta?.profile;

    const source = await fetchPluginSource(opts?.bustCache ? withCacheBust(url) : url);
    const plugin = await evaluatePluginSource(source);

    const record = {
        id: plugin.id,
        name: plugin.name || void 0 || plugin.id,
        version: plugin.version || void 0 || "0.0.0",
        description: plugin.description ?? void 0,
        url,
        source,
        enabled: true,
        official: opts?.official,
        local: opts?.local,
    };

    const activation = stagePluginActivation(plugin);
    try {
        usePluginStore.getState().upsert(record);
        activation.commit();
    } catch (error) {
        activation.rollback();
        throw error;
    }

    return plugin;
}

export async function updatePlugin(record: InstalledPlugin) {
    if (!record.local) throw new Error("本地安全模式不允许联网更新插件；请通过上游差异安全审查更新");
    // 升级必须拿到最新产物,强制绕过缓存
    return installPluginFromUrl(record.url, { official: record.official, local: record.local, bustCache: true });
}

export async function setPluginEnabled(record: InstalledPlugin, enabled: boolean) {
    const profile = useRuntimeStore.getState().meta?.profile;

    if (!enabled) {
        usePluginStore.getState().setEnabled(record.id, false);
        deactivatePlugin(record.id);

        return;
    }

    const source = mustFetchPluginSource(record) ? await fetchPluginSource(withCacheBust(record.url)) : record.source;
    const plugin = await evaluatePluginSource(source);

    activatePlugin(plugin);
    usePluginStore.getState().setEnabled(record.id, true);
    return;
}

export function uninstallPlugin(id: string) {
    deactivatePlugin(id);
    usePluginStore.getState().remove(id);
}

export function syncPluginsFromAuthority(_deleted = false) {
    return Promise.resolve(usePluginStore.persist.rehydrate()).then(() => undefined);
}

// Global platform events also reach pages that have never mounted the canvas plugin host.
// Before the host starts, synchronize only the Store; ensurePluginsLoaded owns first execution.
export function syncPluginStoreFromAuthority(_deleted = false) {
    return Promise.resolve(usePluginStore.persist.rehydrate()).then(() => undefined);
}

let loaded = false;
let loadPromise: Promise<void> | null = null;

// Load installed and enabled plugins at application startup.
export function ensurePluginsLoaded() {
    if (loaded) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = loadPlugins().finally(() => {
        loadPromise = null;
    });
    return loadPromise;
}

async function loadPlugins() {
    const identity = useRuntimeStore.getState();
    const profile = identity.meta?.profile;

    await usePluginStore.persist.rehydrate();

    await loadLocalPlugins();
    const records = usePluginStore.getState().plugins.filter((record) => record.enabled && true);
    const activated: string[] = [];
    try {
        for (const record of records) {
            try {
                const source = mustFetchPluginSource(record) ? await fetchPluginSource(withCacheBust(record.url)) : record.source;
                const plugin = await evaluatePluginSource(source);

                activatePlugin(plugin);
                activated.push(plugin.id);
            } catch (error) {
                console.error(`[plugin] Failed to load: ${record.id}`, error);
            }
        }
        await loadDevPlugins();
        loaded = true;
    } catch (error) {
        for (const pluginId of activated.reverse()) deactivatePlugin(pluginId);
        throw error;
    }
}

// Discover local plugins from web/public/plugins, add them disabled, and expose them in the manager without a URL.
// Refresh metadata and source for existing records while preserving the enabled flag so persisted versions stay current.
async function loadLocalPlugins() {
    let urls: unknown;
    try {
        const response = await fetch("/plugins/index.json");
        if (!response.ok) return;
        urls = await response.json();
    } catch {
        return; // Skip when no local manifest exists, such as production builds without plugins.
    }
    const pluginUrls = localPluginUrls(urls);
    if (!pluginUrls.length) return;
    const store = usePluginStore.getState();
    await Promise.all(
        pluginUrls.map(async (url) => {
            try {
                const source = await fetchPluginSource(withCacheBust(url));
                const plugin = await evaluatePluginSource(source);
                const existing = store.plugins.find((item) => item.id === plugin.id);
                const next = {
                    id: plugin.id,
                    name: plugin.name || plugin.id,
                    version: plugin.version || "0.0.0",
                    description: plugin.description,
                    url,
                    source,
                    enabled: existing?.enabled ?? false, // Preserve the user setting; new discoveries default to disabled.
                    local: true,
                    official: existing?.official,
                };
                if (
                    existing &&
                    existing.name === next.name &&
                    existing.version === next.version &&
                    existing.description === next.description &&
                    existing.url === next.url &&
                    existing.source === next.source &&
                    existing.enabled === next.enabled &&
                    existing.local === next.local &&
                    existing.official === next.official
                )
                    return;
                store.upsert(next);
            } catch (error) {
                console.error(`[plugin] Failed to discover local plugin: ${url}`, error);
            }
        }),
    );
}

export function resetPluginLoaderForTest() {
    for (const pluginId of [...cleanups.keys()]) deactivatePlugin(pluginId);

    loaded = false;
    loadPromise = null;
}

// During local development, refetch VITE_DEV_PLUGINS URLs without caching or persistence on every startup.
// Together with watch builds, refreshing the page loads code changes without reinstalling the plugin.
async function loadDevPlugins() {
    if (import.meta.env.VITE_UNSAFE_DEV_PLUGINS !== "true") return;
    const raw = import.meta.env.VITE_DEV_PLUGINS;
    if (!raw) return;
    const urls = raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    await Promise.all(
        urls.map(async (url) => {
            try {
                const source = await fetchPluginSource(withCacheBust(url));
                const plugin = await evaluatePluginSource(source);
                deactivatePlugin(plugin.id);
                activatePlugin(plugin);
                console.info(`[plugin] Dev plugin loaded: ${plugin.id} (${url})`);
            } catch (error) {
                console.error(`[plugin] Failed to load dev plugin: ${url}`, error);
            }
        }),
    );
}
