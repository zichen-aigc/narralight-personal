import { Button, Card, Select, Space, Tag, Typography } from "antd";
import { Copy, Download, FileOutput, RefreshCw, UploadCloud } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { App, Empty } from "antd";

import { saveAs } from "file-saver";

import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";

import { convertDocument, inputFormatForFile, outputExtension, type DocumentOutputFormat } from "@/services/document-converter";

export default function FormatConverterPage() {
    const { message } = App.useApp();

    const { t } = useTranslation();

    const copyText = useCopyText();

    const inputRef = useRef<HTMLInputElement>(null);

    const [file, setFile] = useState<File | null>(null);

    const [outputFormat, setOutputFormat] = useState<DocumentOutputFormat>("markdown");

    const [content, setContent] = useState("");

    const [warnings, setWarnings] = useState<string[]>([]);

    const [busy, setBusy] = useState(false);

    const inputFormat = useMemo(() => (file ? inputFormatForFile(file) : null), [file]);

    const outputOptions: Array<{ value: DocumentOutputFormat; label: string }> = useMemo(
        () => [
            { value: "markdown", label: "Markdown (.md)" },

            { value: "html", label: "HTML (.html)" },

            { value: "txt", label: `${t("formatConverter.plainText")} (.txt)` },
        ],

        [t],
    );

    const chooseFile = (next?: File) => {
        if (!next) return;

        if (!inputFormatForFile(next)) return message.error(t("formatConverter.unsupported"));

        setFile(next);

        setContent("");

        setWarnings([]);
    };

    const convert = async () => {
        if (!file) return;

        setBusy(true);

        try {
            const result = await convertDocument(file, outputFormat);

            setContent(result.content);

            setWarnings(result.warnings);

            message.success(t("formatConverter.converted"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("formatConverter.failed"));
        } finally {
            setBusy(false);
        }
    };

    const download = () => {
        if (!content || !file) return;

        const stem = file.name.replace(/\.[^.]+$/, "") || "converted";

        saveAs(new Blob([content], { type: outputFormat === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8" }), `${stem}.${outputExtension(outputFormat)}`);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-8 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.14)_1px,transparent_1px)]">
                <div className="mx-auto max-w-6xl">
                    <div className="text-center">
                        <h1 className="text-4xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{t("formatConverter.title")}</h1>

                        <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">{t("formatConverter.description")}</p>
                    </div>

                    <Card className="mt-8" styles={{ body: { padding: 24 } }}>
                        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
                            <button
                                type="button"

                                className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-5 text-center transition hover:border-stone-500 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-950 dark:hover:border-stone-500"

                                onClick={() => inputRef.current?.click()}
                            >
                                <UploadCloud className="size-7 text-stone-500" aria-hidden="true" />

                                <span className="text-sm font-medium">{file ? file.name : t("formatConverter.chooseFile")}</span>

                                <span className="text-xs text-stone-500">{t("formatConverter.supported")}</span>
                            </button>

                            <div className="space-y-3">
                                <div>
                                    <Typography.Text type="secondary" className="mb-1 block text-xs">
                                        {t("formatConverter.output")}
                                    </Typography.Text>

                                    <Select className="w-full" value={outputFormat} options={outputOptions} onChange={setOutputFormat} />
                                </div>

                                <Space.Compact className="w-full">
                                    <Button block type="primary" icon={<FileOutput className="size-4" />} disabled={!file} loading={busy} onClick={() => void convert()}>
                                        {t("formatConverter.convert")}
                                    </Button>

                                    <Button
                                        icon={<RefreshCw className="size-4" />}

                                        disabled={!file && !content}

                                        onClick={() => {
                                            setFile(null);

                                            setContent("");

                                            setWarnings([]);
                                        }}
                                    >
                                        {t("formatConverter.reset")}
                                    </Button>
                                </Space.Compact>
                            </div>
                        </div>

                        <input
                            ref={inputRef}

                            type="file"

                            accept=".docx,.html,.htm,.md,.markdown,.txt,text/html,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"

                            className="hidden"

                            onChange={(event) => {
                                chooseFile(event.target.files?.[0]);

                                event.target.value = "";
                            }}
                        />

                        {file ? (
                            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                                <Tag>{inputFormat?.toUpperCase()}</Tag>

                                <span>{file.name}</span>

                                <span>·</span>

                                <span>{Math.max(1, Math.round(file.size / 1024))} KB</span>
                            </div>
                        ) : null}
                    </Card>

                    {warnings.length ? (
                        <div className="mt-4 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                            {warnings.map((warning) => (
                                <div key={warning}>{warning}</div>
                            ))}
                        </div>
                    ) : null}

                    <Card className="mt-5" styles={{ body: { padding: 0 } }}>
                        {content ? (
                            <div>
                                <div className="flex flex-col items-stretch gap-3 border-b border-stone-200 px-5 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <Typography.Text strong>{t("formatConverter.preview")}</Typography.Text>

                                        <Tag>{outputExtension(outputFormat).toUpperCase()}</Tag>
                                    </div>

                                    <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                                        <Button
                                            className="min-w-0 flex-1 sm:flex-none"
                                            size="small"
                                            icon={<Copy className="size-3.5" />}
                                            onClick={() => void copyText(content, t("formatConverter.copied"))}
                                        >
                                            {t("formatConverter.copy")}
                                        </Button>

                                        <Button className="min-w-0 flex-1 sm:flex-none" size="small" type="primary" icon={<Download className="size-3.5" />} onClick={download}>
                                            {t("formatConverter.download")}
                                        </Button>
                                    </div>
                                </div>

                                <pre className="max-h-[52dvh] overflow-auto whitespace-pre-wrap break-words px-5 py-4 text-sm leading-6">{content}</pre>
                            </div>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("formatConverter.empty")} className="py-20" />
                        )}
                    </Card>
                </div>
            </main>
        </div>
    );
}
