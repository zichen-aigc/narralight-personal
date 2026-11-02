import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasLatestProjectState = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type LatestStateRefs = { [Key in keyof CanvasLatestProjectState]: { current: CanvasLatestProjectState[Key] } };

export function syncCanvasLatestStateRefs(refs: LatestStateRefs, state: CanvasLatestProjectState) {
    refs.nodes.current = state.nodes;
    refs.connections.current = state.connections;
    refs.chatSessions.current = state.chatSessions;
    refs.activeChatId.current = state.activeChatId;
    refs.backgroundMode.current = state.backgroundMode;
    refs.showImageInfo.current = state.showImageInfo;
    refs.viewport.current = state.viewport;
}

export function isCanvasStructureDamaged(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return nodes.length === 0 && connections.length > 0;
}
