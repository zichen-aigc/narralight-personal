import { memo, useEffect, useMemo, useRef } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const MAX_ATLAS_PIXELS = 2048;

export const CanvasInteractionAtlas = memo(function CanvasInteractionAtlas({ nodes }: { nodes: CanvasNodeData[] }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bounds = useMemo(() => {
        if (!nodes.length) return { left: 0, top: 0, width: 1, height: 1 };
        const left = Math.min(...nodes.map((node) => node.position.x));
        const top = Math.min(...nodes.map((node) => node.position.y));
        const right = Math.max(...nodes.map((node) => node.position.x + node.width));
        const bottom = Math.max(...nodes.map((node) => node.position.y + node.height));
        return { left, top, width: Math.max(right - left, 1), height: Math.max(bottom - top, 1) };
    }, [nodes]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const pixelScale = Math.min(1, MAX_ATLAS_PIXELS / Math.max(bounds.width, bounds.height));
        canvas.width = Math.max(1, Math.ceil(bounds.width * pixelScale));
        canvas.height = Math.max(1, Math.ceil(bounds.height * pixelScale));
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.lineJoin = "round";

        nodes.forEach((node) => {
            const x = (node.position.x - bounds.left) * pixelScale;
            const y = (node.position.y - bounds.top) * pixelScale;
            const width = Math.max(node.width * pixelScale, 1.5);
            const height = Math.max(node.height * pixelScale, 1.5);
            const color = getNodeDefinition(node.type)?.minimapColor || theme.node.muted;
            if (node.type === CanvasNodeType.Group) {
                context.globalAlpha = 0.48;
                context.strokeStyle = color;
                context.lineWidth = Math.max(pixelScale * 8, 1);
                context.setLineDash([Math.max(pixelScale * 24, 3), Math.max(pixelScale * 14, 2)]);
                context.strokeRect(x, y, width, height);
                return;
            }
            context.setLineDash([]);
            context.globalAlpha = 0.34;
            context.fillStyle = color;
            context.fillRect(x, y, width, height);
            context.globalAlpha = 0.72;
            context.strokeStyle = color;
            context.lineWidth = Math.max(pixelScale * 4, 0.75);
            context.strokeRect(x, y, width, height);
        });
        context.globalAlpha = 1;
        context.setLineDash([]);
    }, [bounds, nodes, theme.node.muted]);

    return (
        <canvas
            ref={canvasRef}
            data-canvas-interaction-atlas
            className="pointer-events-none absolute"
            style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
            aria-hidden="true"
        />
    );
});
