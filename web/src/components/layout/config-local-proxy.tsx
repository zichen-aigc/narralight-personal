import { Network, Wifi } from "lucide-react";
import { Button, Form, Switch } from "antd";
import { App } from "antd";

import { useState } from "react";

import { useTranslation } from "react-i18next";

import { useConfigStore } from "@/stores/use-config-store";

export function ConfigLocalProxy({ editable }: { editable: boolean }) {
    const { message } = App.useApp();

    const { t } = useTranslation();

    const [testing, setTesting] = useState(false);

    const enabled = useConfigStore((state) => state.config.proxyEnabled);

    const updateConfig = useConfigStore((state) => state.updateConfig);

    const test = async () => {
        setTesting(true);

        try {
            const response = await fetch("/api/local/network-proxy/status", { cache: "no-store" });

            const data = response.ok ? ((await response.json()) as { enabled?: boolean }) : null;

            if (!data) throw new Error();

            message.success(t(data.enabled ? "config.proxy.available" : "config.proxy.disabled"));
        } catch {
            message.error(t("config.proxy.unreachable"));
        } finally {
            setTesting(false);
        }
    };

    return (
        <Form layout="vertical" requiredMark={false}>
            <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <Network className="size-4" />
                            {t("config.proxy.title")}
                        </div>

                        <div className="mt-1 text-xs leading-5 text-stone-500">{t("config.proxy.description")}</div>
                    </div>

                    <Switch checked={enabled} disabled={!editable} onChange={(checked) => updateConfig("proxyEnabled", checked)} />
                </div>

                <Button className="mt-4" icon={<Wifi className="size-4" />} loading={testing} onClick={() => void test()}>
                    {t("config.proxy.test")}
                </Button>

                <div className="mt-3 text-xs leading-5 text-stone-500">{t("config.proxy.portHint")}</div>
            </section>
        </Form>
    );
}
