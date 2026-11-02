import { Database, HardDrive, Layers3, RefreshCw } from "lucide-react";
import { Alert, Button, Progress, Spin } from "antd";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useTranslation } from "react-i18next";

import { readLocalStorageUsage, type LocalStorageUsage } from "@/services/local-storage-usage";

export function ConfigLocalStorage({ active }: { active: boolean }) {
    const { t } = useTranslation();

    const [usage, setUsage] = useState<LocalStorageUsage | null>(null);

    const [loading, setLoading] = useState(false);

    const [error, setError] = useState("");

    const refresh = useCallback(async () => {
        setLoading(true);

        setError("");

        try {
            setUsage(await readLocalStorageUsage());
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("config.localStorage.readFailed"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        if (active && !usage) void refresh();
    }, [active, refresh, usage]);

    const percent = usage?.disk.totalBytes ? Math.min(100, (usage.disk.usedBytes / usage.disk.totalBytes) * 100) : 0;

    return (
        <div className="space-y-3">
            <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <Database className="size-4" />

                            {t("config.localStorage.title")}
                        </div>

                        <div className="mt-1 text-xs text-stone-500">{t("config.localStorage.description")}</div>
                    </div>

                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()}>
                        {t("config.localStorage.refresh")}
                    </Button>
                </div>

                {error ? <Alert className="mt-4" type="error" showIcon title={t("config.localStorage.readFailed")} description={error} /> : null}

                {!usage && loading ? (
                    <div className="flex min-h-48 items-center justify-center">
                        <Spin />
                    </div>
                ) : usage ? (
                    <>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <StorageMetric
                                icon={<Database className="size-4" />}
                                label={t("config.localStorage.databaseUsage")}
                                value={formatStorageBytes(usage.databaseBytes)}
                                hint={t("config.localStorage.databaseHint")}
                            />

                            <StorageMetric
                                icon={<Layers3 className="size-4" />}
                                label={t("config.localStorage.platformUsage")}
                                value={formatStorageBytes(usage.totalBytes)}
                                hint={t("config.localStorage.platformHint", { count: usage.totalFiles })}
                            />

                            <StorageMetric icon={<HardDrive className="size-4" />} label={t("config.localStorage.diskFree")} value={formatStorageBytes(usage.disk.freeBytes)} hint={usage.dataRoot} />
                        </div>

                        <div className="mt-4">
                            <div className="mb-1 flex justify-between text-xs text-stone-500">
                                <span>{t("config.localStorage.diskUsage")}</span>

                                <span className="tabular-nums">{percent.toFixed(2)}%</span>
                            </div>

                            <Progress percent={percent} showInfo={false} />
                        </div>
                    </>
                ) : null}
            </section>

            {usage ? (
                <section className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
                    <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{t("config.localStorage.breakdown")}</div>

                            <div className="mt-0.5 truncate font-mono text-[11px] text-stone-500">{usage.dataRoot}</div>
                        </div>

                        <div className="shrink-0 text-sm font-medium tabular-nums">{formatStorageBytes(usage.totalBytes)}</div>
                    </div>

                    <div className="divide-y divide-stone-200 dark:divide-stone-800">
                        {[
                            ["objects", usage.objects],

                            ["backups", usage.backups],

                            ["agent", usage.agent],

                            ["logs", usage.logs],
                        ].map(([name, item]) => {
                            const value = item as { bytes: number; files: number };

                            return (
                                <div key={String(name)} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-sm">
                                    <div className="min-w-0">
                                        <div className="truncate font-medium">{t(`config.localStorage.categories.${name}`)}</div>
                                    </div>

                                    <div className="text-right text-xs text-stone-500 tabular-nums">{t("config.localStorage.files", { count: value.files })}</div>

                                    <div className="w-20 text-right font-medium tabular-nums">{formatStorageBytes(value.bytes)}</div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            ) : null}
        </div>
    );
}

function StorageMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg bg-stone-100/70 p-3 dark:bg-stone-900/70">
            <div className="flex items-center gap-2 text-xs text-stone-500">
                {icon}
                {label}
            </div>

            <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>

            <div className="mt-1 text-[11px] text-stone-500">{hint}</div>
        </div>
    );
}

function formatStorageBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;

    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;

    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
