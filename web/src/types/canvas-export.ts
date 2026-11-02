import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { PersistedGenerationTask } from "@/services/generation-task";
import type { VideoGenerationTake } from "@/services/video-generation-take";

export type CanvasExportFile = {
    app: "infinite-canvas";
    version: 3 | 4;
    exportedAt: string;
    projects: CanvasProjectExportItem[];
};

export type CanvasProjectExportItem = {
    project: CanvasProject;
    files: CanvasExportAsset[];
    generationTasks?: PersistedGenerationTask[];
    videoGenerationTakes?: VideoGenerationTake[];
    videoNodeHistory?: CanvasVideoNodeHistory[];
};

export type CanvasVideoNodeHistory = { nodeId: string; activeTakeId: string | null; createdAt?: string; updatedAt?: string };

export type CanvasProjectSnapshot = {
    version: 1;
    projectId: string;
    generationTasks: PersistedGenerationTask[];
    videoGenerationTakes: VideoGenerationTake[];
    videoNodeHistory: CanvasVideoNodeHistory[];
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
    sha256?: string;
};
