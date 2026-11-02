import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ALLOWED_DURATIONS, ALLOWED_PROFILES, FIXED_SPEC, TERMINAL_STATES } from "./constants.mjs";
import { compilePrompt } from "./compiler.mjs";
import { WorkerError, errorSummary } from "./errors.mjs";
import { inspectMedia, readChunk } from "./media.mjs";
import { buildWorkflow } from "./workflow.mjs";

const SUBMITTED_STATES = new Set(["submission_intent", "submitted", "running", "rendered", "uploading", "verifying"]);

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error("Aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason || new Error("Aborted"));
    }, { once: true });
  });
}

function assertAllowedSpec(spec) {
  const profile = ALLOWED_PROFILES.find((item) => item.width === spec?.width && item.height === spec?.height);
  const duration = ALLOWED_DURATIONS.find((item) => item.frames === spec?.frames);
  if (!profile || !duration) throw new WorkerError("server_spec_not_allowed", "Server requested an H3 profile outside the local allowlist");
  const expected = {
    width: profile.width,
    height: profile.height,
    frames: duration.frames,
    fps: FIXED_SPEC.fps,
    videoCodec: FIXED_SPEC.videoCodec,
    audioCodec: FIXED_SPEC.audioCodec,
    audioSampleRate: FIXED_SPEC.audioSampleRate,
    audioChannels: FIXED_SPEC.audioChannels,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (spec?.[key] !== value) {
      throw new WorkerError("server_spec_not_allowed", `Server requested unsupported H3 spec field ${key}`);
    }
  }
  return { ...FIXED_SPEC, ...profile, ...duration, durationSeconds: duration.frames / FIXED_SPEC.fps };
}

function assertReferences(references) {
  if (!Array.isArray(references) || references.length > 2) throw new WorkerError("claim_references_invalid", "Server requested invalid H3 references");
  return references.map((reference, index) => {
    const role = index === 0 ? "first_frame" : "last_frame";
    if (reference?.role !== role || !/^[a-f0-9]{64}$/.test(String(reference.sha256 || "")) || !Number.isSafeInteger(reference.bytes) || reference.bytes <= 0 || reference.bytes > 25 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(reference.mimeType)) {
      throw new WorkerError("claim_reference_invalid", "Server requested an invalid H3 reference object");
    }
    return { role, sha256: reference.sha256, bytes: reference.bytes, mimeType: reference.mimeType };
  });
}

export function validateClaim(job, workflowSha256) {
  if (!job || typeof job !== "object") throw new WorkerError("claim_invalid", "Server claim did not include a job");
  for (const field of ["jobId", "leaseId", "workflowId", "workflowSha256", "promptOriginalZh"]) {
    if (typeof job[field] !== "string" || !job[field]) throw new WorkerError("claim_invalid", `Claim field ${field} is required`);
  }
  if (job.workflowId !== "h3-base-4070-v2") throw new WorkerError("workflow_id_not_allowed", `Unsupported workflowId: ${job.workflowId}`);
  if (job.workflowSha256 !== workflowSha256) throw new WorkerError("workflow_hash_not_allowed", "Server job workflow hash does not match the local allowlist");
  const spec = assertAllowedSpec(job.spec);
  const references = assertReferences(job.references || []);
  const expectedMode = references.length === 2 ? "first_last_frame" : references.length === 1 ? "first_frame" : "text_to_video";
  if (job.parameters?.referenceMode !== expectedMode || job.parameters?.resolution !== `${spec.width}x${spec.height}` || Number(job.parameters?.duration) !== (spec.frames === 124 ? 5 : 10)) throw new WorkerError("claim_parameters_invalid", "Server H3 parameters do not match the claimed spec and references");
  return job;
}

function recordContract(record) {
  try {
    const contract = JSON.parse(record.contract_json || "{}");
    return { spec: assertAllowedSpec(contract.spec), references: assertReferences(contract.references || []), parameters: contract.parameters || {} };
  } catch (error) {
    if (error instanceof WorkerError) throw error;
    throw new WorkerError("ledger_contract_invalid", "Persisted H3 job contract is invalid", { cause: error, uncertain: true });
  }
}

function safeJobFilename(jobId) {
  return `${String(jobId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100)}.mp4`;
}

export class H3Worker {
  constructor({ config, ledger, server, comfy, workflowTemplate, logger }) {
    this.config = config;
    this.ledger = ledger;
    this.server = server;
    this.comfy = comfy;
    this.workflowTemplate = workflowTemplate;
    this.logger = logger;
    this.lastLeaseAt = 0;
  }

  async runForever(signal) {
    await mkdir(this.config.spoolDir, { recursive: true });
    await this.comfy.health();
    while (!signal?.aborted) {
      try {
        const open = this.ledger.assertSingleActive();
        if (open) {
          this.logger.warn("worker_recovering_job", { jobId: open.job_id, state: open.state });
          await this.reclaimAndResume(open, signal);
          continue;
        }
        await this.server.heartbeat({ workflowSha256: this.config.workflowSha256, currentJobId: null });
        const claim = await this.server.claim(this.config.claimWaitSeconds);
        if (!claim) {
          await sleep(this.config.idleDelayMs, signal);
          continue;
        }
        validateClaim(claim, this.config.workflowSha256);
        const record = this.ledger.saveClaim(claim);
        this.logger.info("job_claimed", { jobId: claim.jobId });
        await this.process(record, claim, signal);
      } catch (error) {
        const summary = errorSummary(error);
        if (!summary.retryable || signal?.aborted) throw error;
        this.logger.warn("worker_retrying", { errorCode: summary.code });
        await sleep(this.config.idleDelayMs, signal);
      }
    }
  }

  async reclaimAndResume(record, signal) {
    const recovery = await this.server.getWorkerJob(record.job_id);
    const serverJob = recovery?.job;
    if (!serverJob || serverJob.jobId !== record.job_id || typeof serverJob.state !== "string") {
      return this.freeze(record, "server_job_recovery_invalid", "Server returned invalid recovery state for the unfinished local job");
    }
    if (TERMINAL_STATES.has(serverJob.state)) {
      const closed = this.ledger.transition(record.job_id, record.state, serverJob.state, {
        error_code: serverJob.errorCode || null,
        error_message: null,
      });
      this.logger.info("job_reconciled_terminal", { jobId: record.job_id, state: closed.state });
      return recovery;
    }
    if (recovery.upload) {
      if (record.upload_id && recovery.upload.uploadId !== record.upload_id) {
        return this.freeze(record, "server_upload_recovery_mismatch", "Server returned a different upload for the unfinished local job");
      }
      const receivedBytes = Number(recovery.upload.receivedBytes);
      if (!recovery.upload.uploadId || !Number.isSafeInteger(receivedBytes) || receivedBytes < 0) {
        return this.freeze(record, "server_upload_recovery_invalid", "Server returned invalid upload recovery state");
      }
      record = this.ledger.update(record.job_id, record.state, {
        upload_id: recovery.upload.uploadId,
        uploaded_bytes: receivedBytes,
      });
    }
    const claim = await this.server.claim(this.config.claimWaitSeconds);
    if (!claim) {
      return this.freeze(record, "server_job_reclaim_missing", "Server did not return the unfinished local job during recovery");
    }
    validateClaim(claim, this.config.workflowSha256);
    if (claim.jobId !== record.job_id) {
      return this.freeze(record, "server_job_reclaim_mismatch", "Server returned a different job while the local ledger is unfinished");
    }
    const reclaimed = this.ledger.saveClaim(claim);
    if (reclaimed.lease_id !== claim.leaseId) {
      throw new WorkerError("ledger_lease_refresh_failed", "Fresh server lease was not persisted before recovery", { uncertain: true });
    }
    return this.resume(reclaimed, signal);
  }

  async resume(record, signal) {
    if (record.state === "recovery_pending") {
      throw new WorkerError("manual_reconciliation_required", `Job ${record.job_id} is frozen for manual reconciliation`);
    }
    if (["claimed", "compiling"].includes(record.state)) {
      return this.process(record, null, signal);
    }
    if (["submission_intent", "submitted", "running"].includes(record.state)) {
      const comfyJob = await this.comfy.getJob(record.comfy_prompt_id);
      if (!comfyJob) return this.freeze(record, "comfy_job_missing_after_restart", "Comfy job could not be proven after restart");
      if (record.state === "submission_intent") {
        record = this.ledger.transition(record.job_id, "submission_intent", "submitted");
      }
      return this.waitForComfy(record, comfyJob, signal);
    }
    if (["rendered", "uploading", "verifying"].includes(record.state)) {
      return this.finishMedia(record, null, signal);
    }
    throw new WorkerError("ledger_state_unknown", `Unsupported recovery state: ${record.state}`);
  }

  async process(record, claim, signal) {
    try {
      const contract = claim ? { spec: assertAllowedSpec(claim.spec), references: assertReferences(claim.references || []), parameters: claim.parameters || {} } : recordContract(record);
      const compiler = compilePrompt(record.prompt_original);
      record = this.ledger.transition(record.job_id, ["claimed", "compiling"], "compiling", {
        prompt_final: compiler.executionPrompt,
        compiler_id: compiler.compilerId,
      });
      const lease = await this.renew(record, "compiling", {
        promptFinal: compiler.executionPrompt,
        compilerId: compiler.compilerId,
      });
      if (lease?.cancelRequested) return this.cancel(record);

      const workflowReferences = [];
      for (const reference of contract.references) {
        const bytes = await this.server.downloadReference(record.job_id, reference.role);
        if (!Buffer.isBuffer(bytes) || bytes.length !== reference.bytes || createHash("sha256").update(bytes).digest("hex") !== reference.sha256) throw new WorkerError("reference_download_mismatch", "Downloaded H3 reference failed its content hash contract");
        const extension = reference.mimeType === "image/jpeg" ? "jpg" : reference.mimeType === "image/webp" ? "webp" : "png";
        const uploaded = await this.comfy.uploadImage({ bytes, filename: `${String(record.job_id).replace(/[^a-zA-Z0-9_-]/g, "_")}-${reference.role}.${extension}`, mimeType: reference.mimeType });
        workflowReferences.push({ role: reference.role, inputName: uploaded.inputName });
      }
      const built = buildWorkflow({
        template: this.workflowTemplate,
        prompt: compiler.executionPrompt,
        seed: record.seed,
        jobId: record.job_id,
        outputPrefix: claim?.outputPrefix,
        spec: contract.spec,
        references: workflowReferences,
      });
      const promptId = randomUUID();
      record = this.ledger.transition(record.job_id, "compiling", "submission_intent", {
        comfy_prompt_id: promptId,
        seed: built.seed,
      });
      const preexisting = await this.comfy.getJob(promptId);
      if (preexisting) {
        throw new WorkerError("comfy_prompt_id_collision", "Precommitted Comfy prompt ID already exists", { uncertain: true });
      }
      const submissionLease = await this.renew(record, "submitted", { comfyPromptId: promptId });
      // This process has just proved the precommitted prompt ID does not exist
      // and has not called /prompt yet. A cancellation at this exact boundary
      // is therefore safe to close without asking ComfyUI to cancel an unknown
      // ID. A recovered submission_intent does not have this proof and remains
      // on the conservative resume/freeze path above.
      if (submissionLease?.cancelRequested) {
        return this.terminal(record, "cancelled", "cancel_requested", "Generation cancelled before local submission", false);
      }
      try {
        await this.comfy.submit({
          promptId,
          workflow: built.workflow,
          workflowSha256: this.config.workflowSha256,
          serverJobId: record.job_id,
        });
      } catch (error) {
        if (error.code === "comfy_prompt_rejected") throw error;
        const observed = await this.comfy.getJob(promptId).catch(() => null);
        if (!observed) return this.freeze(record, "comfy_submission_uncertain", "Comfy submission outcome is unknown; automatic resubmission is disabled");
      }
      record = this.ledger.transition(record.job_id, "submission_intent", "submitted");
      return this.waitForComfy(record, null, signal);
    } catch (error) {
      return this.handleFailure(record.job_id, error);
    }
  }

  async waitForComfy(record, initialJob, signal) {
    let comfyJob = initialJob;
    try {
      while (!signal?.aborted) {
        const now = Date.now();
        if (now - this.lastLeaseAt >= this.config.leaseRenewMs) {
          const lease = await this.renew(record, "running", { comfyPromptId: record.comfy_prompt_id });
          if (lease?.cancelRequested) return this.cancel(record);
          this.lastLeaseAt = now;
        }
        comfyJob ||= await this.comfy.getJob(record.comfy_prompt_id);
        if (!comfyJob) return this.freeze(record, "comfy_job_disappeared", "Submitted Comfy job is no longer present");
        if (["pending", "in_progress"].includes(comfyJob.status)) {
          if (record.state !== "running") record = this.ledger.transition(record.job_id, ["submitted", "running"], "running");
          comfyJob = null;
          await sleep(this.config.comfyPollMs, signal);
          continue;
        }
        if (comfyJob.status === "completed") {
          record = this.ledger.transition(record.job_id, ["submitted", "running"], "rendered");
          await this.renew(record, "rendered", { progress: 1, comfyPromptId: record.comfy_prompt_id });
          return this.finishMedia(record, comfyJob, signal);
        }
        if (comfyJob.status === "cancelled") return this.terminal(record, "cancelled", "comfy_cancelled", "ComfyUI cancelled the job", false);
        if (comfyJob.status === "failed") {
          return this.terminal(record, "failed", "comfy_execution_failed", "ComfyUI failed to generate the video", false);
        }
        throw new WorkerError("comfy_status_unknown", `Unknown Comfy job status: ${comfyJob.status}`, { uncertain: true });
      }
    } catch (error) {
      return this.handleFailure(record.job_id, error);
    }
  }

  async finishMedia(record, knownComfyJob, signal) {
    try {
      let mediaPath = record.output_path;
      if (mediaPath) {
        try { await access(mediaPath); } catch { mediaPath = null; }
      }
      if (!mediaPath) {
        const comfyJob = knownComfyJob || await this.comfy.getJob(record.comfy_prompt_id);
        if (!comfyJob || comfyJob.status !== "completed") return this.freeze(record, "comfy_result_unavailable", "Completed Comfy output could not be recovered");
        mediaPath = path.join(this.config.spoolDir, safeJobFilename(record.job_id));
        await this.comfy.downloadOutput(comfyJob, mediaPath);
      }
      const inspected = await inspectMedia(mediaPath, this.config.ffprobePath, recordContract(record).spec);
      if (record.state === "rendered") {
        record = this.ledger.transition(record.job_id, "rendered", "uploading", {
          output_path: mediaPath,
          output_sha256: inspected.sha256,
          output_bytes: inspected.bytes,
        });
      } else if (["uploading", "verifying"].includes(record.state)) {
        record = this.ledger.update(record.job_id, record.state, {
          output_path: mediaPath,
          output_sha256: inspected.sha256,
          output_bytes: inspected.bytes,
        });
      }
      if (record.state === "verifying") {
        return this.finalizeUpload(record, inspected);
      }
      await this.renew(record, "uploading", { progress: 0 });
      let uploadId = record.upload_id;
      let receivedBytes = Number(record.uploaded_bytes || 0);
      let chunkSize = this.config.uploadChunkBytes;
      if (!uploadId) {
        const upload = await this.server.beginUpload(record.job_id, {
          leaseId: record.lease_id,
          expectedBytes: inspected.bytes,
          sha256: inspected.sha256,
          mimeType: inspected.mimeType,
        });
        uploadId = upload.uploadId;
        receivedBytes = Number(upload.receivedBytes || 0);
        chunkSize = Math.min(Number(upload.chunkSize || chunkSize), this.config.uploadChunkBytes);
        record = this.ledger.update(record.job_id, ["uploading", "verifying"], { upload_id: uploadId, uploaded_bytes: receivedBytes });
      } else {
        const upload = await this.server.getUpload(uploadId);
        receivedBytes = Number(upload.receivedBytes || 0);
        chunkSize = Math.min(Number(upload.chunkSize || chunkSize), this.config.uploadChunkBytes);
      }
      if (!Number.isSafeInteger(receivedBytes) || receivedBytes < 0 || receivedBytes > inspected.bytes) {
        throw new WorkerError("upload_offset_invalid", "Server returned an invalid upload offset", { uncertain: true });
      }
      while (receivedBytes < inspected.bytes) {
        if (signal?.aborted) throw signal.reason || new Error("Aborted");
        const chunk = await readChunk(mediaPath, receivedBytes, Math.min(chunkSize, inspected.bytes - receivedBytes));
        if (!chunk.length) throw new WorkerError("upload_read_empty", "Worker could not read the next media chunk");
        const end = receivedBytes + chunk.length - 1;
        const response = await this.server.uploadChunk(uploadId, {
          leaseId: record.lease_id,
          chunk,
          start: receivedBytes,
          end,
          total: inspected.bytes,
        });
        receivedBytes = Number(response?.receivedBytes ?? end + 1);
        record = this.ledger.update(record.job_id, "uploading", { uploaded_bytes: receivedBytes });
        const lease = await this.renew(record, "uploading", { progress: receivedBytes / inspected.bytes });
        if (lease?.cancelRequested) return this.cancel(record);
      }
      if (record.state === "uploading") {
        record = this.ledger.transition(record.job_id, "uploading", "verifying");
      }
      await this.renew(record, "verifying", { progress: 1 });
      return this.finalizeUpload(record, inspected);
    } catch (error) {
      return this.handleFailure(record.job_id, error);
    }
  }

  async finalizeUpload(record, inspected) {
    const finalized = await this.server.completeUpload(record.upload_id, record.lease_id);
    if (finalized?.cancelled === true) {
      this.ledger.transition(record.job_id, "verifying", "cancelled", {
        error_code: "cancel_requested",
        error_message: "Generation cancelled by user",
      });
      this.logger.warn("job_terminal", { jobId: record.job_id, status: "cancelled", errorCode: "cancel_requested" });
      return finalized;
    }
    if (finalized?.finalized !== true) {
      throw new WorkerError("server_finalize_incomplete", "Server did not confirm finalized media", { uncertain: true });
    }
    this.ledger.transition(record.job_id, "verifying", "completed");
    this.logger.info("job_completed", { jobId: record.job_id, bytes: inspected.bytes, sha256: inspected.sha256 });
    return finalized;
  }

  async renew(record, state, extra = {}) {
    const eventId = randomUUID();
    const response = await this.server.renewLease(record.job_id, {
      leaseId: record.lease_id,
      state,
      eventId,
      ...extra,
    });
    this.ledger.addEvent(record.job_id, eventId, state);
    return response;
  }

  async cancel(record) {
    if (record.comfy_prompt_id) {
      let cancellation;
      try {
        cancellation = await this.comfy.cancel(record.comfy_prompt_id);
      } catch {
        return this.freeze(record, "comfy_cancel_request_uncertain", "ComfyUI cancellation could not be confirmed");
      }
      const deadline = Date.now() + (this.config.cancelConfirmTimeoutMs || 60_000);
      while (true) {
        let comfyJob;
        try {
          comfyJob = await this.comfy.getJob(record.comfy_prompt_id);
        } catch {
          return this.freeze(record, "comfy_cancel_status_uncertain", "ComfyUI cancellation status could not be confirmed");
        }
        const terminal = ["cancelled", "completed", "failed"].includes(comfyJob?.status);
        const removedFromQueue = cancellation?.cancelled === true && comfyJob === null;
        if (terminal || removedFromQueue) break;
        const stillRunning = ["pending", "in_progress"].includes(comfyJob?.status);
        if (cancellation?.cancelled !== true || !stillRunning || Date.now() >= deadline) {
          return this.freeze(record, "comfy_cancel_unconfirmed", "ComfyUI prompt is not in a confirmed terminal state");
        }
        await sleep(this.config.comfyPollMs || 2_000);
      }
    }
    return this.terminal(record, "cancelled", "cancel_requested", "Generation cancelled by user", false);
  }

  async terminal(record, status, errorCode, errorMessage, retryable) {
    await this.server.terminal(record.job_id, {
      leaseId: record.lease_id,
      status,
      errorCode,
      errorMessage,
      retryable,
    });
    this.ledger.transition(record.job_id, record.state, status, { error_code: errorCode, error_message: errorMessage });
    this.logger.warn("job_terminal", { jobId: record.job_id, status, errorCode });
  }

  async freeze(record, errorCode, errorMessage) {
    const current = this.ledger.get(record.job_id);
    if (current && current.state !== "recovery_pending") {
      this.ledger.transition(record.job_id, current.state, "recovery_pending", { error_code: errorCode, error_message: errorMessage });
    }
    try {
      await this.renew(this.ledger.get(record.job_id), "recovery_pending", { comfyPromptId: current?.comfy_prompt_id || undefined });
    } catch { /* best effort: local ledger remains authoritative for the freeze */ }
    throw new WorkerError("manual_reconciliation_required", errorMessage, { uncertain: true });
  }

  async handleFailure(jobId, error) {
    const record = this.ledger.get(jobId);
    if (!record) throw error;
    const summary = errorSummary(error);
    if (summary.retryable) throw error;
    const mustFreeze = summary.uncertain
      || summary.status === 409
      || SUBMITTED_STATES.has(record.state) && ["server_request_uncertain", "comfy_unreachable", "ledger_state_conflict"].includes(summary.code);
    if (mustFreeze) return this.freeze(record, summary.code, summary.message);
    try {
      await this.terminal(record, "failed", summary.code, summary.message, summary.retryable);
    } catch (terminalError) {
      return this.freeze(record, "terminal_report_uncertain", "Failed to confirm terminal state with the server");
    }
    return null;
  }
}
