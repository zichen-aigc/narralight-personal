import { VideoSettingsPanel } from "@/components/video-settings-panel";
import { Button } from "antd";
import { Settings2 } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { videoSettingsSummary } from "@/components/video-settings-panel";

import { canvasThemes } from "@/lib/canvas-theme";

import { useThemeStore } from "@/stores/use-theme-store";

import type { AiConfig } from "@/stores/use-config-store";

export type VideoSettingsPopoverProps = {
    config: AiConfig;

    onConfigChange: (key: keyof AiConfig, value: string) => void;

    buttonClassName?: string;

    containerClassName?: string;

    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";

    onOpenChange?: (open: boolean) => void;

    persistNormalizationOnMount?: boolean;
};

export function VideoSettingsPopover({
    config,
    onConfigChange,
    buttonClassName,
    containerClassName = "",
    placement = "topLeft",
    onOpenChange,
    persistNormalizationOnMount = true,
}: VideoSettingsPopoverProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const buttonRef = useRef<HTMLSpanElement>(null);

    const panelRef = useRef<HTMLDivElement>(null);

    const [open, setOpen] = useState(false);

    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);

    useEffect(() => {
        if (!open) return;

        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);

        const close = () => {
            setOpen(false);

            onOpenChange?.(false);
        };

        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;

            if (!(target instanceof Node)) return;

            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;

            close();
        };

        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") close();
        };

        syncPosition();

        window.addEventListener("resize", syncPosition);

        window.addEventListener("scroll", syncPosition, true);

        window.addEventListener("pointerdown", closeOnOutsidePointer, true);

        window.addEventListener("keydown", closeOnEscape);

        return () => {
            window.removeEventListener("resize", syncPosition);

            window.removeEventListener("scroll", syncPosition, true);

            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);

            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [onOpenChange, open]);

    const panel =
        open && buttonRect ? (
            <VideoSettingsPortal
                buttonRect={buttonRect}
                panelRef={panelRef}
                placement={placement}
                theme={theme}
                config={config}
                onConfigChange={onConfigChange}
                persistNormalizationOnMount={persistNormalizationOnMount}
            />
        ) : null;

    return (
        <>
            <span ref={buttonRef} className={`inline-flex min-w-0 max-w-full ${containerClassName}`}>
                <Button
                    size="small"

                    type="text"

                    className={buttonClassName || "!h-8 !max-w-[190px] !justify-start !rounded-md !px-2.5"}

                    style={{ background: "transparent", color: theme.node.text }}

                    icon={<Settings2 className="size-3.5" />}

                    aria-expanded={open}

                    aria-haspopup="dialog"

                    onClick={() =>
                        setOpen((current) => {
                            const next = !current;

                            onOpenChange?.(next);

                            return next;
                        })
                    }
                >
                    <span className="truncate">{videoSettingsSummary(config, config.videoModel || config.model)}</span>
                </Button>
            </span>

            {panel}
        </>
    );
}

function VideoSettingsPortal({
    buttonRect,
    panelRef,
    placement,
    theme,
    config,
    onConfigChange,
    persistNormalizationOnMount,
}: {
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: VideoSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    persistNormalizationOnMount: boolean;
}) {
    const margin = 12;

    const width = Math.min(356, window.innerWidth - margin * 2);

    const gap = 8;

    const alignRight = placement?.endsWith("Right");

    const alignCenter = placement === "top" || placement === "bottom";

    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;

    const topPlacement = placement?.startsWith("top");

    const style = {
        position: "fixed",

        zIndex: 1200,

        width,

        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),

        ...(topPlacement
            ? { bottom: window.innerHeight - buttonRect.top + gap, maxHeight: Math.max(260, buttonRect.top - margin * 2) }
            : { top: buttonRect.bottom + gap, maxHeight: Math.max(260, window.innerHeight - buttonRect.bottom - margin * 2) }),

        background: theme.toolbar.panel,

        border: `1px solid ${theme.toolbar.border}`,

        borderRadius: 8,

        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",

        padding: 18,

        overflowY: "auto",

        color: theme.node.text,
    } as const;

    return createPortal(
        <div
            ref={panelRef}
            role="dialog"
            className="canvas-image-settings-popover"
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <VideoSettingsPanel
                config={config}
                onConfigChange={(key, value) => onConfigChange(key, value)}
                theme={theme}
                className="space-y-4"
                persistNormalizationOnMount={persistNormalizationOnMount}
            />
        </div>,

        document.body,
    );
}
