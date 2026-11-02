import { Alert, Button, Drawer, Input, Segmented, Tabs, Tag } from "antd";
import { App } from "antd";

import { useMemo, useState } from "react";

import { createRichBestAssetGroup, fetchRichBestModels, listRichBestAssets, queryRichBestUsage, uploadAndRegisterRichBestAsset, verifyRichBest } from "@/services/api/richbest";

import { applyRichBestAuthorizedModels, type ModelChannel } from "@/stores/use-config-store";

function dateInput(value: Date) {
    return value.toISOString().slice(0, 10);
}

function resultText(value: unknown) {
    return JSON.stringify(value, null, 2).slice(0, 12_000);
}

export function RichBestToolsDrawer({
    open,
    channel,
    onChannelChange,
    onClose,
}: {
    open: boolean;
    channel: ModelChannel | null;
    onChannelChange: (channel: ModelChannel) => void;
    onClose: () => void;
}) {
    const { message } = App.useApp();

    const [busy, setBusy] = useState("");

    const [result, setResult] = useState<unknown>(null);

    const [arkApiKey, setArkApiKey] = useState("");

    const [start, setStart] = useState(dateInput(new Date(Date.now() - 7 * 86400_000)));

    const [end, setEnd] = useState(dateInput(new Date()));

    const [interval, setInterval] = useState<"Hour" | "Day">("Day");

    const [groupId, setGroupId] = useState("");

    const [groupName, setGroupName] = useState("叙光素材");

    const [file, setFile] = useState<File | null>(null);

    const [usageSyncedAt, setUsageSyncedAt] = useState("");

    const configured = Boolean(channel?.apiKey);

    const channelId = channel?.id || "richbest";

    const pretty = useMemo(() => (result === null ? "" : resultText(result)), [result]);

    const modelStatus =
        channel?.modelsSource === "live"
            ? `实时授权 ${channel.models.length} 个 · ${channel.modelsCheckedAt ? new Date(channel.modelsCheckedAt).toLocaleString("zh-CN", { hour12: false }) : "时间未知"}`
            : `文档目录 ${channel?.models.length || 0} 个 · 尚未读取实时授权`;

    const run = async (key: string, action: () => Promise<unknown>) => {
        setBusy(key);

        try {
            const value = await action();

            setResult(value);

            message.success("操作成功");
        } catch (error) {
            const text = error instanceof Error ? error.message : "操作失败";

            setResult({ error: text });

            message.error(text);
        } finally {
            setBusy("");
        }
    };

    return (
        <Drawer open={open} width={720} title="火山瑞池工具" onClose={onClose}>
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                <Tag color={configured ? "green" : "orange"}>{configured ? "业务 Key 已保存" : "等待正式业务 Key"}</Tag>

                <span className="text-stone-500">接口：{channel?.baseUrl || "https://api.richbest.cn"}</span>
            </div>

            <Tabs
                items={[
                    {
                        key: "connection",
                        label: "连接与模型",
                        children: (
                            <div className="space-y-3">
                                <div className="text-sm text-stone-500">验证业务 Key，并按当前项目实时读取已开通模型。模型列表为空与鉴权失败会分开显示。</div>

                                <div className="text-xs text-stone-500">{modelStatus}</div>

                                <div className="flex gap-2">
                                    <Button loading={busy === "verify"} onClick={() => void run("verify", () => verifyRichBest(channelId))}>
                                        验证业务 Key
                                    </Button>

                                    <Button
                                        loading={busy === "models"}
                                        onClick={() =>
                                            void run("models", async () => {
                                                if (!channel) throw new Error("火山瑞池渠道不存在");

                                                const models = await fetchRichBestModels(channelId);

                                                const checkedAt = new Date().toISOString();

                                                onChannelChange(applyRichBestAuthorizedModels(channel, models, checkedAt));

                                                return { checkedAt, count: models.length, models };
                                            })
                                        }
                                    >
                                        读取并应用实时模型
                                    </Button>
                                </div>

                                <Alert
                                    showIcon
                                    type="info"
                                    title="实时列表会直接替换当前可选模型"
                                    description="瑞池只允许调用 /v1/models 当前返回的模型；返回空列表时，瑞池渠道不会继续展示文档目录中的模型。"
                                />

                                <Alert showIcon type="info" title="费用以供应商账单为准" description="请在供应商后台确认模型价格和余额。" />
                            </div>
                        ),
                    },

                    {
                        key: "assets",
                        label: "素材审核",
                        children: (
                            <div className="space-y-4">
                                <label className="block">
                                    <span className="mb-1 block text-sm font-medium">素材组名称</span>
                                    <Input value={groupName} maxLength={64} onChange={(event) => setGroupName(event.target.value)} />
                                </label>

                                <Button
                                    loading={busy === "group"}
                                    disabled={!groupName.trim()}
                                    onClick={() =>
                                        void run("group", async () => {
                                            const value = await createRichBestAssetGroup({ channelId, name: groupName.trim() });

                                            const data = value as Record<string, unknown>;

                                            const inner = data.data && typeof data.data === "object" ? (data.data as Record<string, unknown>) : data;

                                            const id = String(inner.groupId || inner.id || "");

                                            if (id) setGroupId(id);

                                            return value;
                                        })
                                    }
                                >
                                    新建素材组
                                </Button>

                                <label className="block">
                                    <span className="mb-1 block text-sm font-medium">素材组 ID</span>
                                    <Input value={groupId} placeholder="group-..." onChange={(event) => setGroupId(event.target.value)} />
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-sm font-medium">图片、视频或音频文件</span>
                                    <input className="block w-full text-sm" type="file" accept="image/*,video/*,audio/*" onChange={(event) => setFile(event.target.files?.[0] || null)} />
                                </label>

                                <div className="flex gap-2">
                                    <Button
                                        type="primary"
                                        loading={busy === "upload"}
                                        disabled={!groupId.trim() || !file}
                                        onClick={() => file && void run("upload", () => uploadAndRegisterRichBestAsset({ channelId, groupId: groupId.trim(), file }))}
                                    >
                                        上传并登记审核
                                    </Button>

                                    <Button loading={busy === "list"} disabled={!groupId.trim()} onClick={() => void run("list", () => listRichBestAssets({ channelId, groupId: groupId.trim() }))}>
                                        刷新审核状态
                                    </Button>
                                </div>

                                <div className="text-xs text-stone-500">上传和登记是连续的两个步骤；只有状态达到 Active 的素材才可用于生成。</div>
                            </div>
                        ),
                    },

                    {
                        key: "usage",
                        label: "用量查询",
                        children: (
                            <div className="space-y-3">
                                <div className="text-sm text-stone-500">这里需要与瑞池业务 Key 属于同一火山项目的方舟 Key。它只随本次查询发送，不保存到叙光配置。</div>

                                <Alert showIcon type="info" title="供应商延迟用量（Token）" description="可同步 Seedance Token 用量，通常延迟 5～30 分钟；返回数据不含账单金额，请到供应商后台核对。" />

                                <Input.Password value={arkApiKey} autoComplete="off" placeholder="方舟 API Key" onChange={(event) => setArkApiKey(event.target.value)} />

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
                                    <Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
                                </div>

                                <Segmented
                                    value={interval}
                                    options={[
                                        { label: "按天", value: "Day" },
                                        { label: "按小时", value: "Hour" },
                                    ]}
                                    onChange={(value) => setInterval(value as "Hour" | "Day")}
                                />

                                <Button
                                    type="primary"
                                    loading={busy === "usage"}
                                    disabled={!arkApiKey.trim() || !start || !end}
                                    onClick={() =>
                                        void run("usage", async () => {
                                            const value = await queryRichBestUsage({ channelId, arkApiKey: arkApiKey.trim(), start, end, interval });
                                            setUsageSyncedAt(new Date().toISOString());
                                            return value;
                                        })
                                    }
                                >
                                    同步 Seedance Token 用量
                                </Button>

                                {usageSyncedAt ? (
                                    <div className="text-xs text-stone-500">
                                        最近同步：{new Date(usageSyncedAt).toLocaleString("zh-CN", { hour12: false })} · 数据可能比实际消耗晚 5～30 分钟 · 非瑞池实账
                                    </div>
                                ) : null}
                            </div>
                        ),
                    },
                ]}
            />

            {pretty ? <pre className="mt-5 max-h-80 overflow-auto rounded-lg bg-stone-950 p-3 text-xs text-stone-100">{pretty}</pre> : null}
        </Drawer>
    );
}
