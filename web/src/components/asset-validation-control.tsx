import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { Alert, Button, Modal, Progress, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { App, Empty, theme as antdTheme } from "antd";

import { Image as ImageIcon, Music2, RadioTower, ShieldCheck, Video } from "lucide-react";

import { useTranslation } from "react-i18next";

import { ASSET_STATUS_TOOLTIP_DELAY_SECONDS, buildAssetValidationIndicators, type AssetValidationIndicator } from "@/components/asset-validation-status";

import {
    dedupeVolcAssetReferences,
    isVolcAssetBindingAllowed,
    isVolcAssetRegistrationRunning,
    volcAssetBatchItemDiagnostic,
    volcAssetBatchSubmissionReferences,
    volcAssetGateConfig,
    volcAssetGenerationStatusTone,
    volcAssetRegistrationProgress,
    volcAssetStatusTone,
    volcAssetVisibleDiagnostic,
    type VolcAssetBatchReviewItem,
    type VolcAssetBinding,
    type VolcAssetStatusTone,
    type VolcAssetValidationReference,
} from "@/services/volc-asset-validation";

import { startAssetValidationSync, useAssetValidationStore } from "@/stores/use-asset-validation-store";

import type { AiConfig } from "@/stores/use-config-store";

export function AssetValidationStatusIcons({ binding, onOpen }: { binding?: VolcAssetBinding; onOpen?: () => void }) {
    const { t } = useTranslation();

    const { token } = antdTheme.useToken();

    const indicators = buildAssetValidationIndicators(binding);

    const colorForTone = (tone: VolcAssetStatusTone) =>
        tone === "success" ? token.colorSuccess : tone === "error" ? token.colorError : tone === "processing" || tone === "warning" ? token.colorWarning : token.colorTextQuaternary;

    const renderIndicator = (indicator: AssetValidationIndicator) => {
        const Icon = indicator.kind === "review" ? ShieldCheck : RadioTower;

        const label = t(indicator.kind === "review" ? `assetValidation.status.${indicator.status}` : `assetValidation.generationStatus.${indicator.status}`);

        const content = <Icon className="size-3.5" strokeWidth={2.4} aria-hidden />;

        return (
            <Tooltip key={indicator.kind} title={label} mouseEnterDelay={ASSET_STATUS_TOOLTIP_DELAY_SECONDS}>
                {indicator.kind === "review" && onOpen ? (
                    <button
                        type="button"
                        className="grid size-6 place-items-center rounded-md transition hover:bg-black/10 dark:hover:bg-white/10"
                        style={{ color: colorForTone(indicator.tone) }}
                        aria-label={label}
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpen();
                        }}
                    >
                        {content}
                    </button>
                ) : (
                    <span
                        role="img"
                        aria-label={label}
                        tabIndex={0}
                        className="grid size-5 place-items-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                        style={{ color: colorForTone(indicator.tone) }}
                    >
                        {content}
                    </span>
                )}
            </Tooltip>
        );
    };

    return (
        <span className="inline-flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
            {indicators.map(renderIndicator)}
        </span>
    );
}

function AssetValidationStatusLabels({ binding }: { binding?: VolcAssetBinding }) {
    const { t } = useTranslation();

    const status = binding?.status || "unverified";

    const generationStatus = binding?.generationStatus || "unverified";

    return (
        <Space size={4} wrap>
            <Tag color={volcAssetStatusTone(status)} className="!m-0">
                {t(`assetValidation.status.${status}`)}
            </Tag>

            {binding?.classification === "real_person" && status === "active" ? (
                <Tag color={volcAssetGenerationStatusTone(generationStatus)} className="!m-0">
                    {t(`assetValidation.generationStatus.${generationStatus}`)}
                </Tag>
            ) : null}
        </Space>
    );
}

export function AssetValidationDialog({ open, reference, onClose }: { open: boolean; reference: VolcAssetValidationReference | null; onClose: () => void }) {
    const { message } = App.useApp();

    const { t } = useTranslation();

    const binding = useAssetValidationStore((state) => (reference ? state.bindings[reference.localRef] : undefined));

    const registration = useAssetValidationStore((state) => (reference ? state.registrations[reference.localRef] : undefined));

    const config = useAssetValidationStore((state) => state.config);

    const busy = useAssetValidationStore((state) => Boolean(reference && state.busy[reference.localRef]));

    const loadConfig = useAssetValidationStore((state) => state.loadConfig);

    const check = useAssetValidationStore((state) => state.check);

    const classify = useAssetValidationStore((state) => state.classify);

    const submitReview = useAssetValidationStore((state) => state.submitReview);

    const refreshRegistration = useAssetValidationStore((state) => state.refreshRegistration);

    const retryGenerationVisibility = useAssetValidationStore((state) => state.retryGenerationVisibility);

    useEffect(() => {
        startAssetValidationSync();

        if (open && reference) void Promise.allSettled([check([reference]), loadConfig(), refreshRegistration(reference)]);
    }, [check, loadConfig, open, reference?.localRef, reference?.mediaKind, reference?.projectId, refreshRegistration]);

    useEffect(() => {
        if (!open || !reference || !isVolcAssetRegistrationRunning(registration?.status)) return;

        const timer = window.setInterval(() => void refreshRegistration(reference), 5_000);

        return () => window.clearInterval(timer);
    }, [open, reference?.localRef, refreshRegistration, registration?.status]);

    const apply = async (classification: "ordinary" | "real_person") => {
        if (!reference) return;

        try {
            const next = await classify(reference, classification);

            message.success(
                t(classification === "ordinary" ? "assetValidation.markedOrdinary" : next.status === "credentials_missing" ? "assetValidation.awaitingCredentials" : "assetValidation.updated"),
            );
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("assetValidation.failed"));
        }
    };

    const beginReview = async () => {
        if (!reference) return;

        try {
            if (binding?.classification !== "real_person") await classify(reference, "real_person");

            await submitReview(reference);

            message.success(t("assetValidation.reviewSubmitted"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("assetValidation.failed"));
        }
    };

    const retryVisibility = async () => {
        if (!reference) return;

        try {
            await retryGenerationVisibility(reference);

            message.success(t("assetValidation.generationRetryReady"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("assetValidation.failed"));
        }
    };

    const canRetryReview = registration?.status === "failed";

    const projectMigrationRequired = Boolean(registration && registration.projectName !== config.projectName);

    const flowExists = Boolean(registration && !canRetryReview && !projectMigrationRequired);

    const running = isVolcAssetRegistrationRunning(registration?.status);

    const terminal = binding?.status === "active" || binding?.status === "not_required" || binding?.status === "failed";

    const progress = terminal
        ? 100
        : running
          ? registration?.status === "processing" || registration?.status === "delayed" || registration?.status === "accelerating"
              ? 72
              : registration?.status === "submitting" || registration?.status === "reconciling"
                ? 48
                : 24
          : 0;

    const integrationReady = config.remoteIntegrationEnabled && config.credentialsConfigured && config.relayAvailable;

    const diagnostic = volcAssetVisibleDiagnostic(registration, binding);

    return (
        <Modal title={t("assetValidation.title")} open={open} onCancel={onClose} footer={null} destroyOnHidden>
            <div className="space-y-4 pt-1">
                <div className="flex items-center gap-3 rounded-2xl border border-black/10 p-3 dark:border-white/10">
                    <AssetPreview reference={reference} className="size-16" />

                    <div className="min-w-0">
                        <Typography.Text className="block truncate">{reference?.title || t("assetValidation.asset")}</Typography.Text>

                        <Typography.Text type="secondary" className="text-xs">
                            {t(`assets.kinds.${reference?.mediaKind || "image"}`)}
                        </Typography.Text>

                        <div className="mt-1">
                            <AssetValidationStatusLabels binding={binding} />
                        </div>
                    </div>
                </div>

                {progress ? (
                    <Progress
                        percent={progress}
                        status={binding?.status === "failed" ? "exception" : binding?.status === "active" || binding?.status === "not_required" ? "success" : "active"}
                        showInfo={false}
                    />
                ) : null}

                <Typography.Paragraph className="!mb-0 !text-sm">
                    {registration ? t(`assetValidation.registrationStatus.${registration.status}`) : t("assetValidation.readyToSubmit")}
                </Typography.Paragraph>

                {!config.remoteIntegrationEnabled ? (
                    <Alert type="warning" showIcon title={t("assetValidation.remoteDisabled")} description={t("assetValidation.remoteDisabledHint")} />
                ) : !config.credentialsConfigured ? (
                    <Alert type="warning" showIcon title={t("assetValidation.credentialsMissing")} />
                ) : !config.relayAvailable ? (
                    <Alert type="warning" showIcon title={t("assetValidation.relayMissing")} />
                ) : null}

                {diagnostic ? (
                    <Alert
                        type={running ? "info" : "error"}
                        showIcon
                        title={t(binding?.generationErrorMessage ? "assetValidation.generationUnavailable" : running ? "assetValidation.backgroundRunning" : "assetValidation.failed")}
                        description={<span className="break-all whitespace-pre-wrap">{diagnostic}</span>}
                    />
                ) : null}

                {projectMigrationRequired ? (
                    <Alert
                        type="warning"
                        showIcon
                        title={t("assetValidation.projectMismatch")}
                        description={t("assetValidation.projectMismatchHint", { current: registration?.projectName, target: config.projectName })}
                    />
                ) : null}

                <Button
                    type="primary"
                    block
                    icon={running ? <Clock3 className="size-4" /> : <ShieldCheck className="size-4" />}
                    loading={busy}
                    disabled={running || (!flowExists && !integrationReady)}
                    onClick={() =>
                        projectMigrationRequired
                            ? void beginReview()
                            : binding?.status === "active" || binding?.status === "not_required" || flowExists
                              ? reference && void check([reference])
                              : void beginReview()
                    }
                >
                    {t(
                        running
                            ? "assetValidation.backgroundRunning"
                            : projectMigrationRequired
                              ? "assetValidation.migrateProject"
                              : binding?.status === "active" || binding?.status === "not_required" || flowExists
                                ? "assetValidation.recheck"
                                : canRetryReview
                                  ? "assetValidation.retryReview"
                                  : "assetValidation.submitReview",
                    )}
                </Button>

                <div className="flex items-center justify-between gap-3">
                    {binding?.classification !== "real_person" ? (
                        <Button type="text" size="small" loading={busy} onClick={() => void apply("ordinary")}>
                            {t("assetValidation.markOrdinary")}
                        </Button>
                    ) : (
                        <span />
                    )}

                    {binding?.generationStatus === "inaccessible" ? (
                        <Button type="text" size="small" loading={busy} onClick={() => void retryVisibility()}>
                            {t("assetValidation.retryGenerationVisibility")}
                        </Button>
                    ) : null}
                </div>

                <details className="text-xs text-black/55 dark:text-white/55">
                    <summary className="cursor-pointer select-none">{t("assetValidation.details")}</summary>

                    <div className="mt-2 space-y-2 rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]">
                        <p className="m-0">{t("assetValidation.description")}</p>

                        <p className="m-0">{t("assetValidation.ordinaryWarning")}</p>

                        {registration?.assetId ? <p className="m-0 break-all">Asset ID: {registration.assetId}</p> : null}

                        {diagnostic ? <p className="m-0 break-all whitespace-pre-wrap text-red-600 dark:text-red-400">{diagnostic}</p> : null}
                    </div>
                </details>
            </div>
        </Modal>
    );
}

export function AssetValidationButton({ reference, compact = false }: { reference: VolcAssetValidationReference; compact?: boolean }) {
    const { t } = useTranslation();

    const binding = useAssetValidationStore((state) => state.bindings[reference.localRef]);

    const check = useAssetValidationStore((state) => state.check);

    const [open, setOpen] = useState(false);

    useEffect(() => {
        startAssetValidationSync();

        void check([reference]);
    }, [check, reference.localRef, reference.mediaKind, reference.projectId]);

    return (
        <>
            {compact ? (
                <AssetValidationStatusIcons binding={binding} onOpen={() => setOpen(true)} />
            ) : (
                <>
                    <Button
                        type="text"
                        size="small"
                        icon={<ShieldCheck className="size-3.5" />}
                        onClick={(event) => {
                            event.stopPropagation();
                            setOpen(true);
                        }}
                    >
                        {t("assetValidation.validate")}
                    </Button>

                    <AssetValidationStatusLabels binding={binding} />
                </>
            )}

            <AssetValidationDialog open={open} reference={reference} onClose={() => setOpen(false)} />
        </>
    );
}

export function AssetValidationBatchButton({ config, references, buttonClassName }: { config: AiConfig; references: VolcAssetValidationReference[]; buttonClassName?: string }) {
    const { message } = App.useApp();

    const { t } = useTranslation();

    const bindings = useAssetValidationStore((state) => state.bindings);

    const registrations = useAssetValidationStore((state) => state.registrations);

    const validationConfig = useAssetValidationStore((state) => state.config);

    const loadConfig = useAssetValidationStore((state) => state.loadConfig);

    const check = useAssetValidationStore((state) => state.check);

    const refreshBatch = useAssetValidationStore((state) => state.refreshBatch);

    const submitBatchReview = useAssetValidationStore((state) => state.submitBatchReview);

    const [open, setOpen] = useState(false);

    const [busy, setBusy] = useState(false);

    const [batchErrors, setBatchErrors] = useState<VolcAssetBatchReviewItem[]>([]);

    const gate = volcAssetGateConfig(config);

    const mediaReferences = useMemo(() => dedupeVolcAssetReferences(references), [references]);

    const migrationRequiredReferences = mediaReferences.filter((reference) => {
        const registration = registrations[reference.localRef];

        return Boolean(registration && registration.projectName !== validationConfig.projectName);
    });

    const migrationRequiredRefs = new Set(migrationRequiredReferences.map((reference) => reference.localRef));

    const allPassed =
        mediaReferences.length > 0 &&
        mediaReferences.every((reference) => {
            const binding = bindings[reference.localRef];

            return !migrationRequiredRefs.has(reference.localRef) && isVolcAssetBindingAllowed(binding);
        });

    const completedCount = mediaReferences.filter((reference) => isTerminalBinding(bindings[reference.localRef])).length;

    const failedCount = mediaReferences.filter((reference) => migrationRequiredRefs.has(reference.localRef) || isFailedBinding(bindings[reference.localRef])).length + batchErrors.length;

    const visibilityPending = mediaReferences.some((reference) => bindings[reference.localRef]?.status === "active" && bindings[reference.localRef]?.generationStatus === "unverified");

    const progress = mediaReferences.length
        ? Math.round(mediaReferences.reduce((sum, reference) => sum + volcAssetRegistrationProgress(registrations[reference.localRef], bindings[reference.localRef]), 0) / mediaReferences.length)
        : 0;

    const hasRunning = mediaReferences.some((reference) => isVolcAssetRegistrationRunning(registrations[reference.localRef]?.status));

    const stageCounts = mediaReferences.reduce<Record<string, number>>((counts, reference) => {
        const status = registrations[reference.localRef]?.status;

        if (status && isVolcAssetRegistrationRunning(status)) counts[status] = (counts[status] || 0) + 1;

        return counts;
    }, {});

    const configurationBlocked = !validationConfig.remoteIntegrationEnabled || !validationConfig.credentialsConfigured || !validationConfig.relayAvailable;

    useEffect(() => {
        if (gate.required) startAssetValidationSync();
    }, [gate.required]);

    useEffect(() => {
        if (!open || !hasRunning) return;

        const refresh = () => void refreshBatch(mediaReferences).catch(() => undefined);

        refresh();

        const timer = window.setInterval(refresh, 3_000);

        return () => window.clearInterval(timer);
    }, [hasRunning, mediaReferences, open, refreshBatch]);

    if (!gate.required) return null;

    const runBatch = async () => {
        setOpen(true);

        if (!mediaReferences.length) return;

        setBusy(true);

        setBatchErrors([]);

        try {
            const [checked, remoteConfig] = await Promise.all([check(mediaReferences), loadConfig()]);

            if (!remoteConfig.remoteIntegrationEnabled || !remoteConfig.credentialsConfigured || !remoteConfig.relayAvailable) {
                message.warning(
                    t(
                        !remoteConfig.remoteIntegrationEnabled
                            ? "assetValidation.remoteDisabled"
                            : !remoteConfig.credentialsConfigured
                              ? "assetValidation.credentialsMissing"
                              : "assetValidation.relayMissing",
                    ),
                );

                return;
            }

            const currentRegistrations = useAssetValidationStore.getState().registrations;

            const migrationRequired = mediaReferences.filter(
                (reference) => currentRegistrations[reference.localRef]?.projectName !== undefined && currentRegistrations[reference.localRef]?.projectName !== remoteConfig.projectName,
            );

            const needsSubmission = volcAssetBatchSubmissionReferences(mediaReferences, checked, currentRegistrations, remoteConfig.projectName);

            if (!needsSubmission.length) {
                const passedNow = !migrationRequired.length && checked.every(isVolcAssetBindingAllowed);

                message[migrationRequired.length ? "warning" : "info"](
                    t(migrationRequired.length ? "assetValidation.batchMigrationRequired" : passedNow ? "assetValidation.allPassed" : "assetValidation.batchBackgroundRunning"),
                );

                return;
            }

            const result = await submitBatchReview(needsSubmission);

            const itemErrors = result.items.filter((item) => item.error);

            setBatchErrors(itemErrors);

            const errors = itemErrors.length + migrationRequired.length;

            const firstDiagnostic = volcAssetBatchItemDiagnostic(itemErrors[0]);

            message[errors ? "warning" : "success"](
                [t(errors ? "assetValidation.batchPartial" : "assetValidation.batchSubmitted", { count: needsSubmission.length }), firstDiagnostic].filter(Boolean).join("｜"),
            );
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("assetValidation.failed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Button type="text" className={buttonClassName || "!h-10 !rounded-full !px-3"} icon={<ShieldCheck className="size-4" />} loading={busy} onClick={() => void runBatch()}>
                {t("assetValidation.batchValidate")}

                {allPassed ? <span className="ml-1 size-1.5 rounded-full bg-emerald-500" /> : null}
            </Button>

            <Modal
                title={t("assetValidation.batchTitle")}

                open={open}

                onCancel={() => setOpen(false)}

                width={620}

                destroyOnHidden

                footer={
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-black/55 dark:text-white/55">{t("assetValidation.batchProgress", { completed: completedCount, total: mediaReferences.length })}</span>
                        <Button onClick={() => setOpen(false)}>{t("assetValidation.close")}</Button>
                    </div>
                }
            >
                {mediaReferences.length ? (
                    <div className="space-y-5 pt-1">
                        <div className="flex flex-wrap gap-2">
                            {mediaReferences.map((reference) => (
                                <BatchAssetThumbnail key={reference.localRef} reference={reference} binding={bindings[reference.localRef]} />
                            ))}
                        </div>

                        <Progress percent={progress} status={failedCount ? "exception" : allPassed ? "success" : "active"} />

                        {Object.keys(stageCounts).length ? (
                            <div className="flex flex-wrap gap-2">
                                {Object.entries(stageCounts).map(([status, count]) => (
                                    <Tag key={status} color="processing">
                                        {t(`assetValidation.registrationStatus.${status}`)} · {count}
                                    </Tag>
                                ))}
                            </div>
                        ) : null}

                        {configurationBlocked ? (
                            <Alert
                                type="warning"
                                showIcon
                                title={t(
                                    !validationConfig.remoteIntegrationEnabled
                                        ? "assetValidation.remoteDisabled"
                                        : !validationConfig.credentialsConfigured
                                          ? "assetValidation.credentialsMissing"
                                          : "assetValidation.relayMissing",
                                )}
                            />
                        ) : null}

                        <div className="flex items-center gap-2 text-sm font-medium">
                            {failedCount ? (
                                <XCircle className="size-5 text-red-500" />
                            ) : allPassed ? (
                                <CheckCircle2 className="size-5 text-emerald-500" />
                            ) : (
                                <Clock3 className="size-5 text-amber-500" />
                            )}

                            <span>
                                {t(
                                    failedCount
                                        ? "assetValidation.batchHasFailures"
                                        : allPassed
                                          ? "assetValidation.allPassed"
                                          : configurationBlocked
                                            ? "assetValidation.batchConfigurationRequired"
                                            : "assetValidation.batchBackgroundRunning",
                                )}
                            </span>
                        </div>

                        {batchErrors.map((item, index) => (
                            <Alert
                                key={`batch:${item.localRef || index}`}
                                type="error"
                                showIcon
                                title={mediaReferences.find((reference) => reference.localRef === item.localRef)?.title || item.localRef || t("assetValidation.asset")}
                                description={<span className="break-all whitespace-pre-wrap">{volcAssetBatchItemDiagnostic(item) || t("assetValidation.failed")}</span>}
                            />
                        ))}

                        {mediaReferences
                            .filter((reference) => isFailedBinding(bindings[reference.localRef]))
                            .map((reference) => (
                                <Alert
                                    key={reference.localRef}
                                    type="error"
                                    showIcon
                                    title={reference.title || t("assetValidation.asset")}
                                    description={
                                        <span className="break-all whitespace-pre-wrap">
                                            {volcAssetVisibleDiagnostic(registrations[reference.localRef], bindings[reference.localRef]) || t("assetValidation.failed")}
                                        </span>
                                    }
                                />
                            ))}

                        {migrationRequiredReferences.map((reference) => (
                            <Alert
                                key={`migration:${reference.localRef}`}
                                type="warning"
                                showIcon
                                title={reference.title || t("assetValidation.asset")}
                                description={t("assetValidation.batchMigrationRequired")}
                            />
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("assetValidation.noReferences")} />
                )}
            </Modal>
        </>
    );
}

function AssetPreview({ reference, className }: { reference: VolcAssetValidationReference | null; className: string }) {
    const mediaKind = reference?.mediaKind || "image";

    if (mediaKind === "image" && reference?.previewUrl) return <img src={reference.previewUrl} alt="" className={`${className} shrink-0 rounded-xl object-cover`} />;

    if (mediaKind === "video" && reference?.previewUrl) return <video src={reference.previewUrl} className={`${className} shrink-0 rounded-xl bg-black object-cover`} muted preload="metadata" />;

    const Icon = mediaKind === "audio" ? Music2 : mediaKind === "video" ? Video : ImageIcon;

    return (
        <span className={`${className} grid shrink-0 place-items-center rounded-xl bg-black/5 dark:bg-white/10`}>
            <Icon className="size-5 opacity-60" />
        </span>
    );
}

function BatchAssetThumbnail({ reference, binding }: { reference: VolcAssetValidationReference; binding?: VolcAssetBinding }) {
    const passed = binding?.status === "not_required" || (binding?.status === "active" && binding.generationStatus !== "inaccessible");

    const failed = isFailedBinding(binding);

    return (
        <div className="relative" title={reference.title}>
            <AssetPreview reference={reference} className="size-14" />

            <span
                className={`absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-white text-white dark:border-stone-900 ${failed ? "bg-red-500" : passed ? "bg-emerald-500" : "bg-amber-500"}`}
            >
                {failed ? <XCircle className="size-3.5" /> : passed ? <CheckCircle2 className="size-3.5" /> : <Clock3 className="size-3.5" />}
            </span>
        </div>
    );
}

function isTerminalBinding(binding?: VolcAssetBinding) {
    return binding?.status === "not_required" || binding?.status === "active" || binding?.status === "failed" || binding?.status === "expired" || binding?.status === "project_mismatch";
}

function isFailedBinding(binding?: VolcAssetBinding) {
    return binding?.status === "failed" || binding?.status === "expired" || binding?.status === "project_mismatch" || binding?.generationStatus === "inaccessible";
}
