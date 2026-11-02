import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

export type CanvasRenderMode = "overview" | "thumbnail" | "work";

export const CANVAS_OVERVIEW_MAX_SCALE = 0.14;
export const CANVAS_THUMBNAIL_MAX_SCALE = 0.42;
export const CANVAS_OVERVIEW_MEDIA_CLUSTER_LIMIT = 8;
export const CANVAS_THUMBNAIL_MEDIA_NODE_LIMIT = 36;
export const CANVAS_AMBIENT_CONNECTION_LIMIT = 72;
export const CANVAS_FOCUS_CONNECTION_LIMIT = 96;
export const CANVAS_LINEAGE_CONNECTION_LIMIT = 160;
const CANVAS_OVERVIEW_EXIT_SCALE = 0.17;
const CANVAS_WORK_ENTER_SCALE = 0.48;
const CANVAS_WORK_EXIT_SCALE = 0.36;
const CANVAS_SPATIAL_CELL_SIZE = 1200;
const CANVAS_WORK_WORLD_PADDING = 280;
const CANVAS_WORK_SCREEN_PADDING = 480;
const CANVAS_THUMBNAIL_WORLD_PADDING = 120;
const CANVAS_THUMBNAIL_SCREEN_PADDING = 240;
export const CANVAS_BACKGROUND_WORK_QUIET_MS = 320;

type CanvasActivityRoot = Pick<ParentNode, "querySelectorAll">;

export function canvasBackgroundWorkDelay(root: CanvasActivityRoot | null | undefined, now = performance.now(), quietMs = CANVAS_BACKGROUND_WORK_QUIET_MS) {
    const canvases = root?.querySelectorAll<HTMLElement>("[data-canvas-interacting='true'],[data-canvas-idle-since]");
    if (!canvases?.length) return 0;
    let remaining = 0;
    for (const canvas of canvases) {
        if (canvas.dataset.canvasInteracting === "true") return quietMs;
        const idleSince = Number(canvas.dataset.canvasIdleSince);
        if (!Number.isFinite(idleSince)) continue;
        remaining = Math.max(remaining, Math.min(quietMs, quietMs - Math.max(0, now - idleSince)));
    }
    return Math.max(0, Math.ceil(remaining));
}

export type CanvasDetailRestorePlanInput = {
    viewportSize: { width: number; height: number };
    devicePixelRatio: number;
    visibleNodeCount: number;
    mediaNodeCount: number;
    videoNodeCount: number;
    previousRestoreMs?: number;
};

export function canvasDetailRestorePlan({ viewportSize, devicePixelRatio, visibleNodeCount, mediaNodeCount, videoNodeCount, previousRestoreMs = 0 }: CanvasDetailRestorePlanInput) {
    const physicalMegapixels = Math.min(Math.max((Math.max(viewportSize.width, 1) * Math.max(viewportSize.height, 1) * Math.max(devicePixelRatio, 1) ** 2) / 1_000_000, 0.5), 16);
    const weightedNodeCost = Math.max(visibleNodeCount, 0) + Math.max(mediaNodeCount, 0) * 2 + Math.max(videoNodeCount, 0) * 4;
    const quietMs = Math.min(Math.max(Math.round(70 + physicalMegapixels * 7 + Math.sqrt(weightedNodeCost) * 12 + Math.min(Math.max(previousRestoreMs, 0), 500) * 0.3), 120), 360);
    const idleTimeoutMs = Math.min(Math.max(Math.round(quietMs + 160 + Math.min(Math.max(previousRestoreMs, 0), 500) * 0.5), 280), 800);
    return { quietMs, idleTimeoutMs };
}

export function canvasRenderMode(scale: number): CanvasRenderMode {
    if (scale < CANVAS_OVERVIEW_MAX_SCALE) return "overview";
    return scale < CANVAS_THUMBNAIL_MAX_SCALE ? "thumbnail" : "work";
}

export function canvasStableRenderMode(scale: number, previous: CanvasRenderMode): CanvasRenderMode {
    if (previous === "overview") {
        if (scale < CANVAS_OVERVIEW_EXIT_SCALE) return "overview";
        return scale >= CANVAS_WORK_ENTER_SCALE ? "work" : "thumbnail";
    }
    if (previous === "work") {
        if (scale >= CANVAS_WORK_EXIT_SCALE) return "work";
        return scale < CANVAS_OVERVIEW_MAX_SCALE ? "overview" : "thumbnail";
    }
    if (scale < CANVAS_OVERVIEW_MAX_SCALE) return "overview";
    return scale >= CANVAS_WORK_ENTER_SCALE ? "work" : "thumbnail";
}

export function canvasInteractionDetail(mode: CanvasRenderMode, locked: boolean): "minimal" | "preview" | "full" {
    if (!locked) return "full";
    return mode === "overview" ? "minimal" : "preview";
}

export type CanvasInteractionPreviewPlan = {
    bounds: { left: number; top: number; width: number; height: number };
    pixelScale: number;
    pixelWidth: number;
    pixelHeight: number;
    pixelBudget: number;
};

export function canvasInteractionPreviewPlan(viewport: ViewportTransform, viewportSize: { width: number; height: number }, devicePixelRatio: number, mode: Exclude<CanvasRenderMode, "overview">): CanvasInteractionPreviewPlan {
    const scale = Math.max(viewport.k, 0.05);
    const width = Math.max(viewportSize.width, 1);
    const height = Math.max(viewportSize.height, 1);
    const padding = canvasViewportPadding(mode, scale, viewportSize);
    const bounds = {
        left: -viewport.x / scale - padding,
        top: -viewport.y / scale - padding,
        width: width / scale + padding * 2,
        height: height / scale + padding * 2,
    };
    const dpr = Math.min(Math.max(devicePixelRatio || 1, 1), 3);
    const physicalPixels = width * height * dpr * dpr;
    const pixelBudget = Math.min(Math.max(physicalPixels * (mode === "work" ? 1.4 : 1.05), 4_000_000), mode === "work" ? 12_000_000 : 8_000_000);
    const desiredPixelScale = scale * dpr;
    const pixelScale = Math.max(0.02, Math.min(desiredPixelScale, 8192 / bounds.width, 8192 / bounds.height, Math.sqrt(pixelBudget / Math.max(bounds.width * bounds.height, 1))));
    return {
        bounds,
        pixelScale,
        pixelWidth: Math.max(1, Math.ceil(bounds.width * pixelScale)),
        pixelHeight: Math.max(1, Math.ceil(bounds.height * pixelScale)),
        pixelBudget,
    };
}

export function canvasViewportPadding(mode: CanvasRenderMode, scale: number, viewportSize?: { width: number; height: number }) {
    const safeScale = Math.max(scale, 0.05);
    const viewportFactor = viewportSize
        ? Math.min(Math.max(Math.sqrt((Math.max(viewportSize.width, 1) * Math.max(viewportSize.height, 1)) / (1200 * 720)), 0.75), 2)
        : 1;
    if (mode === "work") return Math.max(CANVAS_WORK_WORLD_PADDING, (CANVAS_WORK_SCREEN_PADDING * viewportFactor) / safeScale);
    return Math.max(CANVAS_THUMBNAIL_WORLD_PADDING, (CANVAS_THUMBNAIL_SCREEN_PADDING * viewportFactor) / safeScale);
}

export function canvasViewportNodes(nodes: CanvasNodeData[], viewport: ViewportTransform, viewportSize: { width: number; height: number }, padding = 280) {
    const scale = Math.max(viewport.k, 0.05);
    const left = -viewport.x / scale - padding;
    const top = -viewport.y / scale - padding;
    const right = left + viewportSize.width / scale + padding * 2;
    const bottom = top + viewportSize.height / scale + padding * 2;
    return nodes.filter((node) => node.position.x + node.width > left && node.position.x < right && node.position.y + node.height > top && node.position.y < bottom);
}

export type CanvasSpatialIndex = {
    cellSize: number;
    nodes: CanvasNodeData[];
    buckets: Map<string, number[]>;
};

export function buildCanvasSpatialIndex(nodes: CanvasNodeData[], cellSize = CANVAS_SPATIAL_CELL_SIZE): CanvasSpatialIndex {
    const buckets = new Map<string, number[]>();
    const append = (key: string, index: number) => {
        const current = buckets.get(key);
        if (current) current.push(index);
        else buckets.set(key, [index]);
    };
    nodes.forEach((node, index) => {
        const left = Math.floor(node.position.x / cellSize);
        const top = Math.floor(node.position.y / cellSize);
        const right = Math.floor((node.position.x + Math.max(node.width, 1)) / cellSize);
        const bottom = Math.floor((node.position.y + Math.max(node.height, 1)) / cellSize);
        for (let x = left; x <= right; x += 1) for (let y = top; y <= bottom; y += 1) append(`${x}:${y}`, index);
    });
    return { cellSize, nodes, buckets };
}

export function queryCanvasSpatialIndex(index: CanvasSpatialIndex, viewport: ViewportTransform, viewportSize: { width: number; height: number }, padding = 280) {
    const scale = Math.max(viewport.k, 0.05);
    const left = -viewport.x / scale - padding;
    const top = -viewport.y / scale - padding;
    const right = left + viewportSize.width / scale + padding * 2;
    const bottom = top + viewportSize.height / scale + padding * 2;
    const firstX = Math.floor(left / index.cellSize);
    const firstY = Math.floor(top / index.cellSize);
    const lastX = Math.floor(right / index.cellSize);
    const lastY = Math.floor(bottom / index.cellSize);
    const matches = new Set<number>();
    for (let x = firstX; x <= lastX; x += 1) for (let y = firstY; y <= lastY; y += 1) index.buckets.get(`${x}:${y}`)?.forEach((nodeIndex) => matches.add(nodeIndex));
    return [...matches]
        .sort((a, b) => a - b)
        .map((nodeIndex) => index.nodes[nodeIndex])
        .filter((node) => node.position.x + node.width > left && node.position.x < right && node.position.y + node.height > top && node.position.y < bottom);
}

export type CanvasGraphIndex = {
    nodeById: Map<string, CanvasNodeData>;
    connectionById: Map<string, CanvasConnection>;
    incomingByNodeId: Map<string, CanvasConnection[]>;
    outgoingByNodeId: Map<string, CanvasConnection[]>;
    childrenByGroupId: Map<string, CanvasNodeData[]>;
};

export function buildCanvasGraphIndex(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasGraphIndex {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const connectionById = new Map<string, CanvasConnection>();
    const incomingByNodeId = new Map<string, CanvasConnection[]>();
    const outgoingByNodeId = new Map<string, CanvasConnection[]>();
    const childrenByGroupId = new Map<string, CanvasNodeData[]>();
    const append = (map: Map<string, CanvasConnection[]>, id: string, connection: CanvasConnection) => {
        const current = map.get(id);
        if (current) current.push(connection);
        else map.set(id, [connection]);
    };

    connections.forEach((connection) => {
        connectionById.set(connection.id, connection);
        append(outgoingByNodeId, connection.fromNodeId, connection);
        append(incomingByNodeId, connection.toNodeId, connection);
    });
    nodes.forEach((node) => {
        const groupId = node.metadata?.groupId;
        if (groupId && nodeById.get(groupId)?.type === CanvasNodeType.Group) {
            const current = childrenByGroupId.get(groupId);
            if (current) current.push(node);
            else childrenByGroupId.set(groupId, [node]);
        }
    });

    return { nodeById, connectionById, incomingByNodeId, outgoingByNodeId, childrenByGroupId };
}

export function canvasFocusConnections(index: CanvasGraphIndex, focusNodeIds: Iterable<string>, selectedConnectionId: string | null, mode: CanvasRenderMode, limit = CANVAS_FOCUS_CONNECTION_LIMIT) {
    const result = new Map<string, CanvasConnection>();
    if (selectedConnectionId) {
        const selected = index.connectionById.get(selectedConnectionId);
        if (selected) result.set(selected.id, selected);
    }
    if (mode === "overview") return [...result.values()];

    for (const nodeId of focusNodeIds) {
        index.incomingByNodeId.get(nodeId)?.forEach((connection) => result.set(connection.id, connection));
        index.outgoingByNodeId.get(nodeId)?.forEach((connection) => result.set(connection.id, connection));
        if (result.size >= limit) break;
    }
    return [...result.values()].slice(0, limit);
}

export function canvasVisibleConnectionSubset(connections: Iterable<CanvasConnection>, visibleNodeIds: ReadonlySet<string>, limit: number) {
    const result: CanvasConnection[] = [];
    for (const connection of connections) {
        if (!visibleNodeIds.has(connection.fromNodeId) || !visibleNodeIds.has(connection.toNodeId)) continue;
        result.push(connection);
        if (result.length >= limit) break;
    }
    return result;
}

export function canvasAmbientConnections(index: CanvasGraphIndex, visibleNodeIds: ReadonlySet<string>, mode: CanvasRenderMode, limit = CANVAS_AMBIENT_CONNECTION_LIMIT) {
    if (mode === "overview") return [];
    return [...index.connectionById.values()]
        .filter((connection) => visibleNodeIds.has(connection.fromNodeId) && visibleNodeIds.has(connection.toNodeId))
        .sort((left, right) => connectionLengthSquared(index, left) - connectionLengthSquared(index, right) || left.id.localeCompare(right.id))
        .slice(0, limit);
}

function connectionLengthSquared(index: CanvasGraphIndex, connection: CanvasConnection) {
    const from = index.nodeById.get(connection.fromNodeId);
    const to = index.nodeById.get(connection.toNodeId);
    if (!from || !to) return Number.MAX_SAFE_INTEGER;
    const dx = to.position.x + to.width / 2 - from.position.x - from.width / 2;
    const dy = to.position.y + to.height / 2 - from.position.y - from.height / 2;
    return dx * dx + dy * dy;
}

export function buildCanvasLineage(index: CanvasGraphIndex, rootNodeId: string) {
    if (!index.nodeById.has(rootNodeId)) return { nodeIds: new Set<string>(), connections: [] as CanvasConnection[] };
    const nodeIds = new Set([rootNodeId]);
    const connections = new Map<string, CanvasConnection>();
    const walk = (adjacentByNodeId: Map<string, CanvasConnection[]>, nextNodeId: (connection: CanvasConnection) => string) => {
        const visited = new Set([rootNodeId]);
        const queue = [rootNodeId];
        while (queue.length) {
            const nodeId = queue.shift()!;
            (adjacentByNodeId.get(nodeId) || []).forEach((connection) => {
                connections.set(connection.id, connection);
                const nextId = nextNodeId(connection);
                nodeIds.add(nextId);
                if (visited.has(nextId)) return;
                visited.add(nextId);
                queue.push(nextId);
            });
        }
    };
    walk(index.incomingByNodeId, (connection) => connection.fromNodeId);
    walk(index.outgoingByNodeId, (connection) => connection.toNodeId);
    return { nodeIds, connections: [...connections.values()] };
}

export function buildCanvasLodPosterMap(index: CanvasGraphIndex, maxDepth = 3) {
    const posters = new Map<string, string>();
    index.nodeById.forEach((node) => {
        if (node.type !== CanvasNodeType.Video) return;
        const queue = [{ nodeId: node.id, depth: 0 }];
        const visited = new Set([node.id]);
        let poster: string | undefined;
        while (queue.length && !poster) {
            const current = queue.shift()!;
            if (current.depth >= maxDepth) continue;
            for (const connection of index.incomingByNodeId.get(current.nodeId) || []) {
                const source = index.nodeById.get(connection.fromNodeId);
                if (!source || visited.has(source.id)) continue;
                visited.add(source.id);
                if (source.type === CanvasNodeType.Image && source.metadata?.content) {
                    poster = source.metadata.content;
                    break;
                }
                queue.push({ nodeId: source.id, depth: current.depth + 1 });
            }
        }
        if (!poster && node.metadata?.groupId) {
            poster = index.childrenByGroupId.get(node.metadata.groupId)?.find((child) => child.type === CanvasNodeType.Image && child.metadata?.content)?.metadata?.content;
        }
        if (poster) posters.set(node.id, poster);
    });
    return posters;
}

export type CanvasOverviewCluster = {
    id: string;
    nodeId?: string;
    title: string;
    count: number;
    position: { x: number; y: number };
    width: number;
    height: number;
    layoutNodes: CanvasNodeData[];
    previewNodes: CanvasNodeData[];
};

export function canvasClusterViewport(cluster: CanvasOverviewCluster, viewportSize: { width: number; height: number }): ViewportTransform {
    const worldX = cluster.position.x + cluster.width / 2;
    const worldY = cluster.position.y + cluster.height / 2;
    const k = Math.min(Math.max(Math.min((viewportSize.width * 0.72) / cluster.width, (viewportSize.height * 0.72) / cluster.height), 0.18), 0.85);
    return { x: viewportSize.width / 2 - worldX * k, y: viewportSize.height / 2 - worldY * k, k };
}

const OVERVIEW_BUCKET_WIDTH = 2200;
const OVERVIEW_BUCKET_HEIGHT = 1500;

export function buildCanvasOverviewClusters(nodes: CanvasNodeData[]): CanvasOverviewCluster[] {
    const groups = nodes.filter((node) => node.type === CanvasNodeType.Group);
    const groupIds = new Set(groups.map((node) => node.id));
    const childrenByGroupId = new Map<string, CanvasNodeData[]>();
    const buckets = new Map<string, CanvasNodeData[]>();

    nodes.forEach((node) => {
        if (node.type === CanvasNodeType.Group) return;
        const groupId = node.metadata?.groupId;
        if (groupId && groupIds.has(groupId)) {
            const current = childrenByGroupId.get(groupId);
            if (current) current.push(node);
            else childrenByGroupId.set(groupId, [node]);
            return;
        }
        const bucketX = Math.floor(node.position.x / OVERVIEW_BUCKET_WIDTH);
        const bucketY = Math.floor(node.position.y / OVERVIEW_BUCKET_HEIGHT);
        const key = `${bucketX}:${bucketY}`;
        const current = buckets.get(key);
        if (current) current.push(node);
        else buckets.set(key, [node]);
    });

    const grouped = groups.map((group) => {
        const children = childrenByGroupId.get(group.id) || [];
        return { id: `group:${group.id}`, nodeId: group.id, title: group.title || "分组", count: children.length, position: group.position, width: group.width, height: group.height, layoutNodes: children, previewNodes: canvasRepresentativeNodes(children) };
    });
    const ungrouped = [...buckets.entries()].map(([key, items]) => {
        const left = Math.min(...items.map((node) => node.position.x));
        const top = Math.min(...items.map((node) => node.position.y));
        const right = Math.max(...items.map((node) => node.position.x + node.width));
        const bottom = Math.max(...items.map((node) => node.position.y + node.height));
        return { id: `area:${key}`, title: items.length === 1 ? items[0].title || "未命名节点" : `未分组区域 · ${items.length}`, count: items.length, position: { x: left, y: top }, width: Math.max(right - left, 320), height: Math.max(bottom - top, 220), layoutNodes: items, previewNodes: canvasRepresentativeNodes(items) };
    });

    return [...grouped, ...ungrouped];
}

export function canvasPrioritizedMediaNodeIds(nodes: CanvasNodeData[], viewport: ViewportTransform, viewportSize: { width: number; height: number }, budget: number, pinnedNodeIds: ReadonlySet<string> = new Set()) {
    return new Set(
        nodes
            .filter((node) => (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) && Boolean(node.metadata?.content))
            .map((node) => ({ id: node.id, score: canvasBoundsPriority(node.position.x, node.position.y, node.width, node.height, viewport, viewportSize, pinnedNodeIds.has(node.id)) }))
            .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
            .slice(0, budget)
            .map((item) => item.id),
    );
}

export function canvasPrioritizedOverviewClusterIds(clusters: CanvasOverviewCluster[], viewport: ViewportTransform, viewportSize: { width: number; height: number }, budget: number, pinnedNodeIds: ReadonlySet<string> = new Set()) {
    return new Set(
        clusters
            .filter((cluster) => cluster.previewNodes.some((node) => (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) && Boolean(node.metadata?.content)))
            .map((cluster) => ({ id: cluster.id, score: canvasBoundsPriority(cluster.position.x, cluster.position.y, cluster.width, cluster.height, viewport, viewportSize, Boolean(cluster.nodeId && pinnedNodeIds.has(cluster.nodeId))) }))
            .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
            .slice(0, budget)
            .map((item) => item.id),
    );
}

function canvasBoundsPriority(x: number, y: number, width: number, height: number, viewport: ViewportTransform, viewportSize: { width: number; height: number }, pinned: boolean) {
    const screenLeft = x * viewport.k + viewport.x;
    const screenTop = y * viewport.k + viewport.y;
    const screenWidth = Math.max(width * viewport.k, 1);
    const screenHeight = Math.max(height * viewport.k, 1);
    const visibleWidth = Math.max(0, Math.min(screenLeft + screenWidth, viewportSize.width) - Math.max(screenLeft, 0));
    const visibleHeight = Math.max(0, Math.min(screenTop + screenHeight, viewportSize.height) - Math.max(screenTop, 0));
    const distanceX = screenLeft + screenWidth / 2 - viewportSize.width / 2;
    const distanceY = screenTop + screenHeight / 2 - viewportSize.height / 2;
    return (pinned ? 1e12 : 0) + (visibleWidth && visibleHeight ? 1e9 : 0) + Math.min(visibleWidth * visibleHeight, 1e8) - Math.hypot(distanceX, distanceY) * 100;
}

function canvasRepresentativeNodes(nodes: CanvasNodeData[], limit = 4) {
    const media = nodes.filter((node) => (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) && Boolean(node.metadata?.content));
    const fallback = nodes.filter((node) => !media.includes(node));
    return [...media, ...fallback].slice(0, limit);
}

export type CanvasNavigationRow =
    | { kind: "group"; id: string; title: string; count: number; nodeId?: string }
    | { kind: "node"; id: string; node: CanvasNodeData };

export function buildCanvasNavigationRows(nodes: CanvasNodeData[], filteredNodes: CanvasNodeData[], collapsedGroupIds: ReadonlySet<string>, forceExpanded = false): CanvasNavigationRow[] {
    const groupById = new Map(nodes.filter((node) => node.type === CanvasNodeType.Group).map((node) => [node.id, node]));
    const filteredIds = new Set(filteredNodes.map((node) => node.id));
    const rows: CanvasNavigationRow[] = [];

    groupById.forEach((group) => {
        const children = filteredNodes.filter((node) => node.type !== CanvasNodeType.Group && node.metadata?.groupId === group.id);
        if (!filteredIds.has(group.id) && !children.length) return;
        rows.push({ kind: "group", id: `group:${group.id}`, nodeId: group.id, title: group.title || "分组", count: children.length });
        if (forceExpanded || !collapsedGroupIds.has(group.id)) children.forEach((node) => rows.push({ kind: "node", id: `node:${node.id}`, node }));
    });

    const ungrouped = filteredNodes.filter((node) => node.type !== CanvasNodeType.Group && (!node.metadata?.groupId || !groupById.has(node.metadata.groupId)));
    if (ungrouped.length) {
        rows.push({ kind: "group", id: "group:ungrouped", title: "未分组", count: ungrouped.length });
        if (forceExpanded || !collapsedGroupIds.has("ungrouped")) ungrouped.forEach((node) => rows.push({ kind: "node", id: `node:${node.id}`, node }));
    }
    return rows;
}

export function canvasVirtualRange(total: number, scrollTop: number, viewportHeight: number, rowHeight: number, overscan = 6, maxRows = 80) {
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(Math.max(viewportHeight, rowHeight) / rowHeight) + overscan * 2;
    const end = Math.min(total, start + Math.min(maxRows, visibleCount));
    return { start, end };
}
