import { unzip, type UnzipFileInfo } from "fflate";

export type DocumentInputFormat = "docx" | "html" | "txt" | "md";
export type DocumentOutputFormat = "markdown" | "html" | "txt";

export type ConversionResult = {
    inputFormat: DocumentInputFormat;
    outputFormat: DocumentOutputFormat;
    content: string;
    warnings: string[];
};

const INPUT_EXTENSIONS = new Set<DocumentInputFormat>(["docx", "html", "txt", "md"]);
const MAX_DOCX_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 4_096;
const MAX_DOCX_DOCUMENT_BYTES = 16 * 1024 * 1024;

const INPUT_EXTENSION_ALIASES: Record<string, DocumentInputFormat> = {
    htm: "html",
    markdown: "md",
};

export function inputFormatForFile(file: File): DocumentInputFormat | null {
    const extension = file.name.toLowerCase().split(".").pop() || "";
    if (INPUT_EXTENSIONS.has(extension as DocumentInputFormat)) return extension as DocumentInputFormat;
    if (INPUT_EXTENSION_ALIASES[extension]) return INPUT_EXTENSION_ALIASES[extension];
    if (file.type === "text/html") return "html";
    if (file.type === "text/markdown") return "md";
    if (file.type === "text/plain") return "txt";
    return null;
}

export async function convertDocument(file: File, outputFormat: DocumentOutputFormat): Promise<ConversionResult> {
    const inputFormat = inputFormatForFile(file);
    if (!inputFormat) throw new Error("当前首期支持 Word、HTML、Markdown 和 TXT 文件");
    const warnings: string[] = [];
    const source = inputFormat === "docx" ? "" : (await file.text()).replace(/^\uFEFF/, "");
    const markdown = inputFormat === "docx" ? await docxToMarkdown(file, warnings) : inputFormat === "html" ? htmlToMarkdown(source) : inputFormat === "md" ? source : source.replace(/\r\n/g, "\n").trim();
    const content = outputFormat === "markdown" ? normalizeMarkdown(markdown) : outputFormat === "html" ? markdownToHtml(markdown) : markdownToPlainText(markdown);
    return { inputFormat, outputFormat, content, warnings };
}

async function docxToMarkdown(file: File, warnings: string[]) {
    if (file.size > MAX_DOCX_COMPRESSED_BYTES) throw new Error("Word 文档不能超过 64 MiB");
    const entries = await readDocxDocument(new Uint8Array(await file.arrayBuffer()));
    const documentXml = entries["word/document.xml"];
    if (!documentXml) throw new Error("Word 文档缺少正文内容");
    const xml = new TextDecoder().decode(documentXml);
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("Word 文档正文解析失败");
    const body = Array.from(document.getElementsByTagName("*")).find((node) => node.localName === "body");
    if (!body) throw new Error("Word 文档没有可转换的正文");
    const blocks: string[] = [];
    for (const child of Array.from(body.children)) {
        if (child.localName === "p") {
            const value = paragraphToMarkdown(child);
            if (value.trim()) blocks.push(value);
        } else if (child.localName === "tbl") {
            const table = tableToMarkdown(child);
            if (table) blocks.push(table);
        }
    }
    if (Array.from(document.getElementsByTagName("*")).some((node) => node.localName === "drawing" || node.localName === "pict")) {
        warnings.push("文档中的图片未嵌入 Markdown 文件，文字内容已保留");
    }
    return blocks.join("\n\n");
}

async function readDocxDocument(data: Uint8Array) {
    const names = new Set<string>();
    let entryCount = 0;
    return await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
        try {
            unzip(
                data,
                {
                    filter(file: UnzipFileInfo) {
                        entryCount += 1;
                        if (entryCount > MAX_DOCX_ENTRIES) throw new Error("Word 文档包含过多内部文件");
                        const name = file.name.replace(/\\/g, "/");
                        if (name.startsWith("/") || name.split("/").some((part) => part === "..")) throw new Error("Word 文档包含不安全路径");
                        if (names.has(name)) throw new Error("Word 文档包含重复内部文件");
                        names.add(name);
                        if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0) throw new Error("Word 文档内部文件大小无效");
                        if (name === "word/document.xml" && file.originalSize > MAX_DOCX_DOCUMENT_BYTES) throw new Error("Word 文档正文过大，不能超过 16 MiB");
                        return name === "word/document.xml";
                    },
                },
                (error, entries) => (error ? reject(error) : resolve(entries)),
            );
        } catch (error) {
            reject(error);
        }
    });
}

function paragraphToMarkdown(paragraph: Element) {
    const text = Array.from(paragraph.getElementsByTagName("*"))
        .filter((node) => ["t", "tab", "br"].includes(node.localName || ""))
        .map((node) => (node.localName === "tab" ? "    " : node.localName === "br" ? "\n" : node.textContent || ""))
        .join("")
        .replace(/\u00a0/g, " ")
        .trim();
    if (!text) return "";
    const style =
        Array.from(paragraph.getElementsByTagName("*"))
            .find((node) => node.localName === "pStyle")
            ?.getAttribute("w:val") || "";
    const heading = /^(?:Heading|标题)([1-6])$/i.exec(style);
    if (heading) return `${"#".repeat(Number(heading[1]))} ${text}`;
    return Array.from(paragraph.getElementsByTagName("*")).some((node) => node.localName === "numPr") ? `- ${text}` : text;
}

function tableToMarkdown(table: Element) {
    const rows = Array.from(table.children)
        .filter((row) => row.localName === "tr")
        .map((row) =>
            Array.from(row.children)
                .filter((cell) => cell.localName === "tc")
                .map((cell) =>
                    Array.from(cell.getElementsByTagName("*"))
                        .filter((node) => node.localName === "t")
                        .map((node) => node.textContent || "")
                        .join("")
                        .replace(/\|/g, "\\|")
                        .replace(/\s+/g, " ")
                        .trim(),
                ),
        )
        .filter((row) => row.length);
    if (!rows.length) return "";
    const width = Math.max(...rows.map((row) => row.length));
    const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
    return [`| ${normalized[0].join(" | ")} |`, `| ${normalized[0].map(() => "---").join(" | ")} |`, ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function htmlToMarkdown(source: string) {
    const document = new DOMParser().parseFromString(source, "text/html");
    return Array.from(document.body.childNodes)
        .map(htmlNodeToMarkdown)
        .join("")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function htmlNodeToMarkdown(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").replace(/\s+/g, " ");
    if (!(node instanceof Element)) return "";
    const content = Array.from(node.childNodes).map(htmlNodeToMarkdown).join("").trim();
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag.slice(1)))} ${content}\n\n`;
    if (["p", "div", "section"].includes(tag)) return `\n\n${content}\n\n`;
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${content}**`;
    if (tag === "em" || tag === "i") return `*${content}*`;
    if (tag === "code") return `\`${content}\``;
    if (tag === "pre") return `\n\n\`\`\`\n${node.textContent || ""}\n\`\`\`\n\n`;
    if (tag === "blockquote") return `\n\n> ${content.replace(/\n/g, "\n> ")}\n\n`;
    if (tag === "a") return `[${content}](${node.getAttribute("href") || ""})`;
    if (tag === "img") return `![${node.getAttribute("alt") || "图片"}](${node.getAttribute("src") || ""})`;
    if (tag === "ul" || tag === "ol") {
        const items = Array.from(node.children)
            .filter((child) => child.tagName.toLowerCase() === "li")
            .map((item, index) => `${tag === "ol" ? `${index + 1}.` : "-"} ${htmlNodeToMarkdown(item).trim()}`);
        return `\n\n${items.join("\n")}\n\n`;
    }
    if (tag === "li") return content;
    if (tag === "hr") return "\n\n---\n\n";
    if (tag === "table") {
        const rows = Array.from(node.querySelectorAll("tr")).map((row) => Array.from(row.children).map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim()));
        if (!rows.length) return "";
        const width = Math.max(...rows.map((row) => row.length));
        const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
        return `\n\n| ${normalized[0].join(" | ")} |\n| ${normalized[0].map(() => "---").join(" | ")} |\n${normalized
            .slice(1)
            .map((row) => `| ${row.join(" | ")} |`)
            .join("\n")}\n\n`;
    }
    return content;
}

export function normalizeMarkdown(source: string) {
    return source
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function markdownToPlainText(source: string) {
    return normalizeMarkdown(source)
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^>\s?/gm, "")
        .replace(/^[-*+]\s+/gm, "")
        .replace(/^\d+\.\s+/gm, "")
        .replace(/[*_`]/g, "");
}

export function markdownToHtml(source: string) {
    const escaped = normalizeMarkdown(source).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return escaped
        .replace(/^######\s+(.+)$/gm, "<h6>$1</h6>")
        .replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>")
        .replace(/^####\s+(.+)$/gm, "<h4>$1</h4>")
        .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
        .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
        .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .split(/\n{2,}/)
        .map((block) => (/^<h[1-6]>/.test(block) ? block : `<p>${block.replace(/\n/g, "<br />")}</p>`))
        .join("\n");
}

export function outputExtension(format: DocumentOutputFormat) {
    return format === "markdown" ? "md" : format;
}
