import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { canvasBackgroundWorkDelay } from "@/lib/canvas/canvas-performance";
import { isCanvasStructureDamaged } from "@/lib/canvas/canvas-state-safety";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasDeletedProject = { id: string; deletedAt: string };

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => boolean;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
export const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects" | "deletedProjects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let queuedPersistValue: { name: string; value: StorageValue<CanvasStore> } | null = null;
let persistInFlight: Promise<void> | null = null;
let renameInFlight: Promise<CanvasProject> | null = null;
let renamingRemote = false;

function startCanvasStorePersistence(): Promise<void> {
    if (renamingRemote) return renameInFlight!.then(startCanvasStorePersistence, startCanvasStorePersistence);
    if (persistInFlight) return persistInFlight;
    const pending = queuedPersistValue;
    if (!pending) return Promise.resolve();
    queuedPersistValue = null;
    let operation!: Promise<void>;
    operation = (async () => {
        try {
            await localForageStorage.setItem(pending.name, JSON.stringify(pending.value));
        } catch (error) {
            if (!queuedPersistValue) queuedPersistValue = pending;
            throw error;
        } finally {
            if (persistInFlight === operation) persistInFlight = null;
        }
    })();
    persistInFlight = operation;
    return operation;
}

async function drainCanvasStorePersistence() {
    while (persistInFlight || queuedPersistValue) {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        await startCanvasStorePersistence();
    }
}

export function flushCanvasStorePersistence() {
    return drainCanvasStorePersistence();
}

function scheduleCanvasStorePersistence(delay = 400) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        const retryDelay = canvasBackgroundWorkDelay(typeof document === "undefined" ? null : document);
        if (retryDelay > 0) {
            scheduleCanvasStorePersistence(retryDelay);
            return;
        }
        void drainCanvasStorePersistence().catch(() => undefined);
    }, delay);
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects && queuedPersistState.deletedProjects === nextState.deletedProjects) return;
        queuedPersistState = nextState;
        queuedPersistValue = { name, value };
        scheduleCanvasStorePersistence();
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            deletedProjects: [],
            createProject: (title = i18n.t("canvas.project.untitled")) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || i18n.t("canvas.project.imported"),
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const removed = new Set(ids);
                    const deletedAt = new Date().toISOString();
                    return { projects: state.projects.filter((project) => !removed.has(project.id)), deletedProjects: [...state.deletedProjects.filter((item) => !removed.has(item.id)), ...ids.map((id) => ({ id, deletedAt }))] };
                }),
            replaceProjects: (projects, deletedProjects = []) => set({ projects, deletedProjects }),
            updateProject: (id, patch) => {
                const project = get().projects.find((item) => item.id === id);
                if (!project || isCanvasStructureDamaged(patch.nodes ?? project.nodes, patch.connections ?? project.connections)) return false;
                set((state) => ({
                    projects: state.projects.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item)),
                }));
                return true;
            },
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            skipHydration: true,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    deletedProjects: state.deletedProjects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);

export async function createPersistedCanvasProject(title?: string) {
    const previousProjects = useCanvasStore.getState().projects;
    const previousDeletedProjects = useCanvasStore.getState().deletedProjects;
    const id = useCanvasStore.getState().createProject(title);
    try {
        await flushCanvasStorePersistence();
        return id;
    } catch (error) {
        useCanvasStore.getState().replaceProjects(previousProjects, previousDeletedProjects);
        await flushCanvasStorePersistence().catch(() => undefined);
        throw error;
    }
}

// Confirm the title write before changing UI state. Hold background writes so a
// concurrent canvas edit cannot write the old title back over the confirmed name.
export function renamePersistedCanvasProject(id: string, title: string): Promise<CanvasProject> {
    const name = title.trim();
    if (!name || name.length > 200) return Promise.reject(new Error("项目名称需为1至200个字符"));
    if (renameInFlight) return Promise.reject(new Error("正在保存项目名称，请稍候"));
    const operation = (async () => {
        await flushCanvasStorePersistence();
        const projects = useCanvasStore.getState().projects;
        const previous = projects.find((project) => project.id === id);
        if (!previous) throw new Error("项目不存在或已无访问权限，请重新打开项目列表");
        if (previous.title === name) return previous;
        const renamed = { ...previous, title: name, updatedAt: new Date().toISOString() };
        renamingRemote = true;
        try {
            await localForageStorage.setItem(CANVAS_STORE_KEY, JSON.stringify({
                state: { projects: projects.map((project) => project.id === id ? renamed : project), deletedProjects: useCanvasStore.getState().deletedProjects },
                version: useCanvasStore.persist.getOptions().version ?? 0,
            }));
            const current = useCanvasStore.getState().projects;
            const updated = current.map((project) => project.id === id ? { ...project, title: name, updatedAt: renamed.updatedAt } : project);
            // An unchanged snapshot is already persisted; retain any concurrent
            // local edits in the normal queue instead of dropping or rehydrating them.
            if (current === projects) queuedPersistState = { projects: updated, deletedProjects: useCanvasStore.getState().deletedProjects };
            useCanvasStore.setState({ projects: updated });
            return renamed;
        } finally {
            renamingRemote = false;
        }
    })();
    renameInFlight = operation;
    void operation.finally(() => {
        if (renameInFlight === operation) renameInFlight = null;
        if (queuedPersistValue) scheduleCanvasStorePersistence();
    }).catch(() => undefined);
    return operation;
}
