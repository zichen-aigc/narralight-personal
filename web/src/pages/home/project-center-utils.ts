import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";

export function getProjectCover(project?: CanvasProject) {
    if (!project) return "";
    for (const node of project.nodes) {
        const candidates = [node.metadata?.images?.find((image) => image.status === "success")?.content, node.metadata?.content];
        const cover = candidates.find((value) => typeof value === "string" && /^(data:image\/|blob:|https?:\/\/)/.test(value));
        if (cover) return cover;
    }
    return "";
}

export function getProjectMediaCount(project?: CanvasProject) {
    if (!project) return 0;
    return project.nodes.filter((node) => node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio).length;
}
