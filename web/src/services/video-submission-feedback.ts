import i18n from "@/i18n";
import { failVideoGenerationTakeIfSafe, readVideoGenerationTake, type VideoGenerationTake } from "@/services/video-generation-take";

export type VideoSubmissionState = "not_submitted" | "submitted" | "unknown";
export type VideoSubmissionFeedback = {
    take?: VideoGenerationTake;
    state: VideoSubmissionState;
    message: string;
};
export type VideoSubmissionRetryDecision = "resume_original" | "safe_resubmit" | "wait_for_reconciliation" | "allow_new_submission";

const NOT_SUBMITTED_ERROR = "provider_request_not_sent";
export const VIDEO_SUBMISSION_RECONCILE_WINDOW_MS = 20_000;

export function videoSubmissionStateForTake(take: Pick<VideoGenerationTake, "status" | "taskId" | "errorCode" | "providerError">): VideoSubmissionState {
    if (take.taskId || take.providerError) return "submitted";
    if (["submitting", "submission_unknown"].includes(take.status)) return "unknown";
    if (take.status === "created" || take.errorCode === NOT_SUBMITTED_ERROR) return "not_submitted";
    return "unknown";
}

export function videoSubmissionRetryDecision(take: Pick<VideoGenerationTake, "status" | "taskId" | "errorCode" | "providerError" | "createdAt" | "updatedAt">, now = Date.now()): VideoSubmissionRetryDecision {
    if (take.taskId) return "resume_original";
    const state = videoSubmissionStateForTake(take);
    if (state === "not_submitted") return "safe_resubmit";
    if (state === "unknown" && videoSubmissionReconcileRemainingMs(take, now) > 0) return "wait_for_reconciliation";
    return "allow_new_submission";
}

export function videoSubmissionReconcileRemainingMs(take: Pick<VideoGenerationTake, "createdAt" | "updatedAt">, now = Date.now()) {
    const startedAt = Date.parse(take.updatedAt || take.createdAt);
    return Number.isFinite(startedAt) ? Math.max(0, VIDEO_SUBMISSION_RECONCILE_WINDOW_MS - Math.max(0, now - startedAt)) : 0;
}

export async function waitForVideoSubmissionRelease(take: VideoGenerationTake) {
    let latest = take;
    const deadline = Date.now() + videoSubmissionReconcileRemainingMs(take);
    while (!latest.taskId && videoSubmissionStateForTake(latest) === "unknown" && Date.now() < deadline) {
        await delay(Math.min(1_000, Math.max(1, deadline - Date.now())));
        latest = await readVideoGenerationTake(take.takeId).catch(() => latest);
    }
    return latest;
}

export function describeVideoSubmissionFailure(take: VideoGenerationTake, error?: unknown): VideoSubmissionFeedback {
    const state = videoSubmissionStateForTake(take);
    if (state === "not_submitted") {
        return { take, state, message: appendUnlessIncluded(errorMessage(error), i18n.t("videoSubmission.notSubmitted")) };
    }
    if (["submitting", "submission_unknown"].includes(take.status)) {
        return { take, state: "unknown", message: i18n.t("videoSubmission.unknown") };
    }
    if (take.providerError) {
        return { take, state: "submitted", message: join(i18n.t("videoSubmission.rejected"), providerFailureSummary(take.providerError)) };
    }
    if (take.taskId) {
        return { take, state: "submitted", message: i18n.t("videoSubmission.originalTask", { taskId: take.taskId }) };
    }
    return { take, state: "unknown", message: join(errorMessage(error), i18n.t("videoSubmission.unconfirmed")) };
}

export async function resolveVideoSubmissionFailure(takeId: string, error: unknown): Promise<VideoSubmissionFeedback> {
    let take: VideoGenerationTake;
    try {
        take = await readVideoGenerationTake(takeId);
    } catch {
        return { state: "unknown", message: i18n.t("videoSubmission.unconfirmed") };
    }
    if (take.status === "created") {
        take = await failVideoGenerationTakeIfSafe(takeId, NOT_SUBMITTED_ERROR).catch(() => take);
    }
    return describeVideoSubmissionFailure(take, error);
}

export function providerFailureSummary(details: NonNullable<VideoGenerationTake["providerError"]>) {
    return [details.message, details.code, details.httpStatus ? `HTTP ${details.httpStatus}` : "", details.requestId ? `Request ID ${details.requestId}` : ""].filter(Boolean).join(" · ");
}

export function visibleVideoFailure(input: { errorDetails?: string; model?: string; referenceMode?: string; hasTask?: boolean }) {
    const original = String(input.errorDetails || "").trim();
    if (input.hasTask || !original) return original;
    const oldHttp400 = /视频版本写入失败\s*[（(]HTTP 400[）)]|video take write failed.*HTTP 400/i.test(original);
    if (oldHttp400 && input.referenceMode === "text_to_video") return i18n.t("videoSubmission.legacyReferenceMode400");
    if (["生成失败", "Generation failed"].includes(original) || oldHttp400) return i18n.t("videoSubmission.legacyDiagnosticMissing");
    return original;
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message.trim() : "";
}

function join(...parts: string[]) {
    return [...new Set(parts.filter(Boolean))].join(" · ");
}

function appendUnlessIncluded(message: string, suffix: string) {
    return message.includes(suffix) ? message : join(message, suffix);
}

function delay(ms: number) {
    return new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));
}
