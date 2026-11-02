import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WorkerError } from "../src/errors.mjs";
import { H3Worker, validateClaim } from "../src/worker.mjs";

const hash = "3d177045457dc8191f4ad646c4b61fa4d8531c182c5f281d160a7a3f0055bb47";
const claim = {
  jobId: "h3job-1",
  leaseId: "lease-1",
  workflowId: "h3-base-4070-v2",
  workflowSha256: hash,
  promptOriginalZh: "中文",
  spec: { width: 864, height: 480, frames: 124, fps: 24, videoCodec: "h264", audioCodec: "aac", audioSampleRate: 32000, audioChannels: 2 },
  parameters: { duration: 5, resolution: "864x480", aspectRatio: "16:9", referenceMode: "text_to_video" },
  references: [],
};

test("claim accepts only the fixed workflow hash and media spec", () => {
  assert.equal(validateClaim(claim, hash), claim);
  assert.throws(() => validateClaim({ ...claim, workflowSha256: "0".repeat(64) }, hash), { code: "workflow_hash_not_allowed" });
  assert.throws(() => validateClaim({ ...claim, spec: { ...claim.spec, width: 1920 } }, hash), { code: "server_spec_not_allowed" });
});

test("server records the precommitted Comfy ID before local submission", async () => {
  const events = [];
  const template = JSON.parse(await readFile(new URL("../workflow/h3-base-4070-api.json", import.meta.url), "utf8"));
  let current = {
    job_id: "h3job-12345678",
    lease_id: "lease_12345678",
    state: "claimed",
    workflow_sha256: hash,
    prompt_original: "一只杯子落地，发出清晰碰撞声",
    prompt_final: null,
    compiler_id: null,
    seed: 7,
    comfy_prompt_id: null,
  };
  const ledger = {
    transition(_jobId, _expected, state, patch = {}) {
      current = { ...current, ...patch, state };
      return current;
    },
    get() { return current; },
    addEvent() {},
  };
  const server = {
    async renewLease(_jobId, payload) {
      events.push(`lease:${payload.state}${payload.comfyPromptId ? ":with-id" : ""}`);
      return { cancelRequested: false };
    },
    async terminal() { events.push("terminal"); },
  };
  const comfy = {
    async getJob() { events.push("comfy:get"); return null; },
    async submit() {
      events.push("comfy:submit");
      throw new WorkerError("comfy_prompt_rejected", "known rejection");
    },
  };
  const logger = { info() {}, warn() {}, error() {} };
  const worker = new H3Worker({
    config: { workflowSha256: hash },
    ledger,
    server,
    comfy,
    workflowTemplate: template,
    logger,
  });

  await worker.process(current, { ...claim, outputPrefix: "h3job-12345678" });

  assert.ok(events.indexOf("lease:submitted:with-id") < events.indexOf("comfy:submit"));
  assert.deepEqual(events.slice(-2), ["comfy:submit", "terminal"]);
});

test("cancel requested after submission intent but before /prompt closes without touching Comfy", async () => {
  const events = [];
  const template = JSON.parse(await readFile(new URL("../workflow/h3-base-4070-api.json", import.meta.url), "utf8"));
  let current = {
    job_id: "h3job-12345678",
    lease_id: "lease_12345678",
    state: "claimed",
    workflow_sha256: hash,
    prompt_original: "一只杯子落地，发出清晰碰撞声",
    prompt_final: null,
    compiler_id: null,
    seed: 7,
    comfy_prompt_id: null,
  };
  const ledger = {
    transition(_jobId, _expected, state, patch = {}) {
      current = { ...current, ...patch, state };
      return current;
    },
    get() { return current; },
    addEvent() {},
  };
  const server = {
    async renewLease(_jobId, payload) {
      events.push(`lease:${payload.state}`);
      return { cancelRequested: payload.state === "submitted" };
    },
    async terminal(_jobId, payload) {
      events.push(`terminal:${payload.status}`);
    },
  };
  const comfy = {
    async getJob() { events.push("comfy:get"); return null; },
    async submit() { events.push("comfy:submit"); },
    async cancel() { events.push("comfy:cancel"); },
  };
  const worker = new H3Worker({
    config: { workflowSha256: hash },
    ledger,
    server,
    comfy,
    workflowTemplate: template,
    logger: { info() {}, warn() {}, error() {} },
  });

  await worker.process(current, { ...claim, outputPrefix: "h3job-12345678" });

  assert.deepEqual(events, ["lease:compiling", "comfy:get", "lease:submitted", "terminal:cancelled"]);
  assert.equal(current.state, "cancelled");
});

test("recovered submission intent with no Comfy evidence remains frozen", async () => {
  const record = {
    job_id: "h3job-1",
    lease_id: "lease_1",
    state: "submission_intent",
    comfy_prompt_id: "prompt-1",
  };
  const calls = [];
  const ledger = {
    get() { return record; },
    transition(_jobId, expected, state, patch = {}) {
      assert.equal(expected, record.state);
      Object.assign(record, patch, { state });
      return record;
    },
    addEvent() {},
  };
  const worker = new H3Worker({
    config: {},
    ledger,
    server: {
      async renewLease(_jobId, payload) { calls.push(`lease:${payload.state}`); return {}; },
    },
    comfy: {
      async getJob(promptId) { calls.push(`comfy:get:${promptId}`); return null; },
    },
    workflowTemplate: {},
    logger: { info() {}, warn() {}, error() {} },
  });

  await assert.rejects(() => worker.resume(record), { code: "manual_reconciliation_required" });

  assert.equal(record.state, "recovery_pending");
  assert.deepEqual(calls, ["comfy:get:prompt-1", "lease:recovery_pending"]);
});

test("verifying recovery goes straight to the idempotent finalize path", async () => {
  let renewals = 0;
  const worker = new H3Worker({
    config: {},
    ledger: {},
    server: { renewLease: async () => { renewals += 1; } },
    comfy: {},
    workflowTemplate: {},
    logger: { info() {}, warn() {}, error() {} },
  });
  worker.finishMedia = async () => "finalized";
  const result = await worker.resume({ job_id: "h3job-1", state: "verifying" });
  assert.equal(result, "finalized");
  assert.equal(renewals, 0);
});

test("cancellation targets only the active Comfy prompt and records terminal state", async () => {
  const calls = [];
  const record = {
    job_id: "h3job-1",
    lease_id: "lease_1",
    state: "running",
    comfy_prompt_id: "prompt-1",
  };
  const ledger = {
    transition(_jobId, expected, state) {
      assert.equal(expected, "running");
      record.state = state;
      return record;
    },
  };
  const worker = new H3Worker({
    config: {},
    ledger,
    server: { async terminal(_jobId, payload) { calls.push(["terminal", payload.status, payload.leaseId]); } },
    comfy: {
      async cancel(promptId) { calls.push(["cancel", promptId]); return { cancelled: true }; },
      async getJob() { return { status: "cancelled" }; },
    },
    workflowTemplate: {},
    logger: { info() {}, warn() {}, error() {} },
  });

  await worker.cancel(record);

  assert.deepEqual(calls, [["cancel", "prompt-1"], ["terminal", "cancelled", "lease_1"]]);
  assert.equal(record.state, "cancelled");
});

test("running cancellation waits for the same Comfy prompt to become terminal", async () => {
  const calls = [];
  let queries = 0;
  const record = {
    job_id: "h3job-1",
    lease_id: "lease_1",
    state: "running",
    comfy_prompt_id: "prompt-1",
  };
  const worker = new H3Worker({
    config: { comfyPollMs: 1, cancelConfirmTimeoutMs: 100 },
    ledger: {
      transition(_jobId, _expected, state) { record.state = state; return record; },
    },
    server: { async terminal() { calls.push("terminal"); } },
    comfy: {
      async cancel() { calls.push("cancel"); return { cancelled: true }; },
      async getJob() {
        queries += 1;
        return { status: queries === 1 ? "in_progress" : "cancelled" };
      },
    },
    workflowTemplate: {},
    logger: { info() {}, warn() {}, error() {} },
  });

  await worker.cancel(record);

  assert.equal(queries, 2);
  assert.deepEqual(calls, ["cancel", "terminal"]);
  assert.equal(record.state, "cancelled");
});

function cancellationFreezeHarness(comfy) {
  const calls = [];
  const record = {
    job_id: "h3job-1",
    lease_id: "lease_1",
    state: "running",
    comfy_prompt_id: "prompt-1",
  };
  const ledger = {
    get() { return record; },
    transition(_jobId, expected, state, patch = {}) {
      assert.equal(expected, record.state);
      Object.assign(record, patch, { state });
      return record;
    },
    addEvent() {},
  };
  const worker = new H3Worker({
    config: {},
    ledger,
    server: {
      async terminal() { calls.push("terminal"); },
      async renewLease(_jobId, payload) { calls.push(`lease:${payload.state}`); return {}; },
    },
    comfy,
    workflowTemplate: {},
    logger: { info() {}, warn() {}, error() {} },
  });
  return { worker, record, calls };
}

test("failed Comfy cancellation freezes the job and never reports cancelled", async () => {
  const harness = cancellationFreezeHarness({
    async cancel() { throw new WorkerError("comfy_unreachable", "offline", { retryable: true }); },
  });
  await assert.rejects(() => harness.worker.cancel(harness.record), { code: "manual_reconciliation_required" });
  assert.equal(harness.record.state, "recovery_pending");
  assert.deepEqual(harness.calls, ["lease:recovery_pending"]);
});

test("unknown Comfy cancellation result freezes without releasing the job", async () => {
  const harness = cancellationFreezeHarness({
    async cancel() { return { cancelled: false }; },
    async getJob() { return null; },
  });
  await assert.rejects(() => harness.worker.cancel(harness.record), { code: "manual_reconciliation_required" });
  assert.equal(harness.record.state, "recovery_pending");
  assert.deepEqual(harness.calls, ["lease:recovery_pending"]);
});

test("recovery persists a freshly claimed lease before resuming the old job", async () => {
  const record = {
    job_id: "h3job-1",
    lease_id: "lease_old",
    state: "uploading",
  };
  const freshClaim = {
    ...claim,
    jobId: record.job_id,
    leaseId: "lease_new",
  };
  const calls = [];
  const ledger = {
    saveClaim(job) {
      calls.push(`persist:${job.leaseId}`);
      record.lease_id = job.leaseId;
      return record;
    },
  };
  const worker = new H3Worker({
    config: { workflowSha256: hash, claimWaitSeconds: 25 },
    ledger,
    server: {
      async getWorkerJob(jobId) { calls.push(`recover:${jobId}`); return { job: { jobId, state: "uploading" } }; },
      async claim() { calls.push("claim"); return freshClaim; },
    },
    comfy: {},
    workflowTemplate: {},
    logger: { info() {}, warn() {}, error() {} },
  });
  worker.resume = async (resumed) => {
    calls.push(`resume:${resumed.lease_id}`);
    return "resumed";
  };

  assert.equal(await worker.reclaimAndResume(record), "resumed");
  assert.deepEqual(calls, ["recover:h3job-1", "claim", "persist:lease_new", "resume:lease_new"]);
});

test("server-finalized recovery closes the local ledger without claiming another queued job", async () => {
  const record = {
    job_id: "h3job-1",
    lease_id: "lease_old",
    state: "verifying",
  };
  let claims = 0;
  let resumed = false;
  const ledger = {
    transition(_jobId, expected, state) {
      assert.equal(expected, "verifying");
      record.state = state;
      return record;
    },
  };
  const worker = new H3Worker({
    config: { workflowSha256: hash, claimWaitSeconds: 25 },
    ledger,
    server: {
      async getWorkerJob() {
        return { job: { jobId: record.job_id, state: "completed" }, upload: { uploadId: "up-1", state: "finalized", receivedBytes: 10 } };
      },
      async claim() { claims += 1; return { ...claim, jobId: "h3job-queued" }; },
    },
    comfy: {},
    workflowTemplate: {},
    logger: { info() {}, warn() {}, error() {} },
  });
  worker.resume = async () => { resumed = true; };

  const result = await worker.reclaimAndResume(record);

  assert.equal(result.job.state, "completed");
  assert.equal(record.state, "completed");
  assert.equal(claims, 0);
  assert.equal(resumed, false);
});
