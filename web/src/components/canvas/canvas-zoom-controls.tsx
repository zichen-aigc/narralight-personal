import { Button, Modal, Tooltip } from "antd";
import { Compass, Focus, Grid2x2, HelpCircle, PanelLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";

import { CANVAS_SIDE_PANEL_MOTION_MS, useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";

import { useThemeStore } from "@/stores/use-theme-store";

type CanvasZoomControlsProps = {
    scale: number;

    onScaleChange: (scale: number) => void;

    onReset: () => void;

    isMiniMapOpen: boolean;

    onToggleMiniMap: () => void;

    backgroundMode: CanvasBackgroundMode;

    onToggleGrid: () => void;
};

export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap, backgroundMode, onToggleGrid }: CanvasZoomControlsProps) {
    const [shortcutsOpen, setShortcutsOpen] = useState(false);

    const { t } = useTranslation();

    const colorTheme = useThemeStore((state) => state.theme);

    const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);

    const panelWidth = useCanvasSidePanelStore((state) => state.width);

    const togglePanel = useCanvasSidePanelStore((state) => state.togglePanel);

    const theme = canvasThemes[colorTheme];

    const dockStyle = {
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.toolbar.item,
        boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(28,25,23,.12)",
    };

    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    const handleScaleInput = (event: React.FormEvent<HTMLInputElement>) => onScaleChange(Number(event.currentTarget.value) / 100);

    return (
        <div
            data-canvas-view-controls

            className="absolute bottom-5 z-[75] transition-[left] ease-out"

            style={{ left: panelOpen ? panelWidth + 20 : 20, transitionDuration: `${CANVAS_SIDE_PANEL_MOTION_MS}ms` }}

            onMouseDown={(event) => event.stopPropagation()}

            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="flex h-14 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur" style={dockStyle}>
                <Tooltip title={panelOpen ? "隐藏左侧面板" : "显示左侧面板"}>
                    <Button
                        type="text"

                        className="!h-8 !w-8 !min-w-8 !p-0"

                        style={panelOpen ? activeStyle : { color: theme.toolbar.item }}

                        icon={<PanelLeft className="size-4" />}

                        onClick={togglePanel}

                        aria-label={panelOpen ? "隐藏左侧面板" : "显示左侧面板"}

                        aria-pressed={panelOpen}
                    />
                </Tooltip>

                <Tooltip title={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}>
                    <Button
                        type="text"

                        className="!h-8 !w-8 !min-w-8 !p-0"

                        style={isMiniMapOpen ? activeStyle : { color: theme.toolbar.item }}

                        icon={<Compass className="size-4" />}

                        onClick={onToggleMiniMap}

                        aria-label={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}

                        aria-pressed={isMiniMapOpen}
                    />
                </Tooltip>

                <Tooltip title={backgroundMode === "blank" ? "显示网格" : "隐藏网格"}>
                    <Button
                        type="text"

                        className="!h-8 !w-8 !min-w-8 !p-0"

                        style={backgroundMode !== "blank" ? activeStyle : { color: theme.toolbar.item }}

                        icon={<Grid2x2 className="size-4" />}

                        onClick={onToggleGrid}

                        aria-label={backgroundMode === "blank" ? "显示网格" : "隐藏网格"}

                        aria-pressed={backgroundMode !== "blank"}
                    />
                </Tooltip>

                <Tooltip title={t("canvas.resetView")}>
                    <Button
                        type="text"
                        className="!h-8 !w-8 !min-w-8 !p-0"
                        style={{ color: theme.toolbar.item }}
                        icon={<Focus className="size-4" />}
                        onClick={onReset}
                        aria-label={t("canvas.resetView")}
                    />
                </Tooltip>

                <Tooltip title={t("canvas.zoom")}>
                    <input
                        type="range"

                        min="5"

                        max="500"

                        step="1"

                        value={Math.round(scale * 100)}

                        className="w-24"

                        style={{ accentColor: theme.node.activeStroke }}

                        onInput={handleScaleInput}

                        onChange={handleScaleInput}

                        aria-label={t("canvas.zoom")}
                    />
                </Tooltip>

                <span className="w-10 text-right text-xs tabular-nums" style={{ color: theme.node.muted }}>
                    {Math.round(scale * 100)}%
                </span>

                <Tooltip title={t("canvas.shortcuts")}>
                    <Button
                        type="text"
                        className="!h-8 !w-8 !min-w-8 !p-0"
                        style={shortcutsOpen ? activeStyle : { color: theme.toolbar.item }}
                        icon={<HelpCircle className="size-4" />}
                        onClick={() => setShortcutsOpen(true)}
                        aria-label={t("canvas.shortcuts")}
                    />
                </Tooltip>
            </div>

            <Modal title={t("canvas.shortcuts")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-3 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut label={t("canvas.shortcut.middleDrag")} value={t("canvas.shortcut.pan")} />

                    <Shortcut label={`Space + ${t("canvas.shortcut.drag")}`} value={t("canvas.shortcut.pan")} />

                    <Shortcut label={t("canvas.shortcut.wheel")} value={t("canvas.shortcut.pan")} />

                    <Shortcut label={`Ctrl / Cmd + ${t("canvas.shortcut.wheel")}`} value={t("canvas.shortcut.zoom")} />

                    <Shortcut label={t("canvas.shortcut.drag")} value={t("canvas.shortcut.boxSelect")} />

                    <Shortcut label={`Shift / Cmd + ${t("canvas.shortcut.click")}`} value={t("canvas.shortcut.addSelection")} />

                    <Shortcut label="Ctrl / Cmd + C / V" value={t("canvas.shortcut.copyPaste")} />

                    <Shortcut label="Ctrl / Cmd + D" value={t("canvas.shortcut.duplicateVariant")} />

                    <Shortcut label="Ctrl / Cmd + Enter" value={t("canvas.shortcut.generatePrompt")} />

                    <Shortcut label="Delete / Backspace" value={t("canvas.shortcut.delete")} />
                </div>
            </Modal>
        </div>
    );
}

function Shortcut({ label, value }: { label: ReactNode; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-base font-medium">{label}</span>

            <span className="opacity-60">{value}</span>
        </div>
    );
}
