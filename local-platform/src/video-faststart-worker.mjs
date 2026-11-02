import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

const require = createRequire(import.meta.url);
const { faststart } = require("moov-faststart");
const { parseAtoms } = require("moov-faststart/src/atom.js");
const RETRYABLE_IO_CODES = new Set(["EACCES", "EBUSY", "EDQUOT", "EIO", "EMFILE", "ENFILE", "ENOENT", "ENOSPC", "EPERM"]);

function digest(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}

function movieMetadataFingerprint(moov) {
    const hash = createHash("sha256");
    const visit = (atoms) => {
        for (const atom of atoms) {
            hash.update(atom.kind);
            if (Buffer.isBuffer(atom.data)) hash.update(atom.kind === "stco" || atom.kind === "co64" ? atom.data.subarray(0, 8) : atom.data);
            else visit(atom.data);
        }
    };
    visit(moov.data);
    return hash.digest("hex");
}

function validate(source, output) {
    if (source.length !== output.length) throw new Error("video_faststart_size_changed");
    const before = parseAtoms(source);
    const after = parseAtoms(output);
    const sourceMdat = before.find((atom) => atom.kind === "mdat");
    const targetMdat = after.find((atom) => atom.kind === "mdat");
    const sourceMoov = before.find((atom) => atom.kind === "moov");
    const targetMoov = after.find((atom) => atom.kind === "moov");
    if (!sourceMdat || !targetMdat || !sourceMoov || !targetMoov) throw new Error("video_faststart_atom_missing");
    if (after.findIndex((atom) => atom.kind === "moov") > after.findIndex((atom) => atom.kind === "mdat")) throw new Error("video_faststart_moov_not_front");
    if (!Buffer.isBuffer(sourceMdat.data) || !Buffer.isBuffer(targetMdat.data) || digest(sourceMdat.data) !== digest(targetMdat.data)) throw new Error("video_faststart_media_changed");
    if (movieMetadataFingerprint(sourceMoov) !== movieMetadataFingerprint(targetMoov)) throw new Error("video_faststart_metadata_changed");
}

try {
    const source = await readFile(workerData.sourcePath);
    const output = faststart(source);
    validate(source, output);
    await writeFile(workerData.targetPath, output, { flag: "wx" });
    parentPort.postMessage({ ok: true, changed: !source.equals(output), bytes: output.length });
} catch (error) {
    const retryable = RETRYABLE_IO_CODES.has(String(error?.code || "").toUpperCase());
    parentPort.postMessage({ ok: false, code: error instanceof Error && /^video_faststart_[a-z_]+$/.test(error.message) ? error.message : retryable ? "video_faststart_io_failed" : "video_faststart_failed", retryable });
}
