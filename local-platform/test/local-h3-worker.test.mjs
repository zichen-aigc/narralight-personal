import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createLocalH3WorkerService, LOCAL_H3_MODEL, LOCAL_H3_PROVIDER, LOCAL_H3_WORKFLOW_SHA256, localH3CanonicalRequest } from "../src/local-h3-worker.mjs";

function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}

function database() {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(`
        CREATE TABLE generation_task(
            provider TEXT NOT NULL,task_id TEXT NOT NULL,media_kind TEXT NOT NULL,model TEXT NOT NULL,channel_id TEXT,
            project_id TEXT,node_id TEXT,status TEXT NOT NULL,result_index INTEGER,error_code TEXT,last_provider_status TEXT,
            last_checked_at TEXT,last_successful_check_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
            PRIMARY KEY(provider,task_id)
        );
        CREATE TABLE video_generation_take(
            take_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,node_id TEXT NOT NULL,status TEXT NOT NULL,provider TEXT,task_id TEXT,
            model TEXT,prompt TEXT NOT NULL DEFAULT '',params_json TEXT NOT NULL DEFAULT '{}',hash TEXT,mime_type TEXT,bytes INTEGER,
            duration_ms INTEGER,result_index INTEGER,error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
        );
        CREATE TABLE video_node_history(project_id TEXT NOT NULL,node_id TEXT NOT NULL,active_take_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(project_id,node_id));
        CREATE TABLE remote_result(provider TEXT NOT NULL,task_id TEXT NOT NULL,result_index INTEGER NOT NULL,media_kind TEXT NOT NULL,hash TEXT NOT NULL,mime_type TEXT NOT NULL,bytes INTEGER NOT NULL,source_url_hash TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(provider,task_id,result_index));
        CREATE TABLE audit_event(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,subject TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
    `);
    return db;
}

const parameters = {
    duration: 5,
    resolution: "864x480",
    aspectRatio: "16:9",
    generateAudio: true,
    referenceMode: "text_to_video",
    outputFormat: "mp4",
};

function insertTake(db, id, prompt = "一枚银色戒指在柔光下缓慢旋转", takeParameters = parameters) {
    const at = new Date().toISOString();
    db.prepare("INSERT INTO video_generation_take(take_id,project_id,node_id,status,model,prompt,params_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(
        id,
        "project-1",
        "node-1",
        "created",
        LOCAL_H3_MODEL,
        prompt,
        JSON.stringify(takeParameters),
        at,
        at,
    );
}

function request(method, url, body = Buffer.alloc(0), headers = {}) {
    const req = Readable.from(body.length ? [body] : []);
    req.method = method;
    req.url = url;
    req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    req.socket = { encrypted: true };
    return req;
}

function signedRequest(keys, workerId, method, url, body = Buffer.alloc(0), headers = {}, nonce = randomBytes(18).toString("base64url")) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const canonical = localH3CanonicalRequest({ workerId, timestamp, nonce, method, pathWithQuery: url, bodySha256Hex: sha256(body) });
    const signature = sign(null, Buffer.from(canonical, "utf8"), keys.privateKey).toString("base64");
    return request(method, url, body, {
        ...headers,
        "X-Narralight-Worker-Id": workerId,
        "X-Narralight-Worker-Timestamp": timestamp,
        "X-Narralight-Worker-Nonce": nonce,
        "X-Narralight-Worker-Signature": signature,
    });
}

async function pair(service, workerId, displayName = "H3 工作站") {
    const keys = generateKeyPairSync("ed25519");
    const pairing = service.createPairingCode();
    const payload = Buffer.from(
        JSON.stringify({
            pairingCode: pairing.pairingCode,
            workerId,
            displayName,
            publicKeySpkiDerBase64: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
            capabilities: { workflowSha256: LOCAL_H3_WORKFLOW_SHA256, maxActive: 1 },
        }),
    );
    const response = await service.handleWorkerRequest(request("POST", "/api/local/worker/v1/pair", payload), new URL("http://localhost/api/local/worker/v1/pair"));
    assert.equal(response.status, 201);
    return keys;
}

async function callSigned(service, keys, workerId, method, url, value, headers, nonce) {
    const body = Buffer.isBuffer(value) ? value : value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value));
    const req = signedRequest(keys, workerId, method, url, body, headers, nonce);
    return service.handleWorkerRequest(req, new URL(`http://localhost${url}`));
}

test("local H3 worker signing, atomic claim, chunk upload and finalize share one durable task", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "narralight-h3-worker-"));
    const db = database();
    t.after(() => {
        db.close();
        rmSync(root, { recursive: true, force: true });
    });
    const events = [];
    const service = createLocalH3WorkerService({
        db,
        dataRoot: root,
        allowInsecureTransport: true,
        broadcast: (type, event) => events.push({ type, event }),
        probeVideoFile: async () => ({
            formatNames: ["mov", "mp4"],
            codec: "h264",
            width: 864,
            height: 480,
            fps: 24,
            frameCount: 124,
            durationSeconds: 124 / 24,
            audio: { codec: "aac", sampleRate: 32000, channels: 2 },
        }),
    });
    const workerId = "worker_test-desktop";
    const keys = await pair(service, workerId);
    const secondKeys = await pair(service, "worker_spare-test", "备用工作站");

    insertTake(db, "take_12345678");
    const createBody = { takeId: "take_12345678", projectId: "project-1", nodeId: "node-1", promptOriginalZh: "一枚银色戒指在柔光下缓慢旋转", seed: 42, model: LOCAL_H3_MODEL, parameters };
    const created = service.createJob(createBody, "take_12345678");
    const replayed = service.createJob(createBody, "take_12345678");
    assert.equal(replayed.jobId, created.jobId);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM local_worker_job").get().count, 1);
    assert.throws(() => service.createJob({ ...createBody, seed: 43 }, "take_12345678"), /Idempotency-Key/);

    const heartbeatNonce = randomBytes(18).toString("base64url");
    const heartbeatBody = { capabilities: { workflowSha256: LOCAL_H3_WORKFLOW_SHA256, maxActive: 1 }, currentJobId: null };
    assert.equal((await callSigned(service, keys, workerId, "POST", "/api/local/worker/v1/heartbeat", heartbeatBody, {}, heartbeatNonce)).status, 200);
    await assert.rejects(
        () => callSigned(service, keys, workerId, "POST", "/api/local/worker/v1/heartbeat", heartbeatBody, {}, heartbeatNonce),
        (error) => error.code === "local_h3_nonce_replayed",
    );

    const claim = await callSigned(service, keys, workerId, "POST", "/api/local/worker/v1/jobs/claim?wait=25");
    assert.equal(claim.status, 200);
    assert.equal(claim.body.job.jobId, created.jobId);
    assert.equal(claim.body.job.promptOriginalZh, createBody.promptOriginalZh);
    assert.equal(claim.body.job.workflowSha256, LOCAL_H3_WORKFLOW_SHA256);
    assert.equal((await callSigned(service, secondKeys, "worker_spare-test", "POST", "/api/local/worker/v1/jobs/claim?wait=25")).status, 204);

    const leaseId = claim.body.job.leaseId;
    for (const [index, state] of ["compiling", "submitted", "running", "rendered"].entries()) {
        const response = await callSigned(service, keys, workerId, "POST", `/api/local/worker/v1/jobs/${created.jobId}/lease`, {
            leaseId,
            state,
            progress: (index + 1) / 5,
            eventId: `event-${index + 100}`,
            ...(state === "submitted" ? { comfyPromptId: "prompt-123", promptFinal: createBody.promptOriginalZh, compilerId: "zh-direct-v1" } : {}),
        });
        assert.equal(response.status, 200);
    }

    const output = Buffer.from("fake-mp4-with-audio-for-server-side-probe-contract");
    const outputHash = sha256(output);
    const upload = await callSigned(service, keys, workerId, "POST", `/api/local/worker/v1/jobs/${created.jobId}/uploads`, {
        leaseId,
        expectedBytes: output.length,
        sha256: outputHash,
        mimeType: "video/mp4",
    });
    assert.equal(upload.status, 201);
    const uploadId = upload.body.uploadId;
    const patch = await callSigned(service, keys, workerId, "PATCH", `/api/local/worker/v1/uploads/${uploadId}`, output, {
        "X-Narralight-Lease-Id": leaseId,
        "Content-Range": `bytes 0-${output.length - 1}/${output.length}`,
        "X-Chunk-SHA256": outputHash,
    });
    assert.equal(patch.body.complete, true);
    const replayPatch = await callSigned(service, keys, workerId, "PATCH", `/api/local/worker/v1/uploads/${uploadId}`, output, {
        "X-Narralight-Lease-Id": leaseId,
        "Content-Range": `bytes 0-${output.length - 1}/${output.length}`,
        "X-Chunk-SHA256": outputHash,
    });
    assert.equal(replayPatch.body.receivedBytes, output.length);

    const completed = await callSigned(service, keys, workerId, "POST", `/api/local/worker/v1/uploads/${uploadId}/complete`, { leaseId });
    assert.equal(completed.body.finalized, true);
    const recoveredTerminal = await callSigned(service, keys, workerId, "GET", `/api/local/worker/v1/jobs/${created.jobId}`);
    assert.equal(recoveredTerminal.body.job.state, "completed");
    assert.equal(recoveredTerminal.body.upload.state, "finalized");
    await assert.rejects(
        () => callSigned(service, secondKeys, "worker_spare-test", "GET", `/api/local/worker/v1/jobs/${created.jobId}`),
        (error) => error.code === "local_h3_job_not_found",
    );
    assert.deepEqual(readFileSync(join(root, "objects", outputHash.slice(0, 2), outputHash.slice(2, 4), outputHash)), output);
    const storedTask = db.prepare("SELECT status,result_index AS resultIndex FROM generation_task WHERE provider=? AND task_id=?").get(LOCAL_H3_PROVIDER, created.jobId);
    assert.equal(storedTask.status, "completed");
    assert.equal(storedTask.resultIndex, 0);
    const storedTake = db.prepare("SELECT status,hash,duration_ms AS durationMs FROM video_generation_take WHERE take_id=?").get(created.takeId);
    assert.equal(storedTake.status, "completed");
    assert.equal(storedTake.hash, outputHash);
    assert.equal(storedTake.durationMs, Math.round((124 / 24) * 1000));
    assert.equal(db.prepare("SELECT active_take_id AS activeTakeId FROM video_node_history WHERE project_id='project-1' AND node_id='node-1'").get().activeTakeId, created.takeId);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM remote_result WHERE provider=? AND task_id=?").get(LOCAL_H3_PROVIDER, created.jobId).count, 1);
    assert.equal(
        events.some((item) => item.type === "local-h3-job" && item.event.state === "completed"),
        true,
    );
});

test("allowlisted portrait first-frame jobs expose only the assigned content-addressed image", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "narralight-h3-reference-"));
    const db = database();
    t.after(() => {
        db.close();
        rmSync(root, { recursive: true, force: true });
    });
    const service = createLocalH3WorkerService({
        db,
        dataRoot: root,
        allowInsecureTransport: true,
        probeVideoFile: async () => {
            throw new Error("must not run");
        },
    });
    const workerId = "worker_reference-test";
    const keys = await pair(service, workerId);
    const image = Buffer.from("first-frame-image");
    const hash = sha256(image);
    const directory = join(root, "objects", hash.slice(0, 2), hash.slice(2, 4));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, hash), image);
    const profile = { duration: 10, resolution: "480x864", aspectRatio: "9:16", generateAudio: true, referenceMode: "first_frame", outputFormat: "mp4" };
    insertTake(db, "take_reference1", "首帧人物转身并说你好", profile);
    const created = service.createJob(
        {
            takeId: "take_reference1",
            projectId: "project-1",
            nodeId: "node-1",
            promptOriginalZh: "首帧人物转身并说你好",
            seed: 88,
            model: LOCAL_H3_MODEL,
            parameters: profile,
            references: [{ storageKey: `sha256:${hash}`, mimeType: "image/png", role: "first_frame" }],
        },
        "take_reference1",
    );
    const claim = await callSigned(service, keys, workerId, "POST", "/api/local/worker/v1/jobs/claim?wait=25");
    assert.equal(claim.body.job.jobId, created.jobId);
    assert.deepEqual(claim.body.job.spec, {
        width: 480,
        height: 864,
        frames: 243,
        fps: 24,
        videoCodec: "h264",
        audioCodec: "aac",
        audioSampleRate: 32000,
        audioChannels: 2,
        durationSeconds: 243 / 24,
    });
    assert.equal(claim.body.job.references[0].role, "first_frame");
    const downloaded = await callSigned(service, keys, workerId, "GET", `/api/local/worker/v1/jobs/${created.jobId}/references/first_frame`);
    assert.deepEqual(downloaded.binary, image);
    assert.equal(downloaded.headers["x-narralight-content-sha256"], hash);
});

test("expired leases are fenced until claim rotates both the job and upload lease", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "narralight-h3-expired-lease-"));
    const db = database();
    let clock = Date.now();
    t.after(() => {
        db.close();
        rmSync(root, { recursive: true, force: true });
    });
    const service = createLocalH3WorkerService({
        db,
        dataRoot: root,
        allowInsecureTransport: true,
        leaseMs: 30_000,
        now: () => clock,
        probeVideoFile: async () => {
            throw new Error("must not run");
        },
    });
    const workerId = "worker_expired-lease";
    const keys = await pair(service, workerId);
    insertTake(db, "take_expired1", "一只金色手镯在黑色丝绒上旋转");
    const job = service.createJob(
        { takeId: "take_expired1", projectId: "project-1", nodeId: "node-1", promptOriginalZh: "一只金色手镯在黑色丝绒上旋转", seed: 9, model: LOCAL_H3_MODEL, parameters },
        "take_expired1",
    );
    const claim = await callSigned(service, keys, workerId, "POST", "/api/local/worker/v1/jobs/claim?wait=25");
    const oldLeaseId = claim.body.job.leaseId;
    for (const [index, state] of ["compiling", "submitted", "running", "rendered"].entries()) {
        await callSigned(service, keys, workerId, "POST", `/api/local/worker/v1/jobs/${job.jobId}/lease`, {
            leaseId: oldLeaseId,
            state,
            eventId: `expired-event-${index}`,
            ...(state === "submitted" ? { comfyPromptId: "prompt-expired", promptFinal: "一只金色手镯在黑色丝绒上旋转", compilerId: "zh-direct-v1" } : {}),
        });
    }
    const output = Buffer.from("expired-lease-upload-contract");
    const outputHash = sha256(output);
    const upload = await callSigned(service, keys, workerId, "POST", `/api/local/worker/v1/jobs/${job.jobId}/uploads`, {
        leaseId: oldLeaseId,
        expectedBytes: output.length,
        sha256: outputHash,
        mimeType: "video/mp4",
    });
    clock += 31_000;

    await assert.rejects(
        () => callSigned(service, keys, workerId, "POST", `/api/local/worker/v1/jobs/${job.jobId}/lease`, { leaseId: oldLeaseId, state: "uploading", eventId: "expired-event-renew" }),
        (error) => error.code === "local_h3_lease_expired",
    );
    await assert.rejects(
        () =>
            callSigned(service, keys, workerId, "POST", `/api/local/worker/v1/jobs/${job.jobId}/uploads`, {
                leaseId: oldLeaseId,
                expectedBytes: output.length,
                sha256: outputHash,
                mimeType: "video/mp4",
            }),
        (error) => error.code === "local_h3_lease_expired",
    );
    await assert.rejects(
        () =>
            callSigned(service, keys, workerId, "PATCH", `/api/local/worker/v1/uploads/${upload.body.uploadId}`, output, {
                "X-Narralight-Lease-Id": oldLeaseId,
                "Content-Range": `bytes 0-${output.length - 1}/${output.length}`,
                "X-Chunk-SHA256": outputHash,
            }),
        (error) => error.code === "local_h3_lease_expired",
    );
    await assert.rejects(
        () =>
            callSigned(service, keys, workerId, "POST", `/api/local/worker/v1/jobs/${job.jobId}/terminal`, {
                leaseId: oldLeaseId,
                status: "failed",
                errorCode: "test",
                errorMessage: "must be fenced",
                retryable: false,
            }),
        (error) => error.code === "local_h3_lease_expired",
    );

    const recovered = await callSigned(service, keys, workerId, "POST", "/api/local/worker/v1/jobs/claim?wait=25");
    const newLeaseId = recovered.body.job.leaseId;
    assert.equal(recovered.body.job.state, "recovery_pending");
    assert.notEqual(newLeaseId, oldLeaseId);
    assert.equal(db.prepare("SELECT lease_id AS leaseId FROM local_worker_upload WHERE upload_id=?").get(upload.body.uploadId).leaseId, newLeaseId);
    await assert.rejects(
        () =>
            callSigned(service, keys, workerId, "PATCH", `/api/local/worker/v1/uploads/${upload.body.uploadId}`, output, {
                "X-Narralight-Lease-Id": oldLeaseId,
                "Content-Range": `bytes 0-${output.length - 1}/${output.length}`,
                "X-Chunk-SHA256": outputHash,
            }),
        (error) => error.code === "local_h3_lease_fenced",
    );
    const resumed = await callSigned(service, keys, workerId, "PATCH", `/api/local/worker/v1/uploads/${upload.body.uploadId}`, output, {
        "X-Narralight-Lease-Id": newLeaseId,
        "Content-Range": `bytes 0-${output.length - 1}/${output.length}`,
        "X-Chunk-SHA256": outputHash,
    });
    assert.equal(resumed.body.complete, true);
});

test("a paired worker can be revoked and only a fresh pairing can recover its job", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "narralight-h3-revoke-"));
    const db = database();
    t.after(() => {
        db.close();
        rmSync(root, { recursive: true, force: true });
    });
    const service = createLocalH3WorkerService({
        db,
        dataRoot: root,
        allowInsecureTransport: true,
        probeVideoFile: async () => {
            throw new Error("must not run");
        },
    });
    const workerId = "worker_revoke-test";
    const oldKeys = await pair(service, workerId);
    insertTake(db, "take_revoke01", "一条项链在镜面上缓慢移动");
    const job = service.createJob(
        { takeId: "take_revoke01", projectId: "project-1", nodeId: "node-1", promptOriginalZh: "一条项链在镜面上缓慢移动", seed: 11, model: LOCAL_H3_MODEL, parameters },
        "take_revoke01",
    );
    const claim = await callSigned(service, oldKeys, workerId, "POST", "/api/local/worker/v1/jobs/claim?wait=25");
    const oldLeaseId = claim.body.job.leaseId;
    await callSigned(service, oldKeys, workerId, "POST", `/api/local/worker/v1/jobs/${job.jobId}/lease`, {
        leaseId: oldLeaseId,
        state: "submitted",
        eventId: "revoke-event-submitted",
        comfyPromptId: "prompt-revoke",
        promptFinal: "一条项链在镜面上缓慢移动",
        compilerId: "zh-direct-v1",
    });

    assert.equal(service.revokeWorker(workerId).status, "revoked");
    assert.equal(db.prepare("SELECT state,worker_id AS workerId,lease_id AS leaseId FROM local_worker_job WHERE job_id=?").get(job.jobId).state, "recovery_pending");
    await assert.rejects(
        () => callSigned(service, oldKeys, workerId, "POST", "/api/local/worker/v1/heartbeat", { capabilities: { workflowSha256: LOCAL_H3_WORKFLOW_SHA256, maxActive: 1 }, currentJobId: job.jobId }),
        (error) => error.code === "local_h3_worker_unauthorized",
    );

    const newKeys = await pair(service, workerId, "H3 工作站（重新配对）");
    const recovered = await callSigned(service, newKeys, workerId, "POST", "/api/local/worker/v1/jobs/claim?wait=25");
    assert.equal(recovered.body.job.jobId, job.jobId);
    assert.equal(recovered.body.job.state, "recovery_pending");
    assert.notEqual(recovered.body.job.leaseId, oldLeaseId);
    await assert.rejects(
        () =>
            callSigned(service, oldKeys, workerId, "POST", `/api/local/worker/v1/jobs/${job.jobId}/terminal`, {
                leaseId: recovered.body.job.leaseId,
                status: "failed",
                errorCode: "old-key",
                errorMessage: "old key",
                retryable: false,
            }),
        (error) => error.code === "local_h3_signature_invalid",
    );
});

test("terminal replay is visible only to the worker that owns the terminal job", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "narralight-h3-terminal-owner-"));
    const db = database();
    t.after(() => {
        db.close();
        rmSync(root, { recursive: true, force: true });
    });
    const service = createLocalH3WorkerService({
        db,
        dataRoot: root,
        allowInsecureTransport: true,
        probeVideoFile: async () => {
            throw new Error("must not run");
        },
    });
    const ownerId = "worker_terminal-owner";
    const ownerKeys = await pair(service, ownerId, "终态任务工作站");
    const otherId = "worker_terminal-other";
    const otherKeys = await pair(service, otherId, "其他工作站");
    insertTake(db, "take_terminal1", "红宝石胸针在暗色背景前旋转");
    const job = service.createJob(
        { takeId: "take_terminal1", projectId: "project-1", nodeId: "node-1", promptOriginalZh: "红宝石胸针在暗色背景前旋转", seed: 13, model: LOCAL_H3_MODEL, parameters },
        "take_terminal1",
    );
    const claim = await callSigned(service, ownerKeys, ownerId, "POST", "/api/local/worker/v1/jobs/claim?wait=25");
    const terminalBody = { leaseId: claim.body.job.leaseId, status: "failed", errorCode: "local-test-failure", errorMessage: "test terminal replay ownership", retryable: false };
    const failed = await callSigned(service, ownerKeys, ownerId, "POST", `/api/local/worker/v1/jobs/${job.jobId}/terminal`, terminalBody);
    assert.equal(failed.body.job.state, "failed");
    const replay = await callSigned(service, ownerKeys, ownerId, "POST", `/api/local/worker/v1/jobs/${job.jobId}/terminal`, terminalBody);
    assert.equal(replay.body.job.state, "failed");
    await assert.rejects(
        () => callSigned(service, otherKeys, otherId, "POST", `/api/local/worker/v1/jobs/${job.jobId}/terminal`, { ...terminalBody, leaseId: "lease_not-the-owner" }),
        (error) => error.code === "local_h3_job_not_found",
    );
});

test("claim assignment survives a crash before the first lease event", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "narralight-h3-assignment-recovery-"));
    const db = database();
    let clock = Date.now();
    t.after(() => {
        db.close();
        rmSync(root, { recursive: true, force: true });
    });
    const options = {
        db,
        dataRoot: root,
        allowInsecureTransport: true,
        leaseMs: 30_000,
        now: () => clock,
        probeVideoFile: async () => {
            throw new Error("must not run");
        },
    };
    let service = createLocalH3WorkerService(options);
    const workerId = "worker_claim-crash";
    const keys = await pair(service, workerId, "领取即崩溃工作站");
    insertTake(db, "take_claimcrash", "祖母绿吊坠悬浮在柔光中");
    const job = service.createJob(
        { takeId: "take_claimcrash", projectId: "project-1", nodeId: "node-1", promptOriginalZh: "祖母绿吊坠悬浮在柔光中", seed: 17, model: LOCAL_H3_MODEL, parameters },
        "take_claimcrash",
    );
    const claim = await callSigned(service, keys, workerId, "POST", "/api/local/worker/v1/jobs/claim?wait=25");
    assert.equal(claim.body.job.jobId, job.jobId);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM local_worker_event WHERE job_id=?").get(job.jobId).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM local_worker_assignment WHERE job_id=? AND worker_id=?").get(job.jobId, workerId).count, 1);

    clock += 31_000;
    service = createLocalH3WorkerService(options);
    assert.equal(db.prepare("SELECT worker_id AS workerId,state FROM local_worker_job WHERE job_id=?").get(job.jobId).workerId, null);
    const recovered = await callSigned(service, keys, workerId, "GET", `/api/local/worker/v1/jobs/${job.jobId}`);
    assert.equal(recovered.body.job.jobId, job.jobId);
    assert.equal(recovered.body.job.state, "queued");
});

test("queued cancellation is terminal locally and never creates a provider submission", (t) => {
    const root = mkdtempSync(join(tmpdir(), "narralight-h3-cancel-"));
    const db = database();
    t.after(() => {
        db.close();
        rmSync(root, { recursive: true, force: true });
    });
    const service = createLocalH3WorkerService({
        db,
        dataRoot: root,
        allowInsecureTransport: true,
        probeVideoFile: async () => {
            throw new Error("must not run");
        },
    });
    insertTake(db, "take_abcdefgh", "珍珠耳环悬浮在黑色背景前");
    const job = service.createJob(
        { takeId: "take_abcdefgh", projectId: "project-1", nodeId: "node-1", promptOriginalZh: "珍珠耳环悬浮在黑色背景前", seed: 7, model: LOCAL_H3_MODEL, parameters },
        "take_abcdefgh",
    );
    const cancelled = service.cancelJob(job.jobId);
    assert.equal(cancelled.state, "cancelled");
    assert.equal(db.prepare("SELECT status FROM generation_task WHERE provider=? AND task_id=?").get(LOCAL_H3_PROVIDER, job.jobId).status, "cancelled");
    assert.equal(db.prepare("SELECT status,error_code AS errorCode FROM video_generation_take WHERE take_id=?").get(job.takeId).errorCode, "local_h3_cancelled");
    assert.equal(JSON.parse(db.prepare("SELECT detail FROM audit_event WHERE kind='local_h3.cancel_requested' AND subject=?").get(job.jobId).detail).chargeExpected, false);
});

test("personal plaintext exemption uses the socket peer, not a forged Host header", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "narralight-h3-loopback-"));
    const db = database();
    t.after(() => {
        db.close();
        rmSync(root, { recursive: true, force: true });
    });
    const service = createLocalH3WorkerService({
        db,
        dataRoot: root,
        allowInsecureLoopback: true,
        probeVideoFile: async () => {
            throw new Error("not used");
        },
    });
    for (const remoteAddress of ["192.0.2.1", undefined]) {
        const req = request("POST", "/api/local/worker/v1/pair", Buffer.from("{}"), { Host: "127.0.0.1" });
        req.socket = { remoteAddress };
        await assert.rejects(
            () => service.handleWorkerRequest(req, new URL("http://127.0.0.1/api/local/worker/v1/pair")),
            (error) => error.code === "local_h3_https_required",
        );
    }
});
