import { create } from "zustand";
import { getLocalPlatformMeta, type LocalPlatformMeta } from "@/services/api/platform-request";
type RuntimeStatus = "idle" | "loading" | "personal" | "error";
type RuntimeStore = { status: RuntimeStatus; meta: LocalPlatformMeta | null; error: string; initialize: (force?: boolean) => Promise<void> };
let initializationPromise: Promise<void> | null = null;
export const useRuntimeStore = create<RuntimeStore>((set, get) => ({
    status: "idle",
    meta: null,
    error: "",
    initialize: async (force = false) => {
        if (!force && initializationPromise) return initializationPromise;
        if (!force && get().meta && get().status !== "error") return;
        initializationPromise = (async () => {
            set({ status: "loading", error: "" });
            try {
                const meta = await getLocalPlatformMeta();
                if (meta.profile !== "personal_local") throw new Error("连接的服务配置不兼容");
                set({ meta, status: "personal", error: "" });
            } catch (error) {
                set({ status: "error", error: error instanceof Error ? error.message : String(error) });
            }
        })();
        try {
            await initializationPromise;
        } finally {
            initializationPromise = null;
        }
    },
}));
