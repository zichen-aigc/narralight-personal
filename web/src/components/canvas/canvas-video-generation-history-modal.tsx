import { DeferredCanvasVideo } from "@/components/canvas/deferred-canvas-video";
import { Check, CircleAlert, Clock3, Copy, LoaderCircle, RefreshCw, Video } from "lucide-react";
import { Button, Modal, Spin } from "antd";
import { useEffect, useMemo, useState } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";
import copy from "copy-to-clipboard";

import { canvasThemes } from "@/lib/canvas-theme";

import { useThemeStore } from "@/stores/use-theme-store";

import type { CanvasNodeData } from "@/types/canvas";

import {
    adoptVideoGenerationTake,
    bootstrapLegacyVideoGenerationTake,
    checkVideoGenerationTakeNow,
    legacyVideoTakeBootstrapInput,
    listVideoGenerationTakes,
    selectVideoReconciliationCandidate,
    summarizeVideoTakeStatuses,
    type VideoGenerationTake,
    type VideoGenerationTakeHistory,
} from "@/services/video-generation-take";

type Props = {
    open: boolean;

    projectId: string;

    node: CanvasNodeData | null;

    canAdopt: boolean;

    onClose: () => void;

    onAdopt: (take: VideoGenerationTake) => void | Promise<void>;
};

const emptyHistory: VideoGenerationTakeHistory = { takes: [], activeTakeId: null, counts: { completed: 0, pending: 0, unknown: 0, failed: 0 } };

export function CanvasVideoGenerationHistoryModal({ open, projectId, node, canAdopt, onClose, onAdopt }: Props) {
    const { t } = useTranslation();

    const { message } = App.useApp();

    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const [history, setHistory] = useState(emptyHistory);

    const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);

    const [loading, setLoading] = useState(false);

    const [adopting, setAdopting] = useState(false);

    const [selectingTaskId, setSelectingTaskId] = useState("");

    const [checkingNow, setCheckingNow] = useState(false);

    const [error, setError] = useState("");

    const selected = useMemo(() => history.takes.find((take) => take.takeId === selectedTakeId) || null, [history.takes, selectedTakeId]);

    const counts = useMemo(() => summarizeVideoTakeStatuses(history.takes), [history.takes]);

    useEffect(() => {
        if (!open || !node) return;

        let cancelled = false;

        setLoading(true);

        setError("");

        void loadHistory(node)
            .then((next) => {
                if (cancelled) return;

                setHistory(next);

                setSelectedTakeId((current) =>
                    current && next.takes.some((take) => take.takeId === current)
                        ? current
                        : next.activeTakeId || [...next.takes].reverse().find((take) => take.status === "completed")?.takeId || next.takes.at(-1)?.takeId || null,
                );
            })
            .catch((reason) => {
                if (!cancelled) setError(reason instanceof Error ? reason.message : t("canvas.videoHistory.loadFailed"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [node?.id, open, projectId, t]);

    useEffect(() => {
        if (!open || !node || !history.takes.some((take) => ["submitting", "submission_unknown", "pending", "result_pending"].includes(take.status))) return;

        let cancelled = false;

        const timer = window.setInterval(() => {
            void listVideoGenerationTakes(projectId, node.id)
                .then((next) => {
                    if (!cancelled) setHistory(next);
                })
                .catch(() => undefined);
        }, 5_000);

        return () => {
            cancelled = true;

            window.clearInterval(timer);
        };
    }, [history.takes, node, open, projectId]);

    async function loadHistory(target: CanvasNodeData) {
        const input = legacyVideoTakeBootstrapInput(projectId, target);

        if (input) await bootstrapLegacyVideoGenerationTake(input);

        return listVideoGenerationTakes(projectId, target.id);
    }

    async function refresh() {
        if (!node) return;

        setLoading(true);

        setError("");

        try {
            const next = await loadHistory(node);

            setHistory(next);

            setSelectedTakeId((current) => (current && next.takes.some((take) => take.takeId === current) ? current : next.activeTakeId || next.takes.at(-1)?.takeId || null));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("canvas.videoHistory.loadFailed"));
        } finally {
            setLoading(false);
        }
    }

    async function adoptSelected() {
        if (!selected?.media || selected.status !== "completed" || !canAdopt) return;

        setAdopting(true);

        try {
            const adopted = await adoptVideoGenerationTake(selected.takeId);

            await onAdopt(adopted.take);

            setHistory((current) => ({ ...current, activeTakeId: adopted.activeTakeId }));

            message.success(t("canvas.videoHistory.adopted"));
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("canvas.videoHistory.adoptFailed"));
        } finally {
            setAdopting(false);
        }
    }

    async function selectCandidate(taskId: string) {
        if (!selected) return;

        setSelectingTaskId(taskId);

        try {
            await selectVideoReconciliationCandidate(selected.takeId, taskId);

            await refresh();

            message.success(t("canvas.videoHistory.candidateSelected"));
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("canvas.videoHistory.candidateSelectFailed"));
        } finally {
            setSelectingTaskId("");
        }
    }

    async function checkNow() {
        if (!selected?.taskId) return;

        setCheckingNow(true);

        try {
            const result = await checkVideoGenerationTakeNow(selected.takeId);

            setHistory((current) => ({ ...current, takes: current.takes.map((take) => (take.takeId === result.take.takeId ? result.take : take)) }));

            message.success(t(result.throttled ? "canvas.videoHistory.checkOriginalThrottled" : "canvas.videoHistory.checkOriginalDone"));
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("canvas.videoHistory.checkOriginalFailed"));
        } finally {
            setCheckingNow(false);
        }
    }

    return (
        <Modal
            open={open && Boolean(node)}

            title={t("canvas.videoHistory.title")}

            footer={null}

            keyboard

            centered={false}

            width="100vw"

            onCancel={onClose}

            style={{ top: 0, maxWidth: "none", paddingBottom: 0 }}

            styles={{
                container: { height: "100vh", borderRadius: 0, padding: 0, overflow: "hidden", background: theme.canvas.background },

                header: { margin: 0, padding: "16px 22px", borderBottom: `1px solid ${theme.node.stroke}`, background: theme.node.panel },

                body: { height: "calc(100vh - 57px)", overflow: "hidden" },
            }}
        >
            <div
                className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(240px,40vh)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1"

                style={{ color: theme.node.text }}

                data-canvas-shortcuts-ignore

                onMouseDown={(event) => event.stopPropagation()}

                onPointerDown={(event) => event.stopPropagation()}

                onKeyDown={(event) => {
                    if (event.key === "Escape") onClose();

                    event.stopPropagation();
                }}
            >
                <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_148px] border-r" style={{ borderColor: theme.node.stroke }}>
                    <div className="relative flex min-h-0 items-center justify-center bg-black">
                        {loading ? (
                            <Spin />
                        ) : selected?.media?.url ? (
                            <DeferredCanvasVideo
                                key={selected.takeId}
                                src={selected.media.url}
                                storageKey={selected.media.storageKey}
                                mimeType={selected.media.mimeType}
                                bytes={selected.media.bytes}
                                eager
                            />
                        ) : (
                            <EmptyPreview
                                status={selected?.status}
                                label={
                                    error ||
                                    providerErrorSummary(selected) ||
                                    (selected?.status === "submission_unknown" ? t("canvas.videoHistory.autoRecoveringDescription") : t("canvas.videoHistory.noPreview"))
                                }
                            />
                        )}
                    </div>

                    <div className="flex min-h-0 gap-4 border-t p-4" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                        <div className="w-28 shrink-0 space-y-2 text-xs">
                            <Count label={t("canvas.videoHistory.completed")} value={counts.completed} color="#22c55e" />

                            <Count label={t("canvas.videoHistory.inProgress")} value={counts.pending} color="#f59e0b" />

                            <Count label={t("canvas.videoHistory.submissionUnknown")} value={counts.unknown} color="#eab308" />

                            <Count label={t("canvas.videoHistory.failed")} value={counts.failed} color="#ef4444" />
                        </div>

                        <div className="thin-scrollbar flex min-w-0 flex-1 gap-3 overflow-x-auto pb-1">
                            {history.takes.map((take, index) => (
                                <button
                                    key={take.takeId}

                                    type="button"

                                    className="relative h-[100px] w-40 shrink-0 overflow-hidden rounded-lg border text-left"

                                    style={{ borderColor: take.takeId === selectedTakeId ? theme.node.activeStroke : theme.node.stroke, background: theme.node.fill }}

                                    onClick={() => setSelectedTakeId(take.takeId)}
                                >
                                    <div className="flex h-full items-center justify-center">{take.media?.url ? <Video className="size-6 opacity-45" /> : <StatusIcon status={take.status} />}</div>

                                    <span className="absolute left-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[11px] text-white">Take {index + 1}</span>

                                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">{statusLabel(take.status, t)}</span>

                                    {take.takeId === history.activeTakeId ? (
                                        <span className="absolute bottom-1.5 left-1.5 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] text-white">{t("canvas.videoHistory.active")}</span>
                                    ) : null}
                                </button>
                            ))}

                            {!history.takes.length && !loading ? <div className="flex h-full items-center text-sm opacity-60">{t("canvas.videoHistory.empty")}</div> : null}
                        </div>
                    </div>
                </section>

                <aside className="flex min-h-0 flex-col" style={{ background: theme.node.panel }}>
                    <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: theme.node.stroke }}>
                        <div className="flex items-center gap-2 font-semibold">
                            <Clock3 className="size-4" />

                            {t("canvas.videoHistory.details")}
                        </div>

                        <Button type="text" icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()} aria-label={t("canvas.plugins.refresh")} />
                    </div>

                    <div className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-sm">
                        {selected ? (
                            <>
                                <Detail label={t("canvas.videoHistory.status")} value={statusLabel(selected.status, t)} />

                                <Detail label={t("canvas.videoHistory.model")} value={selected.model || t("canvas.videoHistory.unknown")} />

                                <Detail label={t("canvas.videoHistory.taskId")} value={selected.taskId || t("canvas.videoHistory.unknown")} />

                                <div className="grid grid-cols-2 gap-3">
                                    <Detail label={t("canvas.videoHistory.mode")} value={String(selected.parameters.referenceMode || t("canvas.videoHistory.unknown"))} />

                                    <Detail label={t("canvas.videoHistory.aspectRatio")} value={String(selected.parameters.aspectRatio || t("canvas.videoHistory.unknown"))} />

                                    <Detail label={t("canvas.videoHistory.resolution")} value={String(selected.parameters.resolution || t("canvas.videoHistory.unknown"))} />

                                    <Detail label={t("canvas.videoHistory.duration")} value={selected.parameters.duration ? `${selected.parameters.duration}s` : t("canvas.videoHistory.unknown")} />
                                </div>

                                <Detail label={t("canvas.videoHistory.createdAt")} value={new Date(selected.createdAt).toLocaleString()} />

                                {selected.reconciliation ? <Detail label={t("canvas.videoHistory.recoveryProgress")} value={reconciliationLabel(selected, t)} multiline /> : null}

                                {selected.taskId && ["pending", "result_pending"].includes(selected.status) ? (
                                    <Button block icon={<RefreshCw className="size-4" />} loading={checkingNow} onClick={() => void checkNow()}>
                                        {t("canvas.videoHistory.checkOriginalNow")}
                                    </Button>
                                ) : null}

                                {selected.reconciliation?.candidates.length ? (
                                    <div className="space-y-2">
                                        <div className="text-xs opacity-50">{t("canvas.videoHistory.recoveryCandidates")}</div>

                                        {selected.reconciliation.candidates.map((candidate) => (
                                            <Button
                                                key={candidate.taskId}
                                                block
                                                loading={selectingTaskId === candidate.taskId}
                                                disabled={Boolean(selectingTaskId)}
                                                onClick={() => void selectCandidate(candidate.taskId)}
                                            >
                                                {candidate.taskId} · {candidate.status}
                                            </Button>
                                        ))}
                                    </div>
                                ) : null}

                                <Detail label={t("canvas.videoHistory.prompt")} value={selected.prompt || t("canvas.videoHistory.unknown")} multiline />

                                {selected.errorCode ? <Detail label={t("canvas.videoHistory.errorCode")} value={selected.errorCode} /> : null}

                                {selected.providerError?.httpStatus ? <Detail label={t("canvas.videoHistory.providerHttpStatus")} value={`HTTP ${selected.providerError.httpStatus}`} /> : null}

                                {selected.providerError?.code ? <Detail label={t("canvas.videoHistory.providerErrorCode")} value={selected.providerError.code} /> : null}

                                {selected.providerError?.message ? <Detail label={t("canvas.videoHistory.providerErrorMessage")} value={selected.providerError.message} multiline /> : null}

                                {selected.providerError?.requestId ? <Detail label={t("canvas.videoHistory.providerRequestId")} value={selected.providerError.requestId} /> : null}

                                {selected.errorCode || selected.providerError ? (
                                    <Button icon={<Copy className="size-4" />} onClick={() => copy(videoTakeDiagnosticSummary(selected))}>
                                        {t("canvas.videoHistory.copyDiagnostics")}
                                    </Button>
                                ) : null}
                            </>
                        ) : (
                            <div className="opacity-60">{error || t("canvas.videoHistory.selectTake")}</div>
                        )}
                    </div>

                    <div className="border-t p-4" style={{ borderColor: theme.node.stroke }}>
                        <Button
                            type="primary"

                            block

                            size="large"

                            icon={<Check className="size-4" />}

                            loading={adopting}

                            disabled={!canAdopt || !selected?.media || selected.status !== "completed" || selected.takeId === history.activeTakeId}

                            onClick={() => void adoptSelected()}
                        >
                            {selected?.takeId === history.activeTakeId ? t("canvas.videoHistory.adoptedCurrent") : t("canvas.videoHistory.adopt")}
                        </Button>
                    </div>
                </aside>
            </div>
        </Modal>
    );
}

function Count({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: color }} />

                {label}
            </span>

            <strong>{value}</strong>
        </div>
    );
}

function Detail({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <div className="mb-1 text-xs opacity-50">{label}</div>

            <div className={multiline ? "whitespace-pre-wrap break-words leading-6" : "break-all font-medium"}>{value}</div>
        </div>
    );
}

function EmptyPreview({ status, label }: { status?: VideoGenerationTakeStatus; label: string }) {
    return (
        <div className="flex flex-col items-center gap-3 text-sm text-white/60">
            <StatusIcon status={status} />

            <span>{label}</span>
        </div>
    );
}

function StatusIcon({ status }: { status?: VideoGenerationTakeStatus }) {
    if (status === "failed") return <CircleAlert className="size-7 text-red-400" />;

    if (status === "submission_unknown") return <CircleAlert className="size-7 text-yellow-400" />;

    if (status === "completed") return <Check className="size-7 text-emerald-400" />;

    return <LoaderCircle className="size-7 animate-spin text-amber-400" />;
}

type VideoGenerationTakeStatus = VideoGenerationTake["status"];

type Translator = (key: string) => string;

function statusLabel(status: VideoGenerationTakeStatus, t: Translator) {
    if (status === "completed") return t("canvas.videoHistory.completed");

    if (status === "failed") return t("canvas.videoHistory.failed");

    if (status === "submission_unknown") return t("canvas.videoHistory.submissionUnknown");

    if (status === "submitting") return t("canvas.videoHistory.submitting");

    return t("canvas.videoHistory.inProgress");
}

function reconciliationLabel(take: VideoGenerationTake, t: Translator) {
    const reconciliation = take.reconciliation;

    if (!reconciliation) return t("canvas.videoHistory.unknown");

    const labels: Record<string, string> = {
        submitting: "canvas.videoHistory.recoverySubmitting",

        pending: "canvas.videoHistory.recoveryScanning",

        no_match: "canvas.videoHistory.recoveryNoMatch",

        candidates: "canvas.videoHistory.recoveryMultiple",

        monitoring: "canvas.videoHistory.recoveryMonitoring",

        archive_pending: "canvas.videoHistory.recoveryArchiving",

        archived: "canvas.videoHistory.recoveryArchived",

        failed: "canvas.videoHistory.recoveryFailed",

        rejected: "canvas.videoHistory.recoveryRejected",

        expired: "canvas.videoHistory.recoveryExpired",

        legacy_untracked: "canvas.videoHistory.recoveryLegacyUntracked",

        not_found: "canvas.videoHistory.recoveryNotFound",
    };

    const phaseLabel =
        reconciliation.consecutiveErrorCount > 0
            ? t("canvas.videoHistory.pollQueryRetry")
            : reconciliation.phase === "result_pending"
              ? t("canvas.videoHistory.pollResultPending")
              : reconciliation.phase === "archive_pending"
                ? t("canvas.videoHistory.pollArchiving")
                : reconciliation.phase === "initial_wait"
                  ? t("canvas.videoHistory.pollInitialWait")
                  : t(labels[reconciliation.status] || "canvas.videoHistory.unknown");

    const lines = [phaseLabel, `${t("canvas.videoHistory.recoveryChecks")} ${reconciliation.attemptCount}`];

    if (reconciliation.lastCheckedAt) lines.push(`${t("canvas.videoHistory.lastCheckedAt")} ${new Date(reconciliation.lastCheckedAt).toLocaleTimeString()}`);

    if (reconciliation.nextCheckAt) lines.push(`${t("canvas.videoHistory.nextCheckAt")} ${new Date(reconciliation.nextCheckAt).toLocaleTimeString()}`);

    return lines.join("\n");
}

function providerErrorSummary(take: VideoGenerationTake | null) {
    const details = take?.providerError;

    return [details?.message, details?.code, details?.httpStatus ? `HTTP ${details.httpStatus}` : ""].filter(Boolean).join(" · ");
}

function videoTakeDiagnosticSummary(take: VideoGenerationTake) {
    return [
        take.errorCode ? `本机错误码 ${take.errorCode}` : "",

        take.providerError?.httpStatus ? `供应商 HTTP ${take.providerError.httpStatus}` : "",

        take.providerError?.code ? `供应商错误码 ${take.providerError.code}` : "",

        take.providerError?.message || "",

        take.providerError?.requestId ? `Request ID ${take.providerError.requestId}` : "",

        `Take ID ${take.takeId}`,
    ]
        .filter(Boolean)
        .join("｜");
}
