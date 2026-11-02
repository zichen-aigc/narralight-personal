import { Button, Tooltip } from "antd";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import { useTranslation } from "react-i18next";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

import { canvasThemes } from "@/lib/canvas-theme";

import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasReferenceStrip({
    references,
    onMove,
    primaryEditVideoId,
    onPrimaryEditVideoChange,
}: {
    references: CanvasResourceReference[];
    onMove: (index: number, offset: number) => void;
    primaryEditVideoId?: string;
    onPrimaryEditVideoChange?: (nodeId: string) => void;
}) {
    const { t } = useTranslation();

    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    if (!references.length) return null;

    return (
        <div className="thin-scrollbar mb-2 flex max-w-full gap-2 overflow-x-auto pb-1" aria-label={t("canvas.composer.referenceOrder")}>
            {references.map((reference, index) => (
                <div
                    key={reference.nodeId}
                    className="group/reference relative size-14 shrink-0 overflow-hidden rounded-xl border"
                    style={{ borderColor: primaryEditVideoId === reference.nodeId ? theme.node.text : theme.toolbar.border, background: theme.node.fill }}
                    title={`${reference.label} · ${reference.title}`}
                >
                    <ReferencePreview reference={reference} />

                    <span className="absolute left-1 top-1 rounded bg-black/65 px-1 py-0.5 text-[9px] font-medium leading-none text-white">{reference.label}</span>

                    {reference.kind === "video" && onPrimaryEditVideoChange ? (
                        <Tooltip title="设为待编辑原片">
                            <Button
                                type="text"
                                size="small"
                                aria-pressed={primaryEditVideoId === reference.nodeId}
                                className="!absolute !right-0.5 !top-0.5 !z-10 !h-5 !w-5 !min-w-5 !rounded-full !bg-black/60 !p-0 !text-white"
                                icon={<Check className={`size-3 ${primaryEditVideoId === reference.nodeId ? "opacity-100" : "opacity-35"}`} />}
                                onClick={() => onPrimaryEditVideoChange(reference.nodeId)}
                            />
                        </Tooltip>
                    ) : null}

                    {references.length > 1 ? (
                        <div className="absolute inset-x-0 bottom-0 hidden h-6 items-center justify-between bg-black/60 px-0.5 group-hover/reference:flex group-focus-within/reference:flex">
                            <Tooltip title={t("canvas.composer.moveReferenceLeft")}>
                                <Button
                                    type="text"
                                    size="small"
                                    className="!h-5 !w-5 !min-w-5 !p-0 !text-white disabled:!text-white/25"
                                    icon={<ArrowLeft className="size-3" />}
                                    disabled={index === 0}
                                    onClick={() => onMove(index, -1)}
                                />
                            </Tooltip>

                            <Tooltip title={t("canvas.composer.moveReferenceRight")}>
                                <Button
                                    type="text"
                                    size="small"
                                    className="!h-5 !w-5 !min-w-5 !p-0 !text-white disabled:!text-white/25"
                                    icon={<ArrowRight className="size-3" />}
                                    disabled={index === references.length - 1}
                                    onClick={() => onMove(index, 1)}
                                />
                            </Tooltip>
                        </div>
                    ) : null}
                </div>
            ))}
        </div>
    );
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-full object-cover" draggable={false} />;

    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} className="size-full bg-black object-cover" muted preload="metadata" />;

    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "text" ? FileText : reference.kind === "video" ? Video : ImageIcon;

    return (
        <span className="grid size-full place-items-center">
            <Icon className="size-5 opacity-60" />
        </span>
    );
}
