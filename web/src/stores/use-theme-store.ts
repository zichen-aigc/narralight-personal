import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { platformStorage } from "@/lib/platform-storage";

export type ThemeName = "light" | "dark";
export const THEME_BOOTSTRAP_STORAGE_KEY = "infinite-canvas:theme_bootstrap";
export const THEME_STORE_VERSION = 1;

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

export function migrateThemePreference(persistedState: unknown, version: number) {
    const state = persistedState && typeof persistedState === "object" ? persistedState as Partial<ThemeStore> : {};
    const theme: ThemeName = version < THEME_STORE_VERSION || state.theme !== "light" ? "dark" : "light";
    return { ...state, theme } as ThemeStore;
}

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: "dark",
            setTheme: (theme) => set({ theme }),
        }),
        {
            name: "infinite-canvas:theme_store",
            storage: createJSONStorage(() => platformStorage),
            version: THEME_STORE_VERSION,
            migrate: migrateThemePreference,
            skipHydration: true,
        },
    ),
);
