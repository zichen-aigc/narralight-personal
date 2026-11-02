import { Scissors } from "lucide-react";

import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";

import { canvasConnectionCurve, canvasConnectionPathData } from "@/lib/canvas/canvas-connection-geometry";

import { useThemeStore } from "@/stores/use-theme-store";

import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

export function ConnectionPath({
    connection,

    from,

    to,

    active,

    visible = true,

    showDirection = false,

    onSelect,

    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    visible?: boolean;
    showDirection?: boolean;
    onSelect: (event: ReactMouseEvent<SVGPathElement>) => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const pathD = canvasConnectionPathData(canvasConnectionCurve(from, to));

    return (
        <g>
            <path
                data-connection-id={connection.id}

                d={pathD}

                stroke="transparent"

                strokeWidth="16"

                vectorEffect="non-scaling-stroke"

                fill="none"

                style={{ cursor: "pointer", pointerEvents: "stroke" }}

                onClick={(event) => {
                    event.stopPropagation();

                    onSelect(event);
                }}

                onContextMenu={(event) => {
                    event.preventDefault();

                    event.stopPropagation();

                    onContextMenu?.(event);
                }}
            />

            {visible ? (
                <path
                    d={pathD}

                    stroke={active ? theme.node.activeStroke : theme.node.muted}

                    strokeWidth={active ? 2.8 : 1}

                    strokeOpacity={active ? 0.98 : 0.3}

                    fill="none"

                    markerEnd={showDirection ? "url(#canvas-connection-direction-arrow)" : undefined}

                    vectorEffect="non-scaling-stroke"

                    style={{ filter: active ? `drop-shadow(0 2px 7px ${theme.node.activeStroke}55)` : undefined, pointerEvents: "none" }}
                />
            ) : null}
        </g>
    );
}

export function ConnectionDirectionMarker() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <defs>
            <marker id="canvas-connection-direction-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="3.4" markerHeight="3.4" orient="auto-start-reverse" markerUnits="strokeWidth">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.node.activeStroke} />
            </marker>
        </defs>
    );
}

export function connectionCutButtonTransform(scale: number) {
    return `translate(-50%, -50%) scale(${1 / Math.max(scale, 0.05)})`;
}

export function removeConnectionById(connections: CanvasConnection[], connectionId: string) {
    return connections.filter((connection) => connection.id !== connectionId);
}

export function ConnectionCutButton({ connectionId, position, scale, label, onCut }: { connectionId: string; position: Position; scale: number; label: string; onCut: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const style: CSSProperties = {
        left: position.x,

        top: position.y,

        color: theme.node.text,

        background: theme.toolbar.panel,

        borderColor: theme.toolbar.border,

        transform: connectionCutButtonTransform(scale),

        transformOrigin: "center",
    };

    return (
        <button
            type="button"

            data-canvas-no-zoom

            data-connection-cut-id={connectionId}

            className="absolute z-[70] grid size-10 place-items-center rounded-full border shadow-md transition hover:brightness-105"

            style={style}

            aria-label={label}

            title={label}

            onPointerDown={(event) => event.stopPropagation()}

            onClick={(event) => {
                event.stopPropagation();

                onCut();
            }}
        >
            <Scissors className="size-4.5" aria-hidden />
        </button>
    );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    if (!node) return null;

    const startX = handle.handleType === "source" ? (handle.origin?.x ?? node.position.x + node.width) : mouseWorld.x;

    const startY = handle.handleType === "source" ? (handle.origin?.y ?? node.position.y + node.height / 2) : mouseWorld.y;

    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;

    const endY = handle.handleType === "source" ? mouseWorld.y : node.position.y + node.height / 2;

    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;

    const snappedStartY = handle.handleType === "target" && target ? target.position.y + target.height / 2 : startY;

    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;

    const snappedEndY = handle.handleType === "source" && target ? target.position.y + target.height / 2 : endY;

    const distance = Math.abs(snappedEndX - snappedStartX);

    const pathD = `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;

    return <path d={pathD} stroke={theme.node.activeStroke} strokeWidth="2" fill="none" strokeDasharray="5,5" />;
}
