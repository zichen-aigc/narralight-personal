import { createHash, createPublicKey, randomBytes, randomUUID, verify as verifySignature } from "node:crypto";
import { closeSync, createReadStream, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

export const LOCAL_H3_PROVIDER = "local-h3";
export const LOCAL_H3_MODEL = "local-h3-base";
export const LOCAL_H3_WORKFLOW_ID = "h3-base-4070-v2";
export const LOCAL_H3_WORKFLOW_SHA256 = "3d177045457dc8191f4ad646c4b61fa4d8531c182c5f281d160a7a3f0055bb47";
export const LOCAL_H3_SPEC = Object.freeze({
    width: 864,
    height: 480,
    frames: 124,
    fps: 24,
    videoCodec: "h264",
    audioCodec: "aac",
    audioSampleRate: 32000,
    audioChannels: 2,
});
export const LOCAL_H3_PROFILES = Object.freeze([
    Object.freeze({ resolution: "864x480", aspectRatio: "16:9", width: 864, height: 480 }),
    Object.freeze({ resolution: "480x864", aspectRatio: "9:16", width: 480, height: 864 }),
    Object.freeze({ resolution: "640x640", aspectRatio: "1:1", width: 640, height: 640 }),
]);
export const LOCAL_H3_DURATIONS = Object.freeze([Object.freeze({ duration: 5, frames: 124 }), Object.freeze({ duration: 10, frames: 243 })]);

const USER_JOB_FIELDS = new Set(["takeId", "projectId", "nodeId", "promptOriginalZh", "seed", "model", "parameters", "references"]);
const PARAMETER_FIELDS = new Set(["duration", "resolution", "aspectRatio", "generateAudio", "referenceMode", "outputFormat"]);
const ACTIVE_STATES = new Set(["leased", "compiling", "submitted", "running", "rendered", "uploading", "verifying", "recovery_pending"]);
const POST_SUBMISSION_STATES = new Set(["submitted", "running", "rendered", "uploading", "verifying", "recovery_pending"]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const LEASE_TRANSITIONS = new Map([
    ["leased", new Set(["leased", "compiling", "submitted"])],
    ["compiling", new Set(["compiling", "submitted"])],
    ["submitted", new Set(["submitted", "running", "recovery_pending"])],
    ["running", new Set(["running", "rendered", "recovery_pending"])],
    ["rendered", new Set(["rendered", "uploading", "verifying", "recovery_pending"])],
    ["uploading", new Set(["uploading", "verifying", "recovery_pending"])],
    ["verifying", new Set(["verifying", "recovery_pending"])],
    ["recovery_pending", new Set(["recovery_pending", "running", "rendered", "uploading", "verifying"])],
]);

function apiError(status, code, message, details) {
    return Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
}

function iso(ms = Date.now()) {
    return new Date(ms).toISOString();
}

function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}

function json(buffer) {
    if (!buffer.length) return {};
    try {
        const value = JSON.parse(buffer.toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not_object");
        return value;
    } catch {
        throw apiError(400, "invalid_json", "请求 JSON 无效");
    }
}

async function readBody(req, limit) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += value.length;
        if (bytes > limit) throw apiError(413, "local_h3_request_too_large", "请求内容过大");
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

function transaction(db, callback) {
    db.exec("BEGIN IMMEDIATE");
    try {
        const value = callback();
        db.exec("COMMIT");
        return value;
    } catch (error) {
        try {
            db.exec("ROLLBACK");
        } catch {}
        throw error;
    }
}

function safeId(value, pattern, code, message) {
    const normalized = String(value || "");
    if (!pattern.test(normalized)) throw apiError(400, code, message);
    return normalized;
}

function safeErrorCode(value, fallback = "local_h3_worker_failed") {
    const normalized = String(value || fallback)
        .replace(/[^a-zA-Z0-9_.:-]/g, "_")
        .slice(0, 100);
    return normalized || fallback;
}

function safeErrorMessage(value) {
    return String(value || "本地 H3 生成失败")
        .replace(/https?:\/\/\S+/gi, "[url-redacted]")
        .replace(/(?:[a-zA-Z]:[\\/]|\\\\|file:\/\/)[^\s]+/g, "[path-redacted]")
        .replace(/\b(?:Bearer\s+|sk-)[a-zA-Z0-9._-]{8,}/gi, "[secret-redacted]")
        .slice(0, 500);
}

function canonicalRequest(workerId, timestamp, nonce, method, pathWithQuery, bodyHash) {
    return `v1\n${workerId}\n${timestamp}\n${nonce}\n${String(method || "GET").toUpperCase()}\n${pathWithQuery}\n${bodyHash}`;
}

export function localH3CanonicalRequest(input) {
    return canonicalRequest(input.workerId, input.timestamp, input.nonce, input.method, input.pathWithQuery, input.bodySha256Hex);
}

function objectPath(root, hash) {
    return join(root, "objects", hash.slice(0, 2), hash.slice(2, 4), hash);
}

function fileSha256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = createHash("sha256");
        const stream = createReadStream(filePath);
        stream.on("error", reject);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}

function removeFile(filePath) {
    try {
        if (filePath && existsSync(filePath)) unlinkSync(filePath);
    } catch {}
}

function localStateToTaskStatus(state) {
    if (state === "completed") return "completed";
    if (state === "failed") return "failed";
    if (state === "cancelled") return "cancelled";
    if (["rendered", "uploading", "verifying", "recovery_pending"].includes(state)) return "result_pending";
    return "pending";
}

export function normalizeLocalH3Parameters(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw apiError(400, "local_h3_parameters_invalid", "本地 H3 参数无效");
    const unexpected = Object.keys(value).find((key) => !PARAMETER_FIELDS.has(key));
    if (unexpected) throw apiError(400, "local_h3_parameter_unsupported", "本地 H3 参数包含未允许字段", { field: unexpected });
    const profile = LOCAL_H3_PROFILES.find((item) => item.resolution === value.resolution && item.aspectRatio === value.aspectRatio);
    if (!profile) throw apiError(400, "local_h3_profile_invalid", "本地 H3 画面规格不在已验收白名单中");
    const duration = LOCAL_H3_DURATIONS.find((item) => item.duration === Number(value.duration));
    if (!duration) throw apiError(400, "local_h3_duration_invalid", "本地 H3 时长不在已验收白名单中");
    if (value.generateAudio !== true || value.outputFormat !== "mp4") throw apiError(400, "local_h3_output_profile_invalid", "本地 H3 必须生成带 AAC 音轨的 MP4");
    if (!new Set(["text_to_video", "first_frame", "first_last_frame"]).has(value.referenceMode)) throw apiError(400, "local_h3_reference_mode_invalid", "本地 H3 参考模式无效");
    return { duration: duration.duration, resolution: profile.resolution, aspectRatio: profile.aspectRatio, generateAudio: true, referenceMode: value.referenceMode, outputFormat: "mp4" };
}

function jobContract(row) {
    let stored = {};
    try {
        stored = JSON.parse(row?.parameters_json || "{}");
    } catch {
        throw apiError(500, "local_h3_job_contract_invalid", "H3 任务合同损坏");
    }
    return { parameters: normalizeLocalH3Parameters(stored.parameters || stored), references: Array.isArray(stored.references) ? stored.references : [] };
}

function specForParameters(parameters) {
    const profile = LOCAL_H3_PROFILES.find((item) => item.resolution === parameters.resolution && item.aspectRatio === parameters.aspectRatio);
    const duration = LOCAL_H3_DURATIONS.find((item) => item.duration === parameters.duration);
    return { ...LOCAL_H3_SPEC, width: profile.width, height: profile.height, frames: duration.frames, durationSeconds: duration.frames / LOCAL_H3_SPEC.fps };
}

function normalizeReferences(value, referenceMode, dataRoot) {
    const items = value === undefined ? [] : value;
    if (!Array.isArray(items) || items.length > 2) throw apiError(400, "local_h3_references_invalid", "本地 H3 最多支持两张参考图");
    const expectedCount = referenceMode === "text_to_video" ? 0 : referenceMode === "first_frame" ? 1 : 2;
    if (items.length !== expectedCount) throw apiError(400, "local_h3_reference_mode_mismatch", "本地 H3 参考图数量与参考模式不一致");
    return items.map((item, index) => {
        const match = /^sha256:([a-f0-9]{64})$/.exec(String(item?.storageKey || ""));
        const role = index === 0 ? "first_frame" : "last_frame";
        const mimeType = String(item?.mimeType || "").toLowerCase();
        if (!match || item?.role !== role || !new Set(["image/png", "image/jpeg", "image/webp"]).has(mimeType)) throw apiError(400, "local_h3_reference_invalid", "本地 H3 参考图合同无效");
        const file = objectPath(dataRoot, match[1]);
        const bytes = existsSync(file) ? statSync(file).size : 0;
        if (!bytes || bytes > 25 * 1024 * 1024) throw apiError(400, "local_h3_reference_object_invalid", "本地 H3 参考图不存在或超过 25MB");
        return { storageKey: item.storageKey, hash: match[1], mimeType, role, bytes };
    });
}

function queuePosition(db, row) {
    if (!row || row.state !== "queued") return undefined;
    return Number(
        db.prepare("SELECT COUNT(*) AS count FROM local_worker_job WHERE state='queued' AND (created_at<? OR (created_at=? AND job_id<=?))").get(row.created_at, row.created_at, row.job_id)?.count ||
            0,
    );
}

function publicJob(db, row) {
    if (!row) return null;
    return {
        jobId: row.job_id,
        takeId: row.take_id,
        projectId: row.project_id,
        nodeId: row.node_id,
        state: row.state,
        ...(queuePosition(db, row) ? { queuePosition: queuePosition(db, row) } : {}),
        ...(row.progress !== null && row.progress !== undefined ? { progress: Number(row.progress) } : {}),
        cancelRequested: Boolean(row.cancel_requested_at),
        attempt: Number(row.attempt || 0),
        ...(row.error_code ? { errorCode: row.error_code } : {}),
        ...(row.result_hash
            ? { result: { storageKey: `sha256:${row.result_hash}`, mimeType: row.result_mime_type, bytes: Number(row.result_bytes), durationMs: Number(row.result_duration_ms) } }
            : {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function workerJob(row, workflowSha256) {
    const contract = jobContract(row);
    return {
        jobId: row.job_id,
        state: row.state,
        leaseId: row.lease_id,
        leaseExpiresAt: row.lease_expires_at,
        workflowId: row.workflow_id,
        workflowSha256,
        promptOriginalZh: row.prompt_original_zh,
        promptFinal: row.prompt_final || row.prompt_original_zh,
        ...(row.comfy_prompt_id ? { comfyPromptId: row.comfy_prompt_id } : {}),
        seed: Number(row.seed),
        outputPrefix: row.job_id,
        parameters: contract.parameters,
        spec: specForParameters(contract.parameters),
        references: contract.references.map((reference) => ({
            role: reference.role,
            mimeType: reference.mimeType,
            bytes: reference.bytes,
            sha256: reference.hash,
            downloadPath: `/api/local/worker/v1/jobs/${encodeURIComponent(row.job_id)}/references/${reference.role}`,
        })),
    };
}

function normalizeProbe(probe, spec) {
    const audio = probe?.audio || {};
    const formats = Array.isArray(probe?.formatNames) ? probe.formatNames.map((item) => String(item).toLowerCase()) : [];
    const duration = Number(probe?.durationSeconds);
    const fps = Number(probe?.fps);
    const frameCount = Number(probe?.frameCount);
    if (!formats.some((item) => item === "mp4" || item === "mov")) throw apiError(422, "local_h3_container_invalid", "H3 成片不是有效 MP4 容器");
    if (String(probe?.codec || "").toLowerCase() !== spec.videoCodec) throw apiError(422, "local_h3_video_codec_invalid", "H3 成片视频编码必须为 H.264");
    if (Number(probe?.width) !== spec.width || Number(probe?.height) !== spec.height) throw apiError(422, "local_h3_dimensions_invalid", `H3 成片分辨率必须为 ${spec.width}×${spec.height}`);
    if (!Number.isFinite(fps) || Math.abs(fps - spec.fps) > 0.05) throw apiError(422, "local_h3_fps_invalid", "H3 成片帧率必须为 24 fps");
    if (!Number.isSafeInteger(frameCount) || Math.abs(frameCount - spec.frames) > 1) throw apiError(422, "local_h3_frame_count_invalid", `H3 成片必须约为 ${spec.frames} 帧`);
    if (!Number.isFinite(duration) || Math.abs(duration - spec.frames / spec.fps) > 0.15) throw apiError(422, "local_h3_duration_invalid", "H3 成片时长与目标帧数不一致");
    if (String(audio.codec || "").toLowerCase() !== spec.audioCodec) throw apiError(422, "local_h3_audio_codec_invalid", "H3 成片必须包含 AAC 音频");
    if (Number(audio.sampleRate) !== spec.audioSampleRate || Number(audio.channels) !== spec.audioChannels) throw apiError(422, "local_h3_audio_profile_invalid", "H3 成片音频必须为 32 kHz 双声道");
    return { durationMs: Math.round(duration * 1000) };
}

export function initializeLocalH3Schema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS local_worker_pairing_code(
            code_sha256 TEXT PRIMARY KEY,
            expires_at TEXT NOT NULL,
            consumed_at TEXT,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_worker(
            worker_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            public_key_spki_der_base64 TEXT NOT NULL,
            status TEXT NOT NULL,
            capabilities_json TEXT NOT NULL,
            allowed_workflow_sha256 TEXT NOT NULL,
            current_job_id TEXT,
            last_seen_at TEXT,
            paired_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_worker_job(
            job_id TEXT PRIMARY KEY,
            take_id TEXT NOT NULL UNIQUE,
            request_id TEXT NOT NULL UNIQUE,
            request_sha256 TEXT NOT NULL,
            project_id TEXT NOT NULL,
            node_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            workflow_id TEXT NOT NULL,
            workflow_sha256 TEXT NOT NULL,
            prompt_original_zh TEXT NOT NULL,
            prompt_final TEXT,
            compiler_id TEXT,
            seed INTEGER NOT NULL,
            parameters_json TEXT NOT NULL,
            state TEXT NOT NULL,
            worker_id TEXT,
            lease_id TEXT,
            lease_expires_at TEXT,
            attempt INTEGER NOT NULL DEFAULT 0,
            comfy_prompt_id TEXT,
            progress REAL,
            cancel_requested_at TEXT,
            result_hash TEXT,
            result_mime_type TEXT,
            result_bytes INTEGER,
            result_duration_ms INTEGER,
            error_code TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(take_id) REFERENCES video_generation_take(take_id) ON DELETE RESTRICT,
            FOREIGN KEY(worker_id) REFERENCES local_worker(worker_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS local_worker_job_queue_idx ON local_worker_job(state,created_at,job_id);
        CREATE TABLE IF NOT EXISTS local_worker_assignment(
            job_id TEXT NOT NULL,
            worker_id TEXT NOT NULL,
            lease_id TEXT NOT NULL,
            assigned_at TEXT NOT NULL,
            PRIMARY KEY(job_id,lease_id),
            FOREIGN KEY(job_id) REFERENCES local_worker_job(job_id) ON DELETE CASCADE,
            FOREIGN KEY(worker_id) REFERENCES local_worker(worker_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS local_worker_assignment_worker_idx ON local_worker_assignment(worker_id,job_id);
        CREATE TABLE IF NOT EXISTS local_worker_upload(
            upload_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL UNIQUE,
            worker_id TEXT NOT NULL,
            lease_id TEXT NOT NULL,
            temporary_path TEXT NOT NULL,
            expected_bytes INTEGER NOT NULL,
            expected_sha256 TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            received_bytes INTEGER NOT NULL DEFAULT 0,
            chunk_size INTEGER NOT NULL,
            state TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(job_id) REFERENCES local_worker_job(job_id) ON DELETE CASCADE,
            FOREIGN KEY(worker_id) REFERENCES local_worker(worker_id) ON DELETE RESTRICT
        );
        CREATE TABLE IF NOT EXISTS local_worker_nonce(
            worker_id TEXT NOT NULL,
            nonce TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(worker_id,nonce),
            FOREIGN KEY(worker_id) REFERENCES local_worker(worker_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS local_worker_nonce_expiry_idx ON local_worker_nonce(expires_at);
        CREATE TABLE IF NOT EXISTS local_worker_event(
            job_id TEXT NOT NULL,
            event_id TEXT NOT NULL,
            worker_id TEXT NOT NULL,
            lease_id TEXT NOT NULL,
            state TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(job_id,event_id),
            FOREIGN KEY(job_id) REFERENCES local_worker_job(job_id) ON DELETE CASCADE
        );
    `);
}

export function createLocalH3WorkerService(options) {
    const { db, dataRoot, probeVideoFile, broadcast = () => undefined } = options;
    if (!db || !dataRoot || typeof probeVideoFile !== "function") throw new Error("local H3 worker service dependencies missing");
    initializeLocalH3Schema(db);
    const now = typeof options.now === "function" ? options.now : Date.now;
    const workflowSha256 = String(options.workflowSha256 || LOCAL_H3_WORKFLOW_SHA256).toLowerCase();
    const maxQueued = Math.max(1, Math.min(20, Number(options.maxQueued || 3)));
    const leaseMs = Math.max(30_000, Number(options.leaseMs || 90_000));
    const onlineTtlMs = Math.max(10_000, Number(options.onlineTtlMs || 45_000));
    const signatureSkewMs = Math.max(30_000, Number(options.signatureSkewMs || 300_000));
    const chunkSize = Math.max(1024 * 1024, Math.min(16 * 1024 * 1024, Number(options.chunkSize || 4 * 1024 * 1024)));
    const maxUploadBytes = Math.max(chunkSize, Number(options.maxUploadBytes || 512 * 1024 * 1024));
    const allowInsecureTransport = options.allowInsecureTransport === true;
    const uploadRoot = join(dataRoot, "tmp", "h3-worker");
    mkdirSync(uploadRoot, { recursive: true });

    const startupNow = iso(now());
    db.prepare(
        "UPDATE local_worker_job SET state='queued',worker_id=NULL,lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE state IN ('leased','compiling') AND lease_expires_at IS NOT NULL AND lease_expires_at<?",
    ).run(startupNow, startupNow);
    db.prepare(
        "UPDATE local_worker_job SET state='recovery_pending',updated_at=? WHERE state IN ('submitted','running','rendered','uploading','verifying') AND lease_expires_at IS NOT NULL AND lease_expires_at<?",
    ).run(startupNow, startupNow);
    db.prepare(
        "UPDATE generation_task SET last_provider_status=(SELECT state FROM local_worker_job WHERE job_id=generation_task.task_id),updated_at=? WHERE provider=? AND task_id IN (SELECT job_id FROM local_worker_job WHERE state<>'completed')",
    ).run(startupNow, LOCAL_H3_PROVIDER);

    function emit(jobId) {
        const row = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(jobId);
        if (row) broadcast("local-h3-job", publicJob(db, row));
    }

    function secureTransport(req) {
        if (allowInsecureTransport || req.socket?.encrypted) return;
        if (options.allowInsecureLoopback === true && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket?.remoteAddress)) return;
        if (
            String(req.headers["x-forwarded-proto"] || "")
                .split(",")[0]
                .trim()
                .toLowerCase() === "https"
        )
            return;
        throw apiError(426, "local_h3_https_required", "Worker 接口必须通过 HTTPS 或受限加密隧道访问");
    }

    function assertWorkerSignature(req, body) {
        const workerId = safeId(req.headers["x-narralight-worker-id"], /^worker_[a-zA-Z0-9._-]{3,80}$/, "local_h3_worker_id_invalid", "Worker 标识无效");
        const timestamp = String(req.headers["x-narralight-worker-timestamp"] || "");
        const nonce = safeId(req.headers["x-narralight-worker-nonce"], /^[a-zA-Z0-9_-]{16,200}$/, "local_h3_nonce_invalid", "Worker nonce 无效");
        const signatureText = String(req.headers["x-narralight-worker-signature"] || "");
        if (!/^\d{10,13}$/.test(timestamp) || Math.abs(now() - Number(timestamp) * 1000) > signatureSkewMs) throw apiError(401, "local_h3_signature_stale", "Worker 请求时间戳已过期");
        if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(signatureText)) throw apiError(401, "local_h3_signature_invalid", "Worker 请求签名无效");
        const worker = db.prepare("SELECT * FROM local_worker WHERE worker_id=? AND status='active'").get(workerId);
        if (!worker) throw apiError(401, "local_h3_worker_unauthorized", "Worker 未配对或已撤销");
        let publicKey;
        try {
            publicKey = createPublicKey({ key: Buffer.from(worker.public_key_spki_der_base64, "base64"), format: "der", type: "spki" });
        } catch {
            throw apiError(401, "local_h3_worker_key_invalid", "Worker 公钥无效");
        }
        const canonical = canonicalRequest(workerId, timestamp, nonce, req.method, String(req.url || "/"), sha256(body));
        let valid = false;
        try {
            valid = verifySignature(null, Buffer.from(canonical, "utf8"), publicKey, Buffer.from(signatureText, "base64"));
        } catch {}
        if (!valid) throw apiError(401, "local_h3_signature_invalid", "Worker 请求签名无效");
        transaction(db, () => {
            const at = iso(now());
            db.prepare("DELETE FROM local_worker_nonce WHERE expires_at<?").run(at);
            if (db.prepare("SELECT 1 AS ok FROM local_worker_nonce WHERE worker_id=? AND nonce=?").get(workerId, nonce)?.ok) throw apiError(409, "local_h3_nonce_replayed", "Worker 请求 nonce 已使用");
            db.prepare("INSERT INTO local_worker_nonce(worker_id,nonce,expires_at,created_at) VALUES(?,?,?,?)").run(workerId, nonce, iso(now() + signatureSkewMs * 2), at);
            db.prepare("UPDATE local_worker SET last_seen_at=?,updated_at=? WHERE worker_id=?").run(at, at, workerId);
        });
        return workerId;
    }

    function createPairingCode() {
        const pairingCode = `h3pair_${randomBytes(32).toString("base64url")}`;
        const createdAt = iso(now());
        const expiresAt = iso(now() + 5 * 60_000);
        db.prepare("DELETE FROM local_worker_pairing_code WHERE expires_at<? OR consumed_at IS NOT NULL").run(createdAt);
        db.prepare("INSERT INTO local_worker_pairing_code(code_sha256,expires_at,created_by,created_at) VALUES(?,?,?,?)").run(sha256(pairingCode), expiresAt, "local", createdAt);
        db.prepare("INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('local_h3.pairing_code','worker',?,?)").run(JSON.stringify({ createdBy: "local", expiresAt }), createdAt);
        return { pairingCode, expiresAt };
    }

    function pairWorker(body) {
        const pairingCode = String(body?.pairingCode || "");
        const workerId = safeId(body?.workerId, /^worker_[a-zA-Z0-9._-]{3,80}$/, "local_h3_worker_id_invalid", "Worker 标识无效");
        const displayName = String(body?.displayName || "")
            .trim()
            .slice(0, 100);
        if (!displayName) throw apiError(400, "local_h3_worker_name_invalid", "Worker 名称无效");
        if (String(body?.capabilities?.workflowSha256 || "").toLowerCase() !== workflowSha256 || Number(body?.capabilities?.maxActive) !== 1)
            throw apiError(409, "local_h3_worker_capability_mismatch", "Worker 工作流或并发能力与服务器不一致");
        const publicKeyText = String(body?.publicKeySpkiDerBase64 || "");
        let publicKey;
        try {
            publicKey = createPublicKey({ key: Buffer.from(publicKeyText, "base64"), format: "der", type: "spki" });
        } catch {}
        if (!publicKey || publicKey.asymmetricKeyType !== "ed25519") throw apiError(400, "local_h3_worker_public_key_invalid", "Worker 必须提供 Ed25519 SPKI 公钥");
        const canonicalPublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
        const at = iso(now());
        transaction(db, () => {
            const pairing = db.prepare("SELECT * FROM local_worker_pairing_code WHERE code_sha256=?").get(sha256(pairingCode));
            if (!pairing || pairing.consumed_at || pairing.expires_at < at) throw apiError(401, "local_h3_pairing_code_invalid", "Worker 配对码无效或已过期");
            const existing = db.prepare("SELECT status FROM local_worker WHERE worker_id=?").get(workerId);
            if (existing?.status === "active") throw apiError(409, "local_h3_worker_exists", "Worker 标识已存在，不能静默替换公钥");
            if (existing) {
                db.prepare(
                    "UPDATE local_worker SET display_name=?,public_key_spki_der_base64=?,status='active',capabilities_json=?,allowed_workflow_sha256=?,paired_by=?,current_job_id=NULL,last_seen_at=NULL,updated_at=? WHERE worker_id=?",
                ).run(displayName, canonicalPublicKey, JSON.stringify({ workflowSha256, maxActive: 1 }), workflowSha256, pairing.created_by, at, workerId);
                db.prepare("DELETE FROM local_worker_nonce WHERE worker_id=?").run(workerId);
            } else {
                db.prepare(
                    "INSERT INTO local_worker(worker_id,display_name,public_key_spki_der_base64,status,capabilities_json,allowed_workflow_sha256,paired_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                ).run(workerId, displayName, canonicalPublicKey, "active", JSON.stringify({ workflowSha256, maxActive: 1 }), workflowSha256, pairing.created_by, at, at);
            }
            db.prepare("UPDATE local_worker_pairing_code SET consumed_at=? WHERE code_sha256=? AND consumed_at IS NULL").run(at, pairing.code_sha256);
            db.prepare("INSERT INTO audit_event(kind,subject,detail,created_at) VALUES(?,?,?,?)").run(
                existing ? "local_h3.worker_repaired" : "local_h3.worker_paired",
                workerId,
                JSON.stringify({ displayName, workflowSha256, pairedBy: pairing.created_by }),
                at,
            );
        });
        return { workerId, displayName, workflowId: LOCAL_H3_WORKFLOW_ID, workflowSha256, maxActive: 1, pairedAt: at };
    }

    function revokeWorker(workerIdValue, user) {
        const workerId = safeId(workerIdValue, /^worker_[a-zA-Z0-9._-]{3,80}$/, "local_h3_worker_id_invalid", "Worker 标识无效");
        let result;
        transaction(db, () => {
            const worker = db.prepare("SELECT worker_id,display_name,status FROM local_worker WHERE worker_id=?").get(workerId);
            if (!worker) throw apiError(404, "local_h3_worker_not_found", "Worker 不存在");
            const at = iso(now());
            db.prepare("UPDATE local_worker SET status='revoked',current_job_id=NULL,last_seen_at=NULL,updated_at=? WHERE worker_id=?").run(at, workerId);
            db.prepare("DELETE FROM local_worker_nonce WHERE worker_id=?").run(workerId);
            db.prepare("UPDATE local_worker_job SET state='queued',worker_id=NULL,lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE worker_id=? AND state IN ('leased','compiling')").run(
                at,
                workerId,
            );
            db.prepare(
                "UPDATE local_worker_job SET state='recovery_pending',worker_id=NULL,lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE worker_id=? AND state IN ('submitted','running','rendered','uploading','verifying','recovery_pending')",
            ).run(at, workerId);
            db.prepare(
                "UPDATE generation_task SET status=CASE WHEN (SELECT state FROM local_worker_job WHERE job_id=task_id)='queued' THEN 'pending' ELSE 'result_pending' END,last_provider_status=(SELECT state FROM local_worker_job WHERE job_id=task_id),updated_at=? WHERE provider=? AND task_id IN (SELECT job_id FROM local_worker_job WHERE worker_id IS NULL AND state IN ('queued','recovery_pending'))",
            ).run(at, LOCAL_H3_PROVIDER);
            db.prepare("INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('local_h3.worker_revoked',?,?,?)").run(workerId, JSON.stringify({ revokedBy: "local" }), at);
            result = { workerId, displayName: worker.display_name, status: "revoked", revokedAt: at };
        });
        return result;
    }

    function heartbeat(workerId, body) {
        if (String(body?.capabilities?.workflowSha256 || "").toLowerCase() !== workflowSha256 || Number(body?.capabilities?.maxActive) !== 1)
            throw apiError(409, "local_h3_worker_capability_mismatch", "Worker 工作流或并发能力与服务器不一致");
        const currentJobId = body?.currentJobId ? safeId(body.currentJobId, /^h3job-[a-zA-Z0-9-]{8,100}$/, "local_h3_job_id_invalid", "H3 任务标识无效") : null;
        const at = iso(now());
        db.prepare("UPDATE local_worker SET current_job_id=?,last_seen_at=?,updated_at=? WHERE worker_id=?").run(currentJobId, at, at, workerId);
        const cancelRequested = currentJobId
            ? Boolean(db.prepare("SELECT cancel_requested_at FROM local_worker_job WHERE job_id=? AND worker_id=?").get(currentJobId, workerId)?.cancel_requested_at)
            : false;
        return { ok: true, serverTime: at, cancelRequested };
    }

    function recoverExpiredLeases(at) {
        db.prepare(
            "UPDATE local_worker_job SET state='queued',worker_id=NULL,lease_id=NULL,lease_expires_at=NULL,updated_at=? WHERE state IN ('leased','compiling') AND lease_expires_at IS NOT NULL AND lease_expires_at<?",
        ).run(at, at);
        db.prepare(
            "UPDATE local_worker_job SET state='recovery_pending',updated_at=? WHERE state IN ('submitted','running','rendered','uploading','verifying') AND lease_expires_at IS NOT NULL AND lease_expires_at<?",
        ).run(at, at);
        db.prepare(
            "UPDATE generation_task SET status=CASE WHEN (SELECT state FROM local_worker_job WHERE job_id=task_id) IN ('rendered','uploading','verifying','recovery_pending') THEN 'result_pending' ELSE 'pending' END,last_provider_status=(SELECT state FROM local_worker_job WHERE job_id=task_id),updated_at=? WHERE provider=? AND task_id IN (SELECT job_id FROM local_worker_job WHERE state NOT IN ('completed','failed','cancelled'))",
        ).run(at, LOCAL_H3_PROVIDER);
    }

    function claim(workerId) {
        let claimed = null;
        transaction(db, () => {
            const at = iso(now());
            recoverExpiredLeases(at);
            let row = db
                .prepare(
                    "SELECT * FROM local_worker_job WHERE worker_id=? AND state IN ('leased','compiling','submitted','running','rendered','uploading','verifying','recovery_pending') ORDER BY created_at LIMIT 1",
                )
                .get(workerId);
            if (row) {
                const leaseExpired = !row.lease_expires_at || row.lease_expires_at < at;
                const leaseId = leaseExpired ? `lease_${randomUUID()}` : row.lease_id;
                const nextState = POST_SUBMISSION_STATES.has(row.state) && leaseExpired ? "recovery_pending" : row.state;
                const expiresAt = iso(now() + leaseMs);
                db.prepare("UPDATE local_worker_job SET state=?,lease_id=?,lease_expires_at=?,updated_at=? WHERE job_id=?").run(nextState, leaseId, expiresAt, at, row.job_id);
                db.prepare("INSERT OR IGNORE INTO local_worker_assignment(job_id,worker_id,lease_id,assigned_at) VALUES(?,?,?,?)").run(row.job_id, workerId, leaseId, at);
                if (leaseExpired) db.prepare("UPDATE local_worker_upload SET lease_id=?,updated_at=? WHERE job_id=? AND state IN ('open','verifying')").run(leaseId, at, row.job_id);
                db.prepare("UPDATE local_worker SET current_job_id=?,last_seen_at=?,updated_at=? WHERE worker_id=?").run(row.job_id, at, at, workerId);
                row = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(row.job_id);
                claimed = workerJob(row, workflowSha256);
                return;
            }
            row = db.prepare("SELECT * FROM local_worker_job WHERE worker_id IS NULL AND state='recovery_pending' ORDER BY created_at,job_id LIMIT 1").get();
            if (row) {
                const leaseId = `lease_${randomUUID()}`;
                const expiresAt = iso(now() + leaseMs);
                db.prepare(
                    "UPDATE local_worker_job SET worker_id=?,lease_id=?,lease_expires_at=?,attempt=attempt+1,updated_at=? WHERE job_id=? AND worker_id IS NULL AND state='recovery_pending'",
                ).run(workerId, leaseId, expiresAt, at, row.job_id);
                db.prepare("INSERT INTO local_worker_assignment(job_id,worker_id,lease_id,assigned_at) VALUES(?,?,?,?)").run(row.job_id, workerId, leaseId, at);
                db.prepare("UPDATE local_worker_upload SET worker_id=?,lease_id=?,updated_at=? WHERE job_id=? AND state IN ('open','verifying')").run(workerId, leaseId, at, row.job_id);
                db.prepare("UPDATE local_worker SET current_job_id=?,last_seen_at=?,updated_at=? WHERE worker_id=?").run(row.job_id, at, at, workerId);
                row = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(row.job_id);
                claimed = workerJob(row, workflowSha256);
                return;
            }
            if (db.prepare("SELECT 1 AS ok FROM local_worker_job WHERE state IN ('leased','compiling','submitted','running','rendered','uploading','verifying','recovery_pending') LIMIT 1").get()?.ok)
                return;
            row = db.prepare("SELECT * FROM local_worker_job WHERE state='queued' ORDER BY created_at,job_id LIMIT 1").get();
            if (!row) return;
            const leaseId = `lease_${randomUUID()}`;
            const expiresAt = iso(now() + leaseMs);
            db.prepare("UPDATE local_worker_job SET state='leased',worker_id=?,lease_id=?,lease_expires_at=?,attempt=attempt+1,updated_at=? WHERE job_id=? AND state='queued'").run(
                workerId,
                leaseId,
                expiresAt,
                at,
                row.job_id,
            );
            db.prepare("INSERT INTO local_worker_assignment(job_id,worker_id,lease_id,assigned_at) VALUES(?,?,?,?)").run(row.job_id, workerId, leaseId, at);
            db.prepare("UPDATE local_worker SET current_job_id=?,last_seen_at=?,updated_at=? WHERE worker_id=?").run(row.job_id, at, at, workerId);
            db.prepare("UPDATE generation_task SET status='pending',last_provider_status='leased',updated_at=? WHERE provider=? AND task_id=?").run(at, LOCAL_H3_PROVIDER, row.job_id);
            row = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(row.job_id);
            claimed = workerJob(row, workflowSha256);
        });
        if (claimed) emit(claimed.jobId);
        return claimed;
    }

    function assertLease(row, workerId, leaseId) {
        if (!row || row.worker_id !== workerId || row.lease_id !== leaseId) throw apiError(409, "local_h3_lease_fenced", "H3 任务租约已失效或不属于当前 Worker");
        if (!row.lease_expires_at || row.lease_expires_at < iso(now())) throw apiError(409, "local_h3_lease_expired", "H3 任务租约已过期，必须重新领取并取得新租约");
    }

    function renewLease(workerId, jobId, body) {
        const leaseId = safeId(body?.leaseId, /^lease_[a-zA-Z0-9-]{8,100}$/, "local_h3_lease_id_invalid", "H3 租约标识无效");
        const state = String(body?.state || "");
        const eventId = safeId(body?.eventId, /^[a-zA-Z0-9._:-]{8,200}$/, "local_h3_event_id_invalid", "H3 进度事件标识无效");
        const progress = body?.progress === undefined ? null : Number(body.progress);
        if (progress !== null && (!Number.isFinite(progress) || progress < 0 || progress > 1)) throw apiError(400, "local_h3_progress_invalid", "H3 任务进度无效");
        let output;
        transaction(db, () => {
            let row = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(jobId);
            assertLease(row, workerId, leaseId);
            if (TERMINAL_STATES.has(row.state)) throw apiError(409, "local_h3_job_terminal", "H3 任务已经结束");
            const duplicate = db.prepare("SELECT 1 AS ok FROM local_worker_event WHERE job_id=? AND event_id=?").get(jobId, eventId)?.ok;
            if (duplicate) {
                output = { leaseExpiresAt: row.lease_expires_at, cancelRequested: Boolean(row.cancel_requested_at), state: row.state };
                return;
            }
            if (!LEASE_TRANSITIONS.get(row.state)?.has(state)) throw apiError(409, "local_h3_state_transition_invalid", "H3 Worker 状态转换无效", { current: row.state, next: state });
            const comfyPromptId =
                body?.comfyPromptId === undefined ? row.comfy_prompt_id : safeId(body.comfyPromptId, /^[a-zA-Z0-9._:-]{3,200}$/, "local_h3_comfy_prompt_id_invalid", "ComfyUI prompt id 无效");
            if (row.comfy_prompt_id && comfyPromptId !== row.comfy_prompt_id) throw apiError(409, "local_h3_comfy_prompt_immutable", "ComfyUI prompt id 不可覆盖");
            const promptFinal = body?.promptFinal === undefined ? row.prompt_final : String(body.promptFinal || "").slice(0, 16000);
            const compilerId = body?.compilerId === undefined ? row.compiler_id : safeId(body.compilerId, /^[a-zA-Z0-9._:-]{1,100}$/, "local_h3_compiler_id_invalid", "提示词编译器标识无效");
            if (row.prompt_final && promptFinal !== row.prompt_final) throw apiError(409, "local_h3_prompt_final_immutable", "已提交的最终提示词不可覆盖");
            if (row.compiler_id && compilerId !== row.compiler_id) throw apiError(409, "local_h3_compiler_immutable", "提示词编译器标识不可覆盖");
            const at = iso(now());
            const leaseExpiresAt = iso(now() + leaseMs);
            db.prepare("INSERT INTO local_worker_event(job_id,event_id,worker_id,lease_id,state,created_at) VALUES(?,?,?,?,?,?)").run(jobId, eventId, workerId, leaseId, state, at);
            db.prepare("UPDATE local_worker_job SET state=?,progress=COALESCE(?,progress),comfy_prompt_id=?,prompt_final=?,compiler_id=?,lease_expires_at=?,updated_at=? WHERE job_id=?").run(
                state,
                progress,
                comfyPromptId || null,
                promptFinal || null,
                compilerId || null,
                leaseExpiresAt,
                at,
                jobId,
            );
            db.prepare("UPDATE generation_task SET status=?,last_provider_status=?,last_checked_at=?,last_successful_check_at=?,updated_at=? WHERE provider=? AND task_id=?").run(
                localStateToTaskStatus(state),
                state,
                at,
                at,
                at,
                LOCAL_H3_PROVIDER,
                jobId,
            );
            row = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(jobId);
            output = { leaseExpiresAt, cancelRequested: Boolean(row.cancel_requested_at), state: row.state };
        });
        emit(jobId);
        return output;
    }

    function createUpload(workerId, jobId, body) {
        const leaseId = safeId(body?.leaseId, /^lease_[a-zA-Z0-9-]{8,100}$/, "local_h3_lease_id_invalid", "H3 租约标识无效");
        const expectedBytes = Number(body?.expectedBytes);
        const expectedSha256 = String(body?.sha256 || "").toLowerCase();
        const mimeType = String(body?.mimeType || "").toLowerCase();
        if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > maxUploadBytes) throw apiError(400, "local_h3_upload_size_invalid", "H3 成片大小无效");
        if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw apiError(400, "local_h3_upload_hash_invalid", "H3 成片 SHA-256 无效");
        if (mimeType !== "video/mp4") throw apiError(400, "local_h3_upload_mime_invalid", "H3 成片必须为 video/mp4");
        let result;
        transaction(db, () => {
            const job = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(jobId);
            assertLease(job, workerId, leaseId);
            if (!new Set(["rendered", "uploading", "verifying", "recovery_pending"]).has(job.state)) throw apiError(409, "local_h3_upload_state_invalid", "当前 H3 状态不能创建上传");
            const existing = db.prepare("SELECT * FROM local_worker_upload WHERE job_id=?").get(jobId);
            if (existing) {
                if (existing.worker_id !== workerId || existing.expected_bytes !== expectedBytes || existing.expected_sha256 !== expectedSha256 || existing.mime_type !== mimeType)
                    throw apiError(409, "local_h3_upload_conflict", "H3 上传参数与既有上传不一致");
                result = { uploadId: existing.upload_id, receivedBytes: Number(existing.received_bytes), chunkSize: Number(existing.chunk_size) };
                return;
            }
            const uploadId = `h3upload-${randomUUID()}`;
            const temporaryPath = join(uploadRoot, `${uploadId}.part`);
            const at = iso(now());
            db.prepare(
                "INSERT INTO local_worker_upload(upload_id,job_id,worker_id,lease_id,temporary_path,expected_bytes,expected_sha256,mime_type,received_bytes,chunk_size,state,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ).run(uploadId, jobId, workerId, leaseId, temporaryPath, expectedBytes, expectedSha256, mimeType, 0, chunkSize, "open", iso(now() + 24 * 60 * 60_000), at, at);
            db.prepare("UPDATE local_worker_job SET state='uploading',lease_expires_at=?,updated_at=? WHERE job_id=?").run(iso(now() + leaseMs), at, jobId);
            db.prepare("UPDATE generation_task SET status='result_pending',last_provider_status='uploading',updated_at=? WHERE provider=? AND task_id=?").run(at, LOCAL_H3_PROVIDER, jobId);
            result = { uploadId, receivedBytes: 0, chunkSize };
        });
        emit(jobId);
        return result;
    }

    function getUpload(workerId, uploadId) {
        const upload = db.prepare("SELECT * FROM local_worker_upload WHERE upload_id=? AND worker_id=?").get(uploadId, workerId);
        if (!upload) throw apiError(404, "local_h3_upload_not_found", "H3 上传不存在");
        return { uploadId, receivedBytes: Number(upload.received_bytes), expectedBytes: Number(upload.expected_bytes), chunkSize: Number(upload.chunk_size), state: upload.state };
    }

    function recoverWorkerJob(workerId, jobIdValue) {
        const jobId = safeId(jobIdValue, /^h3job-[a-zA-Z0-9-]{8,100}$/, "local_h3_job_id_invalid", "H3 任务标识无效");
        const row = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(jobId);
        const knownWorker =
            row &&
            (row.worker_id === workerId ||
                db.prepare("SELECT 1 AS ok FROM local_worker_assignment WHERE job_id=? AND worker_id=? LIMIT 1").get(jobId, workerId)?.ok ||
                db.prepare("SELECT 1 AS ok FROM local_worker_event WHERE job_id=? AND worker_id=? LIMIT 1").get(jobId, workerId)?.ok ||
                db.prepare("SELECT 1 AS ok FROM local_worker_upload WHERE job_id=? AND worker_id=? LIMIT 1").get(jobId, workerId)?.ok);
        if (!knownWorker) throw apiError(404, "local_h3_job_not_found", "H3 任务不存在或不属于当前 Worker");
        const upload = db.prepare("SELECT upload_id,received_bytes,expected_bytes,chunk_size,state FROM local_worker_upload WHERE job_id=? ORDER BY created_at DESC LIMIT 1").get(jobId);
        return {
            job: publicJob(db, row),
            ...(upload
                ? {
                      upload: {
                          uploadId: upload.upload_id,
                          receivedBytes: Number(upload.received_bytes),
                          expectedBytes: Number(upload.expected_bytes),
                          chunkSize: Number(upload.chunk_size),
                          state: upload.state,
                      },
                  }
                : {}),
        };
    }

    function patchUpload(workerId, uploadId, req, chunk) {
        const leaseId = safeId(req.headers["x-narralight-lease-id"], /^lease_[a-zA-Z0-9-]{8,100}$/, "local_h3_lease_id_invalid", "H3 租约标识无效");
        const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(req.headers["content-range"] || ""));
        const chunkHash = String(req.headers["x-chunk-sha256"] || "").toLowerCase();
        if (!contentRange || !/^[a-f0-9]{64}$/.test(chunkHash)) throw apiError(400, "local_h3_chunk_headers_invalid", "H3 分块上传头无效");
        const start = Number(contentRange[1]);
        const end = Number(contentRange[2]);
        const total = Number(contentRange[3]);
        if (![start, end, total].every(Number.isSafeInteger) || end < start || chunk.length !== end - start + 1 || sha256(chunk) !== chunkHash)
            throw apiError(422, "local_h3_chunk_invalid", "H3 上传分块范围或 SHA-256 不匹配");
        let response;
        let jobId;
        transaction(db, () => {
            const upload = db.prepare("SELECT * FROM local_worker_upload WHERE upload_id=?").get(uploadId);
            if (!upload || upload.worker_id !== workerId) throw apiError(404, "local_h3_upload_not_found", "H3 上传不存在");
            const job = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(upload.job_id);
            assertLease(job, workerId, leaseId);
            if (upload.state !== "open" || upload.lease_id !== leaseId) throw apiError(409, "local_h3_upload_fenced", "H3 上传已经结束或租约已变化");
            if (total !== upload.expected_bytes || end >= total || chunk.length > upload.chunk_size) throw apiError(400, "local_h3_chunk_range_invalid", "H3 上传分块范围无效");
            const fileSize = existsSync(upload.temporary_path) ? statSync(upload.temporary_path).size : 0;
            const received = Number(upload.received_bytes);
            if (end < received) {
                if (fileSize < end + 1) throw apiError(409, "local_h3_upload_inconsistent", "H3 上传临时文件与进度不一致");
                const existing = Buffer.alloc(chunk.length);
                const fd = openSync(upload.temporary_path, "r");
                try {
                    readSync(fd, existing, 0, existing.length, start);
                } finally {
                    closeSync(fd);
                }
                if (sha256(existing) !== chunkHash) throw apiError(409, "local_h3_chunk_replay_conflict", "H3 重传分块内容不一致");
                response = { uploadId, receivedBytes: received, expectedBytes: total, complete: received === total };
                jobId = job.job_id;
                return;
            }
            if (start !== received) throw apiError(409, "local_h3_chunk_out_of_order", "H3 首版只接受顺序分块", { expectedStart: received });
            if (fileSize !== received) {
                if (fileSize === end + 1) {
                    const existing = Buffer.alloc(chunk.length);
                    const fd = openSync(upload.temporary_path, "r");
                    try {
                        readSync(fd, existing, 0, existing.length, start);
                    } finally {
                        closeSync(fd);
                    }
                    if (sha256(existing) !== chunkHash) throw apiError(409, "local_h3_upload_inconsistent", "H3 上传临时文件与数据库进度不一致");
                } else throw apiError(409, "local_h3_upload_inconsistent", "H3 上传临时文件与数据库进度不一致");
            } else {
                const fd = openSync(upload.temporary_path, received ? "r+" : "w");
                try {
                    writeSync(fd, chunk, 0, chunk.length, start);
                    fsyncSync(fd);
                } finally {
                    closeSync(fd);
                }
            }
            const next = end + 1;
            const at = iso(now());
            db.prepare("UPDATE local_worker_upload SET received_bytes=?,updated_at=? WHERE upload_id=?").run(next, at, uploadId);
            db.prepare("UPDATE local_worker_job SET state='uploading',progress=?,lease_expires_at=?,updated_at=? WHERE job_id=?").run(next / total, iso(now() + leaseMs), at, job.job_id);
            db.prepare("UPDATE generation_task SET status='result_pending',last_provider_status='uploading',updated_at=? WHERE provider=? AND task_id=?").run(at, LOCAL_H3_PROVIDER, job.job_id);
            response = { uploadId, receivedBytes: next, expectedBytes: total, complete: next === total };
            jobId = job.job_id;
        });
        if (jobId) emit(jobId);
        return response;
    }

    function markVerificationFailure(upload, error) {
        const at = iso(now());
        const terminal = Number(error?.status || 500) < 500;
        transaction(db, () => {
            if (terminal) {
                const code = safeErrorCode(error?.code, "local_h3_media_invalid");
                db.prepare("UPDATE local_worker_upload SET state='invalid',updated_at=? WHERE upload_id=?").run(at, upload.upload_id);
                db.prepare("UPDATE local_worker_job SET state='failed',error_code=?,error_message=?,lease_expires_at=NULL,updated_at=? WHERE job_id=?").run(
                    code,
                    safeErrorMessage(error?.message),
                    at,
                    upload.job_id,
                );
                db.prepare("UPDATE generation_task SET status='failed',error_code=?,last_provider_status='failed',updated_at=? WHERE provider=? AND task_id=?").run(
                    code,
                    at,
                    LOCAL_H3_PROVIDER,
                    upload.job_id,
                );
                db.prepare("UPDATE video_generation_take SET status='failed',error_code=?,updated_at=? WHERE take_id=(SELECT take_id FROM local_worker_job WHERE job_id=?)").run(
                    code,
                    at,
                    upload.job_id,
                );
            } else {
                db.prepare("UPDATE local_worker_upload SET state='open',updated_at=? WHERE upload_id=?").run(at, upload.upload_id);
                db.prepare("UPDATE local_worker_job SET state='uploading',updated_at=? WHERE job_id=?").run(at, upload.job_id);
                db.prepare("UPDATE generation_task SET status='result_pending',last_provider_status='uploading',updated_at=? WHERE provider=? AND task_id=?").run(at, LOCAL_H3_PROVIDER, upload.job_id);
            }
        });
        emit(upload.job_id);
    }

    async function completeUpload(workerId, uploadId, body) {
        const leaseId = safeId(body?.leaseId, /^lease_[a-zA-Z0-9-]{8,100}$/, "local_h3_lease_id_invalid", "H3 租约标识无效");
        let upload = db.prepare("SELECT * FROM local_worker_upload WHERE upload_id=?").get(uploadId);
        if (!upload || upload.worker_id !== workerId) throw apiError(404, "local_h3_upload_not_found", "H3 上传不存在");
        if (upload.state === "finalized") {
            const job = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(upload.job_id);
            return { finalized: true, job: publicJob(db, job) };
        }
        const job = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(upload.job_id);
        assertLease(job, workerId, leaseId);
        if (Number(upload.received_bytes) !== Number(upload.expected_bytes)) throw apiError(409, "local_h3_upload_incomplete", "H3 成片尚未上传完整");
        const finalCandidate = objectPath(dataRoot, upload.expected_sha256);
        const sourcePath = existsSync(upload.temporary_path) ? upload.temporary_path : finalCandidate;
        if (!existsSync(sourcePath) || statSync(sourcePath).size !== Number(upload.expected_bytes)) throw apiError(409, "local_h3_upload_file_missing", "H3 上传临时文件缺失或大小不一致");
        const at = iso(now());
        transaction(db, () => {
            const current = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(upload.job_id);
            assertLease(current, workerId, leaseId);
            db.prepare("UPDATE local_worker_upload SET state='verifying',updated_at=? WHERE upload_id=?").run(at, uploadId);
            db.prepare("UPDATE local_worker_job SET state='verifying',lease_expires_at=?,updated_at=? WHERE job_id=?").run(iso(now() + leaseMs), at, upload.job_id);
            db.prepare("UPDATE generation_task SET status='result_pending',last_provider_status='verifying',updated_at=? WHERE provider=? AND task_id=?").run(at, LOCAL_H3_PROVIDER, upload.job_id);
        });
        emit(upload.job_id);
        let media;
        try {
            if ((await fileSha256(sourcePath)) !== upload.expected_sha256) throw apiError(422, "local_h3_file_hash_mismatch", "H3 成片完整 SHA-256 不匹配");
            media = normalizeProbe(await probeVideoFile(sourcePath), specForParameters(jobContract(job).parameters));
            if (
                sourcePath !== finalCandidate &&
                existsSync(finalCandidate) &&
                (statSync(finalCandidate).size !== Number(upload.expected_bytes) || (await fileSha256(finalCandidate)) !== upload.expected_sha256)
            ) {
                throw apiError(500, "local_h3_object_store_conflict", "对象存储中已有同名但校验失败的文件");
            }
        } catch (error) {
            markVerificationFailure(upload, error);
            throw error;
        }
        let result;
        transaction(db, () => {
            const current = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(upload.job_id);
            assertLease(current, workerId, leaseId);
            const finishedAt = iso(now());
            if (current.cancel_requested_at) {
                db.prepare("UPDATE local_worker_upload SET state='cancelled',updated_at=? WHERE upload_id=?").run(finishedAt, uploadId);
                db.prepare("UPDATE local_worker_job SET state='cancelled',error_code='local_h3_cancelled',lease_expires_at=NULL,updated_at=? WHERE job_id=?").run(finishedAt, upload.job_id);
                db.prepare("UPDATE generation_task SET status='cancelled',error_code='local_h3_cancelled',last_provider_status='cancelled',updated_at=? WHERE provider=? AND task_id=?").run(
                    finishedAt,
                    LOCAL_H3_PROVIDER,
                    upload.job_id,
                );
                db.prepare("UPDATE video_generation_take SET status='failed',error_code='local_h3_cancelled',updated_at=? WHERE take_id=?").run(finishedAt, current.take_id);
                result = { finalized: false, cancelled: true, jobId: upload.job_id };
                return;
            }
            const target = objectPath(dataRoot, upload.expected_sha256);
            mkdirSync(join(dataRoot, "objects", upload.expected_sha256.slice(0, 2), upload.expected_sha256.slice(2, 4)), { recursive: true });
            if (!existsSync(target)) renameSync(sourcePath, target);
            else if (sourcePath !== target) removeFile(sourcePath);
            const bytes = Number(upload.expected_bytes);
            const sourceMarker = sha256(`local-h3:${upload.job_id}`);
            db.prepare(
                "INSERT INTO remote_result(provider,task_id,result_index,media_kind,hash,mime_type,bytes,source_url_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,task_id,result_index) DO UPDATE SET hash=excluded.hash,mime_type=excluded.mime_type,bytes=excluded.bytes,source_url_hash=excluded.source_url_hash",
            ).run(LOCAL_H3_PROVIDER, upload.job_id, 0, "video", upload.expected_sha256, upload.mime_type, bytes, sourceMarker, finishedAt);
            db.prepare(
                "UPDATE generation_task SET status='completed',result_index=0,error_code=NULL,last_provider_status='completed',last_checked_at=?,last_successful_check_at=?,updated_at=? WHERE provider=? AND task_id=?",
            ).run(finishedAt, finishedAt, finishedAt, LOCAL_H3_PROVIDER, upload.job_id);
            db.prepare("UPDATE video_generation_take SET status='completed',hash=?,mime_type=?,bytes=?,duration_ms=?,result_index=0,error_code=NULL,updated_at=? WHERE take_id=?").run(
                upload.expected_sha256,
                upload.mime_type,
                bytes,
                media.durationMs,
                finishedAt,
                current.take_id,
            );
            db.prepare(
                "INSERT INTO video_node_history(project_id,node_id,active_take_id,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id,node_id) DO UPDATE SET active_take_id=excluded.active_take_id,updated_at=excluded.updated_at",
            ).run(current.project_id, current.node_id, current.take_id, finishedAt, finishedAt);
            db.prepare("UPDATE local_worker_upload SET state='finalized',updated_at=? WHERE upload_id=?").run(finishedAt, uploadId);
            db.prepare(
                "UPDATE local_worker_job SET state='completed',progress=1,result_hash=?,result_mime_type=?,result_bytes=?,result_duration_ms=?,lease_expires_at=NULL,error_code=NULL,error_message=NULL,updated_at=? WHERE job_id=?",
            ).run(upload.expected_sha256, upload.mime_type, bytes, media.durationMs, finishedAt, upload.job_id);
            db.prepare("UPDATE local_worker SET current_job_id=NULL,updated_at=? WHERE worker_id=? AND current_job_id=?").run(finishedAt, workerId, upload.job_id);
            db.prepare("INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('local_h3.completed',?,?,?)").run(
                upload.job_id,
                JSON.stringify({ takeId: current.take_id, hash: upload.expected_sha256, bytes, durationMs: media.durationMs, chargeExpected: false }),
                finishedAt,
            );
            result = { finalized: true, storageKey: `sha256:${upload.expected_sha256}`, mimeType: upload.mime_type, bytes, durationMs: media.durationMs };
        });
        emit(upload.job_id);
        return result;
    }

    function terminal(workerId, jobId, body) {
        const leaseId = safeId(body?.leaseId, /^lease_[a-zA-Z0-9-]{8,100}$/, "local_h3_lease_id_invalid", "H3 租约标识无效");
        const status = String(body?.status || "");
        if (!new Set(["failed", "cancelled"]).has(status)) throw apiError(400, "local_h3_terminal_state_invalid", "H3 终态无效");
        if (body?.retryable === true) throw apiError(400, "local_h3_retry_forbidden", "服务器不会自动重试或重复提交 H3 生成");
        let output;
        transaction(db, () => {
            const row = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(jobId);
            if (!row) throw apiError(404, "local_h3_job_not_found", "H3 任务不存在");
            if (TERMINAL_STATES.has(row.state)) {
                if (String(row.worker_id || "") !== workerId) throw apiError(404, "local_h3_job_not_found", "H3 任务不存在");
                if (row.state !== status) throw apiError(409, "local_h3_job_terminal", "H3 任务已经以其他状态结束");
                output = publicJob(db, row);
                return;
            }
            assertLease(row, workerId, leaseId);
            const errorCode = status === "cancelled" ? "local_h3_cancelled" : safeErrorCode(body?.errorCode);
            const errorMessage = status === "cancelled" ? "用户已取消本地 H3 生成" : safeErrorMessage(body?.errorMessage);
            const at = iso(now());
            db.prepare("UPDATE local_worker_job SET state=?,error_code=?,error_message=?,lease_expires_at=NULL,updated_at=? WHERE job_id=?").run(status, errorCode, errorMessage, at, jobId);
            db.prepare("UPDATE generation_task SET status=?,error_code=?,last_provider_status=?,updated_at=? WHERE provider=? AND task_id=?").run(
                status,
                errorCode,
                status,
                at,
                LOCAL_H3_PROVIDER,
                jobId,
            );
            db.prepare("UPDATE video_generation_take SET status='failed',error_code=?,updated_at=? WHERE take_id=?").run(errorCode, at, row.take_id);
            db.prepare("UPDATE local_worker SET current_job_id=NULL,updated_at=? WHERE worker_id=? AND current_job_id=?").run(at, workerId, jobId);
            db.prepare("UPDATE local_worker_upload SET state=?,updated_at=? WHERE job_id=? AND state<>'finalized'").run(status, at, jobId);
            db.prepare("INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('local_h3.terminal',?,?,?)").run(
                jobId,
                JSON.stringify({ status, errorCode, retryable: false, chargeExpected: false }),
                at,
            );
            output = publicJob(db, db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(jobId));
        });
        emit(jobId);
        return output;
    }

    function createJob(input, idempotencyKey) {
        const unexpected = Object.keys(input || {}).find((key) => !USER_JOB_FIELDS.has(key));
        if (unexpected) throw apiError(400, "local_h3_job_field_unsupported", "本地 H3 任务包含未允许字段", { field: unexpected });
        const takeId = safeId(input?.takeId, /^take_[a-zA-Z0-9-]{8,100}$/, "invalid_video_take_id", "视频版本标识无效");
        const projectId = safeId(input?.projectId, /^[a-zA-Z0-9_.:-]{1,200}$/, "invalid_video_take_owner", "视频节点归属无效");
        const nodeId = safeId(input?.nodeId, /^[a-zA-Z0-9_.:-]{1,200}$/, "invalid_video_take_owner", "视频节点归属无效");
        const requestId = safeId(idempotencyKey, /^[a-zA-Z0-9_.:-]{8,200}$/, "local_h3_idempotency_key_invalid", "Idempotency-Key 无效");
        const promptOriginalZh = String(input?.promptOriginalZh ?? "");
        if (!promptOriginalZh || promptOriginalZh.length > 16000) throw apiError(400, "local_h3_prompt_invalid", "本地 H3 中文提示词无效");
        const seed = Number(input?.seed);
        if (!Number.isSafeInteger(seed) || seed < 0) throw apiError(400, "local_h3_seed_invalid", "本地 H3 seed 必须是非负安全整数");
        if (input?.model !== LOCAL_H3_MODEL) throw apiError(400, "local_h3_model_fixed", "本地 H3 首版只允许 local-h3-base");
        const parameters = normalizeLocalH3Parameters(input?.parameters);
        const references = normalizeReferences(input?.references, parameters.referenceMode, dataRoot);
        const normalized = {
            takeId,
            projectId,
            nodeId,
            promptOriginalZh,
            seed,
            model: LOCAL_H3_MODEL,
            parameters,
            references: references.map(({ storageKey, mimeType, role }) => ({ storageKey, mimeType, role })),
        };
        const requestSha256 = sha256(JSON.stringify(normalized));
        let row;
        transaction(db, () => {
            const existing = db.prepare("SELECT * FROM local_worker_job WHERE request_id=?").get(requestId);
            if (existing) {
                if (existing.request_sha256 !== requestSha256) throw apiError(409, "local_h3_idempotency_conflict", "同一 Idempotency-Key 对应了不同请求");
                row = existing;
                return;
            }
            const take = db.prepare("SELECT * FROM video_generation_take WHERE take_id=?").get(takeId);
            if (!take) throw apiError(404, "video_take_not_found", "视频版本不存在");
            if (take.project_id !== projectId || take.node_id !== nodeId) throw apiError(409, "local_h3_take_owner_mismatch", "视频版本与项目节点不一致");
            if (take.status !== "created" || take.provider || take.task_id) throw apiError(409, "local_h3_take_not_available", "视频版本已绑定其他生成任务");
            if (take.model !== LOCAL_H3_MODEL) throw apiError(409, "local_h3_take_model_mismatch", "视频版本模型不是 local-h3-base");
            if (take.prompt !== promptOriginalZh) throw apiError(409, "local_h3_take_prompt_mismatch", "提交提示词与视频版本记录不一致");
            let takeParameters = {};
            try {
                takeParameters = JSON.parse(take.params_json || "{}");
            } catch {}
            const takeContract = normalizeLocalH3Parameters(takeParameters);
            if (JSON.stringify(takeContract) !== JSON.stringify(parameters)) throw apiError(409, "local_h3_take_parameters_mismatch", "提交参数与视频版本记录不一致");
            if (Number(db.prepare("SELECT COUNT(*) AS count FROM local_worker_job WHERE state='queued'").get()?.count || 0) >= maxQueued)
                throw apiError(429, "local_h3_queue_full", "本地 H3 队列已满，请稍后再试");
            if (db.prepare("SELECT 1 AS ok FROM local_worker_job WHERE take_id=?").get(takeId)?.ok) throw apiError(409, "local_h3_take_already_queued", "视频版本已经存在本地 H3 任务");
            const jobId = `h3job-${randomUUID()}`;
            const at = iso(now());
            db.prepare(
                "INSERT INTO local_worker_job(job_id,take_id,request_id,request_sha256,project_id,node_id,user_id,workflow_id,workflow_sha256,prompt_original_zh,seed,parameters_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ).run(
                jobId,
                takeId,
                requestId,
                requestSha256,
                projectId,
                nodeId,
                "local",
                LOCAL_H3_WORKFLOW_ID,
                workflowSha256,
                promptOriginalZh,
                seed,
                JSON.stringify({ parameters, references }),
                "queued",
                at,
                at,
            );
            db.prepare(
                "INSERT INTO generation_task(provider,task_id,media_kind,model,channel_id,project_id,node_id,status,last_provider_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            ).run(LOCAL_H3_PROVIDER, jobId, "video", LOCAL_H3_MODEL, LOCAL_H3_PROVIDER, projectId, nodeId, "pending", "queued", at, at);
            db.prepare("UPDATE video_generation_take SET status='pending',provider=?,task_id=?,model=?,updated_at=? WHERE take_id=? AND status='created' AND provider IS NULL AND task_id IS NULL").run(
                LOCAL_H3_PROVIDER,
                jobId,
                LOCAL_H3_MODEL,
                at,
                takeId,
            );
            db.prepare("INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('local_h3.queued',?,?,?)").run(
                jobId,
                JSON.stringify({
                    takeId,
                    projectId,
                    nodeId,
                    workflowSha256,
                    profile: parameters.resolution,
                    duration: parameters.duration,
                    referenceMode: parameters.referenceMode,
                    referenceCount: references.length,
                    chargeExpected: false,
                }),
                at,
            );
            row = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(jobId);
        });
        emit(row.job_id);
        return publicJob(db, row);
    }

    function cancelJob(jobId) {
        let result;
        transaction(db, () => {
            const row = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(jobId);
            if (!row) throw apiError(404, "local_h3_job_not_found", "H3 任务不存在");
            if (TERMINAL_STATES.has(row.state)) {
                result = publicJob(db, row);
                return;
            }
            const at = iso(now());
            if (row.state === "queued") {
                db.prepare("UPDATE local_worker_job SET state='cancelled',cancel_requested_at=?,error_code='local_h3_cancelled',updated_at=? WHERE job_id=?").run(at, at, jobId);
                db.prepare("UPDATE generation_task SET status='cancelled',error_code='local_h3_cancelled',last_provider_status='cancelled',updated_at=? WHERE provider=? AND task_id=?").run(
                    at,
                    LOCAL_H3_PROVIDER,
                    jobId,
                );
                db.prepare("UPDATE video_generation_take SET status='failed',error_code='local_h3_cancelled',updated_at=? WHERE take_id=?").run(at, row.take_id);
            } else {
                db.prepare("UPDATE local_worker_job SET cancel_requested_at=?,updated_at=? WHERE job_id=?").run(at, at, jobId);
            }
            db.prepare("INSERT INTO audit_event(kind,subject,detail,created_at) VALUES('local_h3.cancel_requested',?,?,?)").run(
                jobId,
                JSON.stringify({ immediate: row.state === "queued", chargeExpected: false }),
                at,
            );
            result = publicJob(db, db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(jobId));
        });
        emit(jobId);
        return result;
    }

    function status() {
        const onlineAfter = iso(now() - onlineTtlMs);
        const workers = db
            .prepare("SELECT worker_id,display_name,current_job_id,last_seen_at FROM local_worker WHERE status='active' AND last_seen_at IS NOT NULL AND last_seen_at>=? ORDER BY last_seen_at DESC")
            .all(onlineAfter);
        const active = Number(
            db.prepare("SELECT COUNT(*) AS count FROM local_worker_job WHERE state IN ('leased','compiling','submitted','running','rendered','uploading','verifying','recovery_pending')").get()
                ?.count || 0,
        );
        const queued = Number(db.prepare("SELECT COUNT(*) AS count FROM local_worker_job WHERE state='queued'").get()?.count || 0);
        return {
            available: workers.length > 0,
            workerOnline: workers.length > 0,
            busy: active > 0,
            active,
            queued,
            limits: { maxActive: 1, maxQueued },
            model: LOCAL_H3_MODEL,
            workflowId: LOCAL_H3_WORKFLOW_ID,
            workflowSha256,
            spec: LOCAL_H3_SPEC,
            profiles: LOCAL_H3_PROFILES,
            durations: LOCAL_H3_DURATIONS,
            workers: workers.map((worker) => ({ workerId: worker.worker_id, displayName: worker.display_name, busy: Boolean(worker.current_job_id), lastSeenAt: worker.last_seen_at })),
        };
    }

    function taskOverlay(jobId) {
        const row = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(jobId);
        if (!row) return undefined;
        const workerOnline = row.worker_id
            ? Boolean(db.prepare("SELECT 1 AS ok FROM local_worker WHERE worker_id=? AND status='active' AND last_seen_at>=?").get(row.worker_id, iso(now() - onlineTtlMs))?.ok)
            : status().workerOnline;
        return {
            state: row.state,
            ...(queuePosition(db, row) ? { queuePosition: queuePosition(db, row) } : {}),
            ...(row.progress !== null && row.progress !== undefined ? { progress: Number(row.progress) } : {}),
            cancelRequested: Boolean(row.cancel_requested_at),
            workerOnline,
            attempt: Number(row.attempt || 0),
            updatedAt: row.updated_at,
        };
    }

    function getJob(jobId) {
        return publicJob(db, db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(jobId));
    }

    function referenceObject(workerId, jobId, role) {
        const row = db.prepare("SELECT * FROM local_worker_job WHERE job_id=?").get(jobId);
        if (!row || row.worker_id !== workerId || !ACTIVE_STATES.has(row.state)) throw apiError(404, "local_h3_reference_not_found", "H3 参考图不存在");
        const reference = jobContract(row).references.find((item) => item.role === role);
        if (!reference) throw apiError(404, "local_h3_reference_not_found", "H3 参考图不存在");
        const file = objectPath(dataRoot, reference.hash);
        if (!existsSync(file) || statSync(file).size !== Number(reference.bytes)) throw apiError(409, "local_h3_reference_object_changed", "H3 参考图对象缺失或已变化");
        const bytes = readFileSync(file);
        if (sha256(bytes) !== reference.hash) throw apiError(409, "local_h3_reference_hash_mismatch", "H3 参考图哈希不匹配");
        return {
            status: 200,
            binary: bytes,
            headers: {
                "content-type": reference.mimeType,
                "content-length": String(bytes.length),
                "cache-control": "no-store",
                "x-content-type-options": "nosniff",
                "x-narralight-content-sha256": reference.hash,
            },
        };
    }

    async function handleWorkerRequest(req, url) {
        if (!url.pathname.startsWith("/api/local/worker/v1")) return null;
        secureTransport(req);
        const pairPath = url.pathname === "/api/local/worker/v1/pair";
        const isChunk = req.method === "PATCH" && /^\/api\/local\/worker\/v1\/uploads\/[^/]+$/.test(url.pathname);
        const body = await readBody(req, isChunk ? chunkSize : 128 * 1024);
        if (pairPath) {
            if (req.method !== "POST") throw apiError(405, "method_not_allowed", "只允许 POST");
            return { status: 201, body: pairWorker(json(body)) };
        }
        const workerId = assertWorkerSignature(req, body);
        if (req.method === "POST" && url.pathname === "/api/local/worker/v1/heartbeat") return { status: 200, body: heartbeat(workerId, json(body)) };
        if (req.method === "POST" && url.pathname === "/api/local/worker/v1/jobs/claim") {
            const job = claim(workerId);
            return job ? { status: 200, body: { job } } : { status: 204 };
        }
        const recoverJobMatch = /^\/api\/local\/worker\/v1\/jobs\/([^/]+)$/.exec(url.pathname);
        if (recoverJobMatch && req.method === "GET") return { status: 200, body: recoverWorkerJob(workerId, decodeURIComponent(recoverJobMatch[1])) };
        const referenceMatch = /^\/api\/local\/worker\/v1\/jobs\/([^/]+)\/references\/(first_frame|last_frame)$/.exec(url.pathname);
        if (referenceMatch && req.method === "GET") return referenceObject(workerId, decodeURIComponent(referenceMatch[1]), referenceMatch[2]);
        const leaseMatch = /^\/api\/local\/worker\/v1\/jobs\/([^/]+)\/lease$/.exec(url.pathname);
        if (leaseMatch && req.method === "POST") return { status: 200, body: renewLease(workerId, decodeURIComponent(leaseMatch[1]), json(body)) };
        const createUploadMatch = /^\/api\/local\/worker\/v1\/jobs\/([^/]+)\/uploads$/.exec(url.pathname);
        if (createUploadMatch && req.method === "POST") return { status: 201, body: createUpload(workerId, decodeURIComponent(createUploadMatch[1]), json(body)) };
        const terminalMatch = /^\/api\/local\/worker\/v1\/jobs\/([^/]+)\/terminal$/.exec(url.pathname);
        if (terminalMatch && req.method === "POST") return { status: 200, body: { job: terminal(workerId, decodeURIComponent(terminalMatch[1]), json(body)) } };
        const completeMatch = /^\/api\/local\/worker\/v1\/uploads\/([^/]+)\/complete$/.exec(url.pathname);
        if (completeMatch && req.method === "POST") return { status: 200, body: await completeUpload(workerId, decodeURIComponent(completeMatch[1]), json(body)) };
        const uploadMatch = /^\/api\/local\/worker\/v1\/uploads\/([^/]+)$/.exec(url.pathname);
        if (uploadMatch && req.method === "GET") return { status: 200, body: getUpload(workerId, decodeURIComponent(uploadMatch[1])) };
        if (uploadMatch && req.method === "PATCH") return { status: 200, body: patchUpload(workerId, decodeURIComponent(uploadMatch[1]), req, body) };
        throw apiError(404, "not_found", "接口不存在");
    }

    return {
        createPairingCode,
        revokeWorker,
        recoverWorkerJob,
        createJob,
        cancelJob,
        getJob,
        status,
        taskOverlay,
        handleWorkerRequest,
        constants: {
            provider: LOCAL_H3_PROVIDER,
            model: LOCAL_H3_MODEL,
            workflowId: LOCAL_H3_WORKFLOW_ID,
            workflowSha256,
            spec: LOCAL_H3_SPEC,
            profiles: LOCAL_H3_PROFILES,
            durations: LOCAL_H3_DURATIONS,
            maxQueued,
            maxActive: 1,
        },
    };
}
