import { create } from "zustand";
import { createJSONStorage, persist, type PersistStorage } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import { readPlatformStateAuthority } from "@/lib/platform-storage";

export type InstalledPlugin = {
    id: string;
    name: string;
    version: string;
    description?: string;
    url: string; // Installation source used for updates.
    source: string; // Cached plugin source for offline use and pinned versions.
    enabled: boolean;
    local?: boolean; // Local plugin discovered in web/public/plugins; disabled by default and refetched from its URL when enabled.
    official?: boolean; // Installed from the official registry and grouped accordingly in the manager.
    installedAt: string;
};

type InstalledPluginInput = Omit<InstalledPlugin, "installedAt"> & { installedAt?: string };

type PluginStore = {
    plugins: InstalledPlugin[];
    upsert: (plugin: InstalledPluginInput) => void;
    setEnabled: (id: string, enabled: boolean) => void;
    remove: (id: string) => void;
};

const PLUGIN_STORE_NAME = "infinite-canvas:plugin_store";
const persistedPluginStorage = createJSONStorage<PluginStore>(() => localForageStorage)!;
const authoritativePluginStorage = createJSONStorage<PluginStore>(() => ({ ...localForageStorage, getItem: readPlatformStateAuthority }))!;
type AuthorityPersistStorage = PersistStorage<PluginStore> & { getAuthoritativeItem?: PersistStorage<PluginStore>["getItem"] };

const pluginStorage: AuthorityPersistStorage = {
    getItem: (...args) => persistedPluginStorage.getItem(...args),
    getAuthoritativeItem: (...args) => authoritativePluginStorage.getItem(...args),
    setItem: (name, value) => {
        return persistedPluginStorage.setItem(name, value);
    },
    removeItem: (...args) => persistedPluginStorage.removeItem(...args),
};

function upsertPlugin(plugins: InstalledPlugin[], plugin: InstalledPluginInput) {
    const installedAt = plugin.installedAt || new Date().toISOString();
    const exists = plugins.some((item) => item.id === plugin.id);
    const next = { ...plugin, installedAt };
    return exists ? plugins.map((item) => (item.id === plugin.id ? next : item)) : [next, ...plugins];
}

export const usePluginStore = create<PluginStore>()(
    persist(
        (set) => ({
            plugins: [],
            upsert: (plugin) => set((state) => ({ plugins: upsertPlugin(state.plugins, plugin) })),
            setEnabled: (id, enabled) => set((state) => ({ plugins: state.plugins.map((item) => (item.id === id ? { ...item, enabled } : item)) })),
            remove: (id) => set((state) => ({ plugins: state.plugins.filter((item) => item.id !== id) })),
        }),
        {
            name: PLUGIN_STORE_NAME,
            storage: pluginStorage,
            skipHydration: true,
        },
    ),
);
