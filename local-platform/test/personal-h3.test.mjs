import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createLocalPlatformServer } from "../src/server.mjs";
import { LOCAL_H3_WORKFLOW_SHA256 } from "../src/local-h3-worker.mjs";
import { loadConfig } from "../../local-h3-worker/src/config.mjs";
import { loadPrivateKey } from "../../local-h3-worker/src/crypto-auth.mjs";
import { NarralightWorkerClient } from "../../local-h3-worker/src/server-client.mjs";

async function fixture(t, options = {}) {
    const dataRoot = await mkdtemp(join(tmpdir(), "narralight-personal-h3-"));
    const instance = createLocalPlatformServer({
        dataRoot,
        deploymentProfile: "personal_local",
        instanceKind: "standard",
        providerReconcileIntervalMs: 0,
        volcAssetRemoteIntegrationEnabled: false,
        volcAssetRelayManager: { available: () => false, stopAll() {} },
        ...options,
    });
    await new Promise((done) => instance.server.listen(0, "127.0.0.1", done));
    t.after(async () => {
        await new Promise((done) => instance.server.close(done));
        await rm(dataRoot, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const request = (path, method = "GET", body, headers = {}) =>
        fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    return { ...instance, base, request, dataRoot };
}

test("personal HTTP service pairs real DPAPI worker, verifies signatures, queues, claims and cancels", { skip: process.platform !== "win32" }, async (t) => {
    const f = await fixture(t);
    const request = f.request;
    const configFile = join(f.dataRoot, "worker-config.json");
    const example = JSON.parse(await readFile(new URL("../../local-h3-worker/config.example.json", import.meta.url), "utf8"));
    example.serverBaseUrl = f.base;
    example.workflowPath = fileURLToPath(new URL("../../local-h3-worker/workflow/h3-base-4070-api.json", import.meta.url));
    await writeFile(configFile, JSON.stringify(example));
    const script = new URL("../../local-h3-worker/scripts/pair-personal.mjs", import.meta.url);
    await promisify(execFile)(process.execPath, [fileURLToPath(script), configFile], { windowsHide: true });
    const config = await loadConfig(configFile);
    assert.ok(config.workerId);
    const client = new NarralightWorkerClient({ baseUrl: f.base, workerId: config.workerId, privateKeyPem: await loadPrivateKey(config), requestTimeoutMs: 10000 });
    await client.heartbeat({ workflowSha256: LOCAL_H3_WORKFLOW_SHA256 });
    assert.equal((await (await request("/api/local/h3/status")).json()).workerOnline, true);
    const unsigned = await request("/api/local/worker/v1/heartbeat", "POST", {});
    assert.ok([400, 401].includes(unsigned.status));
    assert.equal((await request("/api/local/h3/workers/pairing-codes", "POST", {}, { origin: "https://example.org" })).status, 403);
    assert.equal((await request("/api/local/h3/workers/pairing-codes", "POST", {}, { origin: "http://127.0.0.1:3000" })).status, 409);
    const parameters = { duration: 5, resolution: "864x480", aspectRatio: "16:9", generateAudio: true, referenceMode: "text_to_video", outputFormat: "mp4" };
    const takeResponse = await request("/api/local/video-generation-takes", "POST", { projectId: "project-test", nodeId: "node-test", model: "local-h3-base", prompt: "A spoon falls.", parameters });
    assert.equal(takeResponse.status, 201);
    const take = await takeResponse.json();
    const body = { takeId: take.takeId, projectId: "project-test", nodeId: "node-test", model: "local-h3-base", promptOriginalZh: "A spoon falls.", seed: 42, parameters, references: [] };
    const headers = { "idempotency-key": take.takeId };
    const created = await request("/api/local/h3/jobs", "POST", body, headers);
    assert.equal(created.status, 201);
    const { job } = await created.json();
    assert.equal((await (await request("/api/local/h3/jobs", "POST", body, headers)).json()).job.jobId, job.jobId);
    assert.equal((await request("/api/local/h3/jobs", "POST", { ...body, seed: 43 }, headers)).status, 409);
    const claimed = await client.claim(0);
    assert.equal(claimed.jobId, job.jobId);
    assert.equal((await request(`/api/local/h3/jobs/${job.jobId}/cancel`, "POST", {})).status, 200);
    const heartbeat = await client.heartbeat({ workflowSha256: LOCAL_H3_WORKFLOW_SHA256, currentJobId: job.jobId });
    assert.equal(heartbeat.cancelRequested, true);
    assert.equal((await request(`/api/local/h3/workers/${config.workerId}/revoke`, "POST", {})).status, 200);
    await assert.rejects(
        () => client.heartbeat({ workflowSha256: LOCAL_H3_WORKFLOW_SHA256 }),
        (error) => error.status === 401,
    );
});

test("unsupported deployment profiles are rejected", () => {
    assert.throws(() => createLocalPlatformServer({ deploymentProfile: "unsupported-profile" }), /配置/);
});
