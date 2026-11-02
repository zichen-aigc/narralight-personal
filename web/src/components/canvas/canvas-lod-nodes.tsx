import { Play } from "lucide-react";
import { memo, type MouseEvent } from "react";
import { FileAudio2, FileText, Image as ImageIcon, Layers3, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";

import { getNodeDefinition } from "@/lib/canvas/node-registry";

import type { CanvasOverviewCluster } from "@/lib/canvas/canvas-performance";

import { useThemeStore } from "@/stores/use-theme-store";

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export const CanvasThumbnailNode = memo(function CanvasThumbnailNode({
    node,
    scale,
    selected,
    related,
    showMedia,
    posterUrl,
    onMouseDown,
    onDoubleClick,
}: {
    node: CanvasNodeData;
    scale: number;
    selected: boolean;
    related: boolean;
    showMedia: boolean;
    posterUrl?: string;
    onMouseDown: (event: MouseEvent, nodeId: string) => void;
    onDoubleClick: (nodeId: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const color = getNodeDefinition(node.type)?.minimapColor || theme.node.muted;

    const safeScale = Math.max(scale, 0.05);

    return (
        <div
            data-node-id={node.id}

            data-canvas-lod="thumbnail"

            data-canvas-detail-node

            className="absolute overflow-hidden rounded-xl border shadow-sm"

            style={{
                left: node.position.x,
                top: node.position.y,
                width: node.width,
                height: node.height,
                color: theme.node.text,
                background: `${color}14`,
                borderColor: selected ? theme.node.activeStroke : related ? theme.node.muted : `${color}88`,
                borderWidth: (selected ? 2 : 1) / safeScale,
            }}

            onMouseDown={(event) => onMouseDown(event, node.id)}

            onDoubleClick={(event) => {
                event.stopPropagation();

                onDoubleClick(node.id);
            }}
        >
            <CanvasLodMedia node={node} enabled={showMedia} color={color} posterUrl={posterUrl} />

            <div className="absolute inset-x-0 bottom-0" style={{ height: 3 / safeScale, background: color }} />

            <div
                data-canvas-lod-label
                className="absolute inset-x-0 bottom-0 truncate bg-black/55 font-semibold text-white backdrop-blur-sm"
                style={{ padding: `${5 / safeScale}px ${8 / safeScale}px`, paddingBottom: 8 / safeScale, fontSize: 11 / safeScale }}
            >
                {node.title || getNodeDefinition(node.type)?.title || "未命名节点"}
            </div>
        </div>
    );
});

export const CanvasOverviewSummary = memo(function CanvasOverviewSummary({
    cluster,
    scale,
    showMedia,
    posterByNodeId,
    onFocus,
}: {
    cluster: CanvasOverviewCluster;
    scale: number;
    showMedia: boolean;
    posterByNodeId: ReadonlyMap<string, string>;
    onFocus: (cluster: CanvasOverviewCluster) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const safeScale = Math.max(scale, 0.05);

    return (
        <button
            type="button"

            data-canvas-lod="overview"

            data-canvas-detail-node

            className="absolute overflow-hidden text-left shadow-sm transition hover:brightness-110"

            style={{
                left: cluster.position.x,
                top: cluster.position.y,
                width: Math.max(cluster.width, 112 / safeScale),
                height: Math.max(cluster.height, 64 / safeScale),
                borderRadius: 14 / safeScale,
                borderWidth: 1 / safeScale,
                color: theme.node.text,
                background: `${theme.toolbar.panel}e6`,
                borderColor: theme.node.stroke,
            }}

            onClick={(event) => {
                event.stopPropagation();

                onFocus(cluster);
            }}
        >
            <span className="absolute inset-0" aria-hidden="true">
                {cluster.layoutNodes.map((node) => (
                    <OverviewNodeBlock key={node.id} cluster={cluster} node={node} color={getNodeDefinition(node.type)?.minimapColor || theme.node.muted} />
                ))}

                {showMedia
                    ? cluster.previewNodes.map((node) => (
                          <OverviewNodeMedia
                              key={node.id}
                              cluster={cluster}
                              node={node}
                              color={getNodeDefinition(node.type)?.minimapColor || theme.node.muted}
                              posterUrl={posterByNodeId.get(node.id)}
                          />
                      ))
                    : null}
            </span>

            <span
                data-canvas-lod-label
                className="absolute left-0 top-0 max-w-[72%] rounded-br-lg bg-black/62 text-white backdrop-blur-sm"
                style={{ padding: `${7 / safeScale}px ${10 / safeScale}px` }}
            >
                <span className="block truncate font-semibold" style={{ fontSize: 12 / safeScale }}>
                    {cluster.title}
                </span>

                <span className="block opacity-70" style={{ marginTop: 2 / safeScale, fontSize: 9 / safeScale }}>
                    {cluster.count} 个元素
                </span>
            </span>
        </button>
    );
});

function OverviewNodeBlock({ cluster, node, color }: { cluster: CanvasOverviewCluster; node: CanvasNodeData; color: string }) {
    const rect = overviewNodeStyle(cluster, node);

    return <span data-canvas-lod-placeholder className="absolute rounded-[2px] border" style={{ ...rect, minWidth: 2, minHeight: 2, color, borderColor: `${color}8c`, background: `${color}3d` }} />;
}

function OverviewNodeMedia({ cluster, node, color, posterUrl }: { cluster: CanvasOverviewCluster; node: CanvasNodeData; color: string; posterUrl?: string }) {
    return (
        <span className="absolute overflow-hidden rounded-[2px]" style={overviewNodeStyle(cluster, node)}>
            <CanvasLodMedia node={node} enabled color={color} posterUrl={posterUrl} compact />
        </span>
    );
}

function overviewNodeStyle(cluster: CanvasOverviewCluster, node: CanvasNodeData) {
    const width = Math.max(cluster.width, 1);

    const height = Math.max(cluster.height, 1);

    const left = Math.max(0, Math.min(99.5, ((node.position.x - cluster.position.x) / width) * 100));

    const top = Math.max(0, Math.min(99.5, ((node.position.y - cluster.position.y) / height) * 100));

    return {
        left: `${left}%`,

        top: `${top}%`,

        width: `${Math.max(0.6, Math.min(100 - left, (node.width / width) * 100))}%`,

        height: `${Math.max(0.6, Math.min(100 - top, (node.height / height) * 100))}%`,
    };
}

const CanvasLodMedia = memo(function CanvasLodMedia({
    node,
    enabled,
    color,
    posterUrl,
    compact = false,
}: {
    node: CanvasNodeData;
    enabled: boolean;
    color: string;
    posterUrl?: string;
    compact?: boolean;
}) {
    const content = node.metadata?.content;

    if (enabled && content && node.type === CanvasNodeType.Image)
        return <img data-canvas-lod-media src={content} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />;

    if (enabled && content && node.type === CanvasNodeType.Video) {
        return (
            <span data-canvas-lod-media data-canvas-static-video-cover={posterUrl ? "source-image" : "fallback"} className="relative block size-full overflow-hidden bg-black">
                {posterUrl ? (
                    <img src={posterUrl} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover opacity-90" />
                ) : (
                    <span className="block size-full" style={{ background: `${color}28` }} />
                )}

                <Play
                    className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 fill-white/80 text-white/80"
                    style={{ width: compact ? "34%" : "18%", height: compact ? "34%" : "18%" }}
                />
            </span>
        );
    }

    const Icon =
        node.type === CanvasNodeType.Audio
            ? FileAudio2
            : node.type === CanvasNodeType.Text
              ? FileText
              : node.type === CanvasNodeType.Image
                ? ImageIcon
                : node.type === CanvasNodeType.Video
                  ? Video
                  : Layers3;

    return (
        <span data-canvas-lod-placeholder className="grid size-full place-items-center" style={{ color, background: `${color}24` }}>
            <Icon className="opacity-70" style={{ width: compact ? "38%" : "20%", height: compact ? "38%" : "20%" }} />
        </span>
    );
});
