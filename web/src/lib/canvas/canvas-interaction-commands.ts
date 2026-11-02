import { normalizeConnection } from "@/lib/canvas/canvas-node-geometry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ConnectionHandle, type Position, type ViewportTransform } from "@/types/canvas";

type ClipboardDataLike = {
    files?: ArrayLike<File> | null;
    items?: ArrayLike<{ kind: string; getAsFile: () => File | null }> | null;
    getData: (type: string) => string;
};

type NavigatorClipboardItemLike = {
    types: readonly string[];
    getType: (type: string) => Promise<Blob>;
};

export type CanvasClipboardPayload = {
    mediaFiles: File[];
    text: string;
    unsupportedCount: number;
};

export function parseCanvasClipboardData(data: ClipboardDataLike): CanvasClipboardPayload {
    const directFiles = Array.from(data.files || []);
    const itemFiles = directFiles.length ? [] : Array.from(data.items || []).flatMap((item) => (item.kind === "file" ? [item.getAsFile()].filter((file): file is File => Boolean(file)) : []));
    const files = dedupeClipboardFiles(directFiles.length ? directFiles : itemFiles);
    const mediaFiles = files.filter(isClipboardMediaFile).map(normalizeClipboardFileName);
    const html = safeClipboardText(data, "text/html");
    let text = safeClipboardText(data, "text/plain").trim();
    if (mediaFiles.length && /^https?:\/\/\S+$/i.test(text) && /<(img|video|audio)\b/i.test(html)) text = "";
    return { mediaFiles, text, unsupportedCount: files.length - mediaFiles.length };
}

export async function parseCanvasClipboardItems(items: readonly NavigatorClipboardItemLike[]): Promise<CanvasClipboardPayload> {
    const files: File[] = [];
    let text = "";
    let html = "";
    let unsupportedCount = 0;

    for (const item of items) {
        const mediaType = item.types.find((type) => /^(image|video|audio)\//i.test(type));
        if (mediaType) {
            try {
                const blob = await item.getType(mediaType);
                files.push(new File([blob], "", { type: mediaType }));
            } catch {
                unsupportedCount += 1;
            }
        }
        if (!text && item.types.includes("text/plain")) {
            try {
                text = await (await item.getType("text/plain")).text();
            } catch {}
        }
        if (!html && item.types.includes("text/html")) {
            try {
                html = await (await item.getType("text/html")).text();
            } catch {}
        }
    }

    const payload = parseCanvasClipboardData({ files, getData: (type) => type === "text/plain" ? text : type === "text/html" ? html : "" });
    return { ...payload, unsupportedCount: payload.unsupportedCount + unsupportedCount };
}

export function buildCanvasConnectionBatch({ current, targetNodeId, nodes, connections, createId }: { current: ConnectionHandle; targetNodeId: string; nodes: CanvasNodeData[]; connections: CanvasConnection[]; createId: () => string }) {
    const selectedSources = current.handleType === "source" && current.batchNodeIds?.length ? current.batchNodeIds : [current.nodeId];
    const existing = new Set(connections.map((connection) => `${connection.fromNodeId}\u0000${connection.toNodeId}`));
    const next: CanvasConnection[] = [];
    let skippedCount = 0;

    for (const nodeId of selectedSources) {
        const normalized = normalizeConnection(nodeId, targetNodeId, nodes, current.handleType);
        if (!normalized) {
            skippedCount += 1;
            continue;
        }
        const key = `${normalized.fromNodeId}\u0000${normalized.toNodeId}`;
        if (existing.has(key)) {
            skippedCount += 1;
            continue;
        }
        existing.add(key);
        next.push({ id: createId(), ...normalized });
    }

    return { connections: next, connectedCount: next.length, skippedCount, attemptedCount: selectedSources.length };
}

export type CanvasSelectionBounds = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type CanvasSelectionLayout = "grid" | "horizontal" | "vertical";

export function canvasSelectionBounds(nodes: CanvasNodeData[], selectedNodeIds: ReadonlySet<string>): CanvasSelectionBounds | null {
    const selected = nodes.filter((node) => selectedNodeIds.has(node.id));
    if (!selected.length) return null;
    const left = Math.min(...selected.map((node) => node.position.x));
    const top = Math.min(...selected.map((node) => node.position.y));
    const right = Math.max(...selected.map((node) => node.position.x + node.width));
    const bottom = Math.max(...selected.map((node) => node.position.y + node.height));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function layoutCanvasSelection(nodes: CanvasNodeData[], selectedNodeIds: ReadonlySet<string>, layout: CanvasSelectionLayout, gap = 32) {
    const bounds = canvasSelectionBounds(nodes, selectedNodeIds);
    const selected = nodes.filter((node) => selectedNodeIds.has(node.id)).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id));
    if (!bounds || selected.length < 2) return nodes;
    const positions = new Map<string, Position>();

    if (layout === "horizontal") {
        let x = bounds.left;
        selected.forEach((node) => {
            positions.set(node.id, { x, y: bounds.top });
            x += node.width + gap;
        });
    } else if (layout === "vertical") {
        let y = bounds.top;
        selected.forEach((node) => {
            positions.set(node.id, { x: bounds.left, y });
            y += node.height + gap;
        });
    } else {
        const columns = Math.ceil(Math.sqrt(selected.length));
        const cellWidth = Math.max(...selected.map((node) => node.width));
        const cellHeight = Math.max(...selected.map((node) => node.height));
        selected.forEach((node, index) => positions.set(node.id, { x: bounds.left + (index % columns) * (cellWidth + gap), y: bounds.top + Math.floor(index / columns) * (cellHeight + gap) }));
    }

    return nodes.map((node) => (positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node));
}

export function groupCanvasSelection(nodes: CanvasNodeData[], selectedNodeIds: ReadonlySet<string>, group: CanvasNodeData, padding = 40) {
    const selected = nodes.filter((node) => selectedNodeIds.has(node.id));
    const bounds = canvasSelectionBounds(nodes, selectedNodeIds);
    if (!bounds || selected.length < 2 || selected.length !== selectedNodeIds.size || selected.some((node) => node.type === CanvasNodeType.Group)) return null;
    const nextGroup = { ...group, position: { x: bounds.left - padding, y: bounds.top - padding }, width: bounds.width + padding * 2, height: bounds.height + padding * 2 };
    return {
        group: nextGroup,
        groupedCount: selected.length,
        nodes: [nextGroup, ...nodes.map((node) => (selectedNodeIds.has(node.id) ? { ...node, metadata: { ...node.metadata, groupId: nextGroup.id } } : node))],
    };
}

export function duplicateCanvasVariant(source: CanvasNodeData, connections: CanvasConnection[], input: { nodeId: string; title: string; createConnectionId: () => string; offset?: number }) {
    const offset = input.offset ?? 36;
    const metadata = source.metadata ? { ...source.metadata, images: source.metadata.images?.map((image) => ({ ...image })) } : undefined;
    if (metadata) {
        delete metadata.activeVideoTakeId;
        delete metadata.videoTakeId;
        delete metadata.videoTakeStatus;
        delete metadata.videoSubmissionState;
        delete metadata.generationTask;
    }
    const node: CanvasNodeData = {
        ...source,
        id: input.nodeId,
        title: input.title,
        position: { x: source.position.x + offset, y: source.position.y + offset },
        metadata,
    };
    const inboundConnections = connections.filter((connection) => connection.toNodeId === source.id).map((connection) => ({ ...connection, id: input.createConnectionId(), toNodeId: node.id }));
    return { node, inboundConnections };
}

export function canvasWheelViewport(viewport: ViewportTransform, input: { deltaX: number; deltaY: number; deltaMode?: number; clientX: number; clientY: number; rectLeft: number; rectTop: number; rectWidth: number; rectHeight: number; zoom: boolean; shiftKey?: boolean }) {
    const unit = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? Math.max(input.rectWidth, input.rectHeight) : 1;
    const deltaX = input.deltaX * unit;
    const deltaY = input.deltaY * unit;
    if (!input.zoom) {
        return {
            x: viewport.x - (input.shiftKey && !deltaX ? deltaY : deltaX),
            y: viewport.y - (input.shiftKey ? 0 : deltaY),
            k: viewport.k,
        };
    }
    const factor = Math.pow(1.1, -deltaY / 100);
    const k = Math.min(Math.max(viewport.k * factor, 0.05), 5);
    const mouseX = input.clientX - input.rectLeft;
    const mouseY = input.clientY - input.rectTop;
    const worldX = (mouseX - viewport.x) / viewport.k;
    const worldY = (mouseY - viewport.y) / viewport.k;
    return { x: mouseX - worldX * k, y: mouseY - worldY * k, k };
}

function safeClipboardText(data: ClipboardDataLike, type: string) {
    try {
        return data.getData(type) || "";
    } catch {
        return "";
    }
}

function dedupeClipboardFiles(files: File[]) {
    const seen = new Set<string>();
    return files.filter((file) => {
        const key = `${file.name}\u0000${file.type}\u0000${file.size}\u0000${file.lastModified}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isClipboardMediaFile(file: File) {
    if (/^(image|video|audio)\//i.test(file.type)) return true;
    return /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp|m4v|mkv|mov|mp4|webm|avi|m4a|mp3|ogg|opus|wav|aac|flac)$/i.test(file.name);
}

function normalizeClipboardFileName(file: File, index: number) {
    if (file.name?.trim()) return file;
    const extension = clipboardExtension(file.type);
    return new File([file], `clipboard-${index + 1}.${extension}`, { type: file.type, lastModified: file.lastModified });
}

function clipboardExtension(type: string) {
    const subtype = type.split("/")[1]?.toLowerCase().replace(/^x-/, "");
    if (!subtype) return "bin";
    if (subtype === "jpeg") return "jpg";
    if (subtype === "quicktime") return "mov";
    if (subtype === "mpeg") return type.startsWith("audio/") ? "mp3" : "mpg";
    return subtype.replace(/[^a-z0-9.+-]/g, "") || "bin";
}

export function isCanvasMediaNode(node?: CanvasNodeData | null) {
    return Boolean(node && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video));
}
