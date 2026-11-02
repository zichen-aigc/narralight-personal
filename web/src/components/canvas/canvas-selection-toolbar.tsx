import { ChevronDown, Columns3, Download, Grid2x2, Group, Layers3, Plus, Rows3 } from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";

import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";

import type { CanvasSelectionBounds, CanvasSelectionLayout } from "@/lib/canvas/canvas-interaction-commands";

import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasSelectionToolbar({
    bounds,
    scale,
    canGroup,
    canConnect,
    onGroup,
    onDownload,
    onLayout,
    onConnectStart,
}: {
    bounds: CanvasSelectionBounds;
    scale: number;
    canGroup: boolean;
    canConnect: boolean;
    onGroup: () => void;
    onDownload: () => void;
    onLayout: (layout: CanvasSelectionLayout) => void;
    onConnectStart: (event: ReactMouseEvent) => void;
}) {
    const { t } = useTranslation();

    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const [layoutOpen, setLayoutOpen] = useState(false);

    const inverseScale = 1 / Math.max(scale, 0.05);

    const buttonClass =
        "flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-[0.35] disabled:hover:bg-transparent dark:hover:bg-white/10 dark:disabled:hover:bg-transparent";

    const layoutItems = [
        { key: "grid", label: t("canvas.selectionToolbar.grid"), icon: <Grid2x2 className="size-4" /> },

        { key: "horizontal", label: t("canvas.selectionToolbar.horizontal"), icon: <Columns3 className="size-4" /> },

        { key: "vertical", label: t("canvas.selectionToolbar.vertical"), icon: <Rows3 className="size-4" /> },
    ];

    return (
        <div
            className="pointer-events-none absolute z-[80]"
            data-canvas-no-zoom
            data-canvas-selection-toolbar
            style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
        >
            <div className="absolute inset-0 rounded-xl border" style={{ borderColor: theme.canvas.selectionStroke, borderWidth: 1 / scale, background: theme.canvas.selectionFill }} />

            <div
                className="pointer-events-auto absolute left-1/2 top-0 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl border p-1 shadow-[0_18px_45px_rgba(0,0,0,.24)] backdrop-blur-xl"

                style={{
                    transform: `translate(-50%, -${12 * inverseScale}px) scale(${inverseScale})`,
                    transformOrigin: "bottom center",
                    background: theme.toolbar.panel,
                    borderColor: theme.toolbar.border,
                    color: theme.toolbar.activeText,
                }}

                onMouseDown={(event) => event.stopPropagation()}
            >
                <button
                    type="button"
                    className={buttonClass}
                    disabled={!canGroup}
                    data-canvas-selection-action="group"
                    onClick={onGroup}
                    title={t(canGroup ? "canvas.selectionToolbar.group" : "canvas.selectionToolbar.groupUnavailable")}
                >
                    <Group className="size-4" />

                    {t("canvas.selectionToolbar.group")}
                </button>

                <button type="button" className={buttonClass} disabled data-canvas-selection-action="merge" title={t("canvas.selectionToolbar.mergePending")}>
                    <Layers3 className="size-4" />

                    {t("canvas.selectionToolbar.merge")}
                </button>

                <button type="button" className={buttonClass} data-canvas-selection-action="download" onClick={onDownload}>
                    <Download className="size-4" />

                    {t("canvas.selectionToolbar.download")}
                </button>

                <div className="relative">
                    <button
                        type="button"

                        className={buttonClass}

                        data-canvas-selection-action="layout"

                        aria-expanded={layoutOpen}

                        aria-haspopup="menu"

                        onClick={(event) => {
                            event.stopPropagation();

                            setLayoutOpen((open) => !open);
                        }}
                    >
                        <Grid2x2 className="size-4" />

                        {t("canvas.selectionToolbar.layout")}

                        <ChevronDown className="size-3.5 opacity-60" />
                    </button>

                    {layoutOpen ? (
                        <div
                            role="menu"

                            className="absolute right-0 top-[calc(100%+6px)] z-10 min-w-32 rounded-xl border p-1 shadow-[0_14px_38px_rgba(0,0,0,.28)]"

                            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}
                        >
                            {layoutItems.map((item) => (
                                <button
                                    key={item.key}

                                    type="button"

                                    role="menuitem"

                                    className="flex h-9 w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] dark:hover:bg-white/10"

                                    onClick={(event) => {
                                        event.stopPropagation();

                                        setLayoutOpen(false);

                                        onLayout(item.key as CanvasSelectionLayout);
                                    }}
                                >
                                    {item.icon}

                                    {item.label}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>

            {canConnect ? (
                <button
                    type="button"

                    className="pointer-events-auto absolute right-0 top-1/2 flex size-8 items-center justify-center rounded-full border shadow-[0_8px_22px_rgba(0,0,0,.18)] transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"

                    style={{
                        transform: `translate(50%, -50%) scale(${inverseScale})`,
                        transformOrigin: "center",
                        background: theme.toolbar.panel,
                        borderColor: theme.node.activeStroke,
                        color: theme.toolbar.activeText,
                    }}

                    data-canvas-selection-action="connect"

                    aria-label={t("canvas.selectionToolbar.connect")}

                    title={t("canvas.selectionToolbar.connect")}

                    onMouseDown={onConnectStart}
                >
                    <Plus className="size-4" />
                </button>
            ) : null}
        </div>
    );
}
