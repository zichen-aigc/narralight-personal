import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { once } from "node:events";

import archiver from "archiver";
import yauzl from "yauzl";

const MAX_MANIFEST_BYTES = 128 * 1024 * 1024;

function fail(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}

function safeEntryName(value) {
    const name = String(value || "");
    if (!name || name.includes("\\") || name.startsWith("/") || name.split("/").includes("..") || name.includes("\0")) throw fail(400, "project_import_archive_invalid", "项目包包含不安全的文件路径");
    return name;
}

function openZip(path) {
    return new Promise((resolve, reject) => yauzl.open(path, { lazyEntries: true, autoClose: true }, (error, zip) => error ? reject(error) : resolve(zip)));
}

function openEntry(zip, entry) {
    return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
}

async function visitEntries(path, visitor) {
    const zip = await openZip(path);
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            if (error) {
                try { zip.close(); } catch {}
                reject(error);
            } else resolve();
        };
        zip.once("error", finish);
        zip.once("end", () => finish());
        zip.on("entry", (entry) => {
            Promise.resolve(visitor(zip, entry)).then(() => zip.readEntry(), finish);
        });
        zip.readEntry();
    });
}

async function hashEntry(zip, entry, capture) {
    const stream = await openEntry(zip, entry);
    const hash = createHash("sha256");
    const chunks = [];
    let bytes = 0;
    for await (const chunk of stream) {
        bytes += chunk.length;
        if (capture && bytes > MAX_MANIFEST_BYTES) throw fail(413, "project_import_manifest_too_large", "项目包清单过大");
        hash.update(chunk);
        if (capture) chunks.push(Buffer.from(chunk));
    }
    return { bytes, sha256: hash.digest("hex"), content: capture ? Buffer.concat(chunks) : null };
}

export async function inspectProjectPackageFile(path, packageMeta, { safeProjectId, projectManifestDigest }) {
    const names = new Set();
    const entries = new Map();
    let expandedBytes = 0;
    try {
        await visitEntries(path, async (zip, entry) => {
            const name = safeEntryName(entry.fileName);
            if (names.has(name)) throw fail(400, "project_import_archive_invalid", "项目包包含重复文件路径");
            names.add(name);
            if (name.endsWith("/")) {
                if (Number(entry.uncompressedSize) !== 0) throw fail(400, "project_import_archive_invalid", "项目包目录项无效");
                entries.set(name, { bytes: 0, sha256: createHash("sha256").digest("hex"), content: null });
                return;
            }
            if (!Number.isSafeInteger(Number(entry.uncompressedSize)) || Number(entry.uncompressedSize) < 0) throw fail(400, "project_import_archive_invalid", "项目包文件大小无效");
            expandedBytes += Number(entry.uncompressedSize);
            const result = await hashEntry(zip, entry, name === "projects.json");
            if (result.bytes !== Number(entry.uncompressedSize)) throw fail(400, "project_import_archive_invalid", "项目包文件大小与 ZIP 目录不一致");
            entries.set(name, result);
        });
    } catch (error) {
        if (error?.status) throw error;
        throw fail(400, "project_import_archive_invalid", `项目包 ZIP 无效：${error?.message || "无法解析"}`);
    }
    const manifestEntry = entries.get("projects.json");
    if (!manifestEntry?.content) throw fail(400, "project_import_manifest_invalid", "项目包缺少 projects.json");
    let manifest;
    try { manifest = JSON.parse(manifestEntry.content.toString("utf8")); }
    catch { throw fail(400, "project_import_manifest_invalid", "项目包清单 JSON 无效"); }
    if (manifest?.app !== "infinite-canvas" || ![3, 4].includes(manifest?.version) || !Array.isArray(manifest?.projects) || manifest.projects.length < 1 || manifest.projects.length > 10_000) throw fail(400, "project_import_manifest_invalid", "项目包清单格式或版本无效");
    const projects = Object.create(null);
    const declaredPaths = new Set(["projects.json"]);
    for (const item of manifest.projects) {
        const projectId = safeProjectId(item?.project?.id);
        if (Object.prototype.hasOwnProperty.call(projects, projectId)) throw fail(400, "project_import_manifest_invalid", "项目包包含重复项目 ID");
        const files = Array.isArray(item?.files) ? item.files : [];
        const seenKeys = new Set();
        const seenPaths = new Set();
        const verifiedFiles = files.map((entry) => {
            const storageKey = String(entry?.storageKey || "");
            const filePath = safeEntryName(entry?.path);
            const declaredBytes = Number(entry?.bytes);
            const declaredHash = entry?.sha256 ? String(entry.sha256).toLowerCase() : null;
            const archived = entries.get(filePath);
            if (!storageKey || storageKey.length > 300 || storageKey.includes("\0") || seenKeys.has(storageKey) || seenPaths.has(filePath) || !archived || !Number.isSafeInteger(declaredBytes) || declaredBytes <= 0 || archived.bytes !== declaredBytes) throw fail(400, "project_import_object_manifest_mismatch", "项目包媒体清单与 ZIP 内容不一致");
            if (manifest.version === 4 && !/^[a-f0-9]{64}$/.test(declaredHash || "")) throw fail(400, "project_import_object_checksum_missing", "V4 项目包媒体缺少有效 SHA-256");
            if (declaredHash && declaredHash !== archived.sha256) throw fail(409, "project_import_object_checksum_mismatch", "项目包媒体 SHA-256 校验失败");
            seenKeys.add(storageKey);
            seenPaths.add(filePath);
            declaredPaths.add(filePath);
            return { storageKey, path: filePath, mimeType: String(entry?.mimeType || "application/octet-stream").slice(0, 200), bytes: archived.bytes, sha256: archived.sha256 };
        });
        projects[projectId] = { digest: projectManifestDigest(item), files: verifiedFiles };
    }
    for (const name of names) {
        const isEmptyDirectory = name.endsWith("/") && entries.get(name)?.bytes === 0;
        if (!declaredPaths.has(name) && !isEmptyDirectory) throw fail(400, "project_import_object_manifest_mismatch", "项目包包含清单未声明的文件");
    }
    return {
        checksum: packageMeta.hash,
        bytes: packageMeta.bytes,
        expandedBytes,
        manifestChecksum: manifestEntry.sha256,
        manifestProjects: JSON.stringify(projects),
        packageVersion: manifest.version,
        manifest,
    };
}

export async function materializeProjectPackage({ packagePath, files, tempRoot, objectExists, commitObject, onProgress }) {
    const wanted = new Map(files.map((file) => [file.path, file]));
    const completed = new Set();
    await visitEntries(packagePath, async (zip, entry) => {
        const name = safeEntryName(entry.fileName);
        const expected = wanted.get(name);
        if (!expected) return;
        if (objectExists(expected.sha256, expected.bytes)) {
            await commitObject({ hash: expected.sha256, bytes: expected.bytes, mimeType: expected.mimeType, created: false }, expected);
            completed.add(name);
            onProgress?.(completed.size, wanted.size);
            return;
        }
        const temp = join(tempRoot, `project-import-object-${randomUUID()}.part`);
        const output = createWriteStream(temp, { flags: "wx" });
        const hash = createHash("sha256");
        let bytes = 0;
        try {
            const stream = await openEntry(zip, entry);
            for await (const chunk of stream) {
                bytes += chunk.length;
                hash.update(chunk);
                if (!output.write(chunk)) await once(output, "drain");
            }
            output.end();
            await once(output, "close");
            const digest = hash.digest("hex");
            if (bytes !== expected.bytes || digest !== expected.sha256) throw fail(409, "project_import_object_checksum_mismatch", `迁入媒体校验失败：${expected.storageKey}`);
            await commitObject({ temp, hash: digest, bytes, mimeType: expected.mimeType }, expected);
            completed.add(name);
            onProgress?.(completed.size, wanted.size);
        } catch (error) {
            output.destroy();
            await rm(temp, { force: true });
            throw error;
        }
    });
    if (completed.size !== wanted.size) throw fail(400, "project_import_object_manifest_mismatch", "项目包缺少项目媒体");
    return { completed: completed.size, total: wanted.size };
}

export function startProjectPackageArchive({ targetPath, manifest, files, onProgress }) {
    const output = createWriteStream(targetPath, { flags: "wx" });
    const archive = archiver("zip", { store: true, forceZip64: true });
    let canceled = false;
    const completion = new Promise((resolve, reject) => {
        output.once("close", () => canceled ? reject(fail(409, "project_export_canceled", "项目导出已取消")) : resolve({ bytes: archive.pointer() }));
        output.once("error", reject);
        archive.once("error", reject);
    archive.once("warning", reject);
    });
    archive.on("progress", () => onProgress?.(archive.pointer()));
    archive.pipe(output);
    archive.append(JSON.stringify(manifest, null, 2), { name: "projects.json", store: true });
    for (const file of files) archive.file(file.sourcePath, { name: file.path, store: true });
    void archive.finalize().catch(() => undefined);
    return {
        completion,
        abort: async () => {
            canceled = true;
            archive.abort();
            if (!output.closed) {
                const closed = once(output, "close").catch(() => undefined);
                output.destroy();
                await closed;
            }
            await rm(targetPath, { force: true });
        },
    };
}

export function projectPackageExists(path, bytes) {
    return existsSync(path) && statSync(path).size === bytes;
}
