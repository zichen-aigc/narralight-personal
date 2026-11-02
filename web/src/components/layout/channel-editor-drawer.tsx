import { ModelSelectModal } from "./model-select-modal";
import { ModelScriptEditor } from "./model-script-editor";
import { ListPlus, Trash2 } from "lucide-react";
import { Button, Drawer, Input, Segmented, Select, Space } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
    defaultBaseUrlForApiFormat,
    guessCapability,
    normalizeChannelModels,
    type ApiCallFormat,
    type ChannelModel,
    type ModelCapability,
    type ModelChannel,
    type ModelOperation,
} from "@/stores/use-config-store";

import { isModelBackendSupported, useBackendModelContracts } from "@/lib/backend-model-contract";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

const pilotOperationLabels: Partial<Record<ModelOperation, string>> = { "image.generate": "文生图", "video.text": "文生视频", "video.image": "图生视频", "video.reference": "参考生视频" };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();

    useBackendModelContracts();

    const [draft, setDraft] = useState<ModelChannel | null>(channel);

    const [selectOpen, setSelectOpen] = useState(false);

    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);

    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },

        { label: "Gemini", value: "gemini" },

        { label: t("config.protocols.ark"), value: "ark" },
    ];

    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({
        label: t(`config.channelEditor.capabilities.${value}`),
        value: value as ModelCapability,
    }));

    useEffect(() => {
        if (open && channel) setDraft(channel);
    }, [open, channel]);

    if (!draft) return null;

    const managedCredential = Boolean(draft.credentialTarget);

    const fixedPilot = draft.provider === "888api";

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));

    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;

        patch({ apiFormat, baseUrl });
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));

        setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));

    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));

    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const save = () => {
        onSave({ ...draft, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });

        onClose();
    };

    return (
        <Drawer
            open={open}

            width={640}

            title={t("config.channelEditor.title")}

            onClose={onClose}

            styles={{ body: { paddingTop: 16 } }}

            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>

                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>

                    <Input value={draft.name} disabled={fixedPilot} onChange={(event) => patch({ name: event.target.value })} />
                </label>

                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>

                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} disabled={managedCredential} onChange={changeApiFormat} />
                </label>

                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>

                    <Input value={draft.baseUrl} disabled={managedCredential} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>

                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">API Key</span>

                    <Input.Password value={draft.apiKey} disabled={managedCredential} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="sk-..." />

                    {managedCredential ? <span className="mt-1 block text-xs text-stone-500">Windows Credential Manager：{draft.credentialTarget}</span> : null}
                </label>
            </div>

            {fixedPilot ? (
                <div className="mt-4 text-sm leading-6 text-stone-600 dark:text-stone-300">
                    888API 当前是服务端预置试点：型号和公开价格仅作规划展示。账户授权、素材中继与归档目标未验收前，创作者侧不能提交付费生成。
                </div>
            ) : null}

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>

                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>

                <Button type="primary" icon={<ListPlus className="size-4" />} disabled={fixedPilot} onClick={() => setSelectOpen(true)}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models
                        .filter((model) => isModelBackendSupported(model.name))
                        .map((model) => (
                            <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                                <span className="min-w-0 flex-1 text-sm" title={model.name}>
                                    <span className="block truncate">{model.name}</span>

                                    {fixedPilot ? (
                                        <span className="mt-0.5 block text-xs text-stone-500 dark:text-stone-400">
                                            {model.operations?.map((operation) => pilotOperationLabels[operation] || operation).join(" · ")} · 待验证
                                        </span>
                                    ) : null}

                                    {fixedPilot && model.publicPrice ? (
                                        <span className="mt-0.5 block text-xs text-stone-500 dark:text-stone-400">
                                            公开价 ¥{model.publicPrice.rmb}/{model.publicPrice.unit} · {model.publicPrice.capturedAt} · 待实账核验 ·{" "}
                                            <a className="underline underline-offset-2" href={model.publicPrice.sourceUrl} target="_blank" rel="noopener noreferrer">
                                                价格来源
                                            </a>
                                        </span>
                                    ) : null}
                                </span>

                                <div className="flex shrink-0 items-center gap-2">
                                    <Segmented
                                        size="small"
                                        value={model.capability}
                                        options={capabilityOptions}
                                        disabled={fixedPilot}
                                        onChange={(value) => setCapability(model.name, value as ModelCapability)}
                                    />

                                    <Button
                                        size="small"
                                        type={model.script ? "primary" : "default"}
                                        ghost={Boolean(model.script)}
                                        disabled={fixedPilot}
                                        onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}
                                    >
                                        {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                    </Button>

                                    <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} disabled={fixedPilot} onClick={() => removeModel(model.name)} />
                                </div>
                            </div>
                        ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}

                capability={scriptTarget?.capability || "text"}

                modelName={scriptTarget?.name || ""}

                value={scriptTarget?.value || ""}

                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}

                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}
