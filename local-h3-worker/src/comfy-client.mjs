import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { WorkerError } from "./errors.mjs";

function findMp4Item(job) {
  const candidates = [];
  for (const [nodeId, output] of Object.entries(job?.outputs || {})) {
    if (!output || typeof output !== "object") continue;
    for (const [mediaType, items] of Object.entries(output)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (item && typeof item === "object" && typeof item.filename === "string" && item.filename.toLowerCase().endsWith(".mp4")) {
          candidates.push({ ...item, nodeId, mediaType });
        }
      }
    }
  }
  return candidates.find((item) => item.nodeId === "14") || candidates[0] || null;
}

export class ComfyClient {
  constructor({ baseUrl, fetchImpl = fetch, requestTimeoutMs = 35_000 }) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  url(pathname) {
    return new URL(pathname, `${this.baseUrl}/`);
  }

  async request(pathname, options = {}) {
    let response;
    try {
      response = await this.fetchImpl(this.url(pathname), {
        ...options,
        redirect: "error",
        signal: options.signal || AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new WorkerError("comfy_unreachable", "ComfyUI is not reachable on 127.0.0.1:8188", { cause: error, retryable: true });
    }
    return response;
  }

  async health() {
    const response = await this.request("/system_stats");
    if (!response.ok) throw new WorkerError("comfy_health_failed", `ComfyUI health returned HTTP ${response.status}`);
    return response.json();
  }

  async getJob(promptId) {
    const response = await this.request(`/api/jobs/${encodeURIComponent(promptId)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new WorkerError("comfy_job_query_failed", `ComfyUI job query returned HTTP ${response.status}`, { retryable: response.status >= 500 });
    return response.json();
  }

  async uploadImage({ bytes, filename, mimeType }) {
    const form = new FormData();
    form.set("image", new Blob([bytes], { type: mimeType }), filename);
    form.set("type", "input");
    form.set("subfolder", "narralight_h3");
    form.set("overwrite", "true");
    const response = await this.request("/upload/image", { method: "POST", body: form, signal: AbortSignal.timeout(2 * 60_000) });
    let result = null;
    try { result = await response.json(); } catch { /* handled below */ }
    if (!response.ok || !result?.name) throw new WorkerError("comfy_reference_upload_failed", `ComfyUI reference upload returned HTTP ${response.status}`);
    const subfolder = String(result.subfolder || "narralight_h3").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return { name: String(result.name), subfolder, type: result.type || "input", inputName: subfolder ? `${subfolder}/${result.name}` : String(result.name) };
  }

  async submit({ promptId, workflow, workflowSha256, serverJobId }) {
    const response = await this.request("/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: workflow,
        prompt_id: promptId,
        workflow_metadata: { workflow_id: "h3-base-4070-v2" },
        extra_data: {
          narralight_job_id: serverJobId,
          narralight_workflow_sha256: workflowSha256,
        },
      }),
    });
    let result = null;
    try { result = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      throw new WorkerError("comfy_prompt_rejected", result?.error?.message || `ComfyUI rejected workflow with HTTP ${response.status}`);
    }
    if (result?.prompt_id !== promptId) {
      throw new WorkerError("comfy_prompt_id_mismatch", "ComfyUI did not preserve the precommitted prompt ID", { uncertain: true });
    }
    return result;
  }

  async cancel(promptId) {
    const response = await this.request(`/api/jobs/${encodeURIComponent(promptId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new WorkerError("comfy_cancel_failed", `ComfyUI cancellation returned HTTP ${response.status}`);
    return response.json();
  }

  outputItem(job) {
    const item = findMp4Item(job);
    if (!item) throw new WorkerError("comfy_output_missing", "Completed ComfyUI job has no MP4 output");
    return item;
  }

  async downloadOutput(job, destinationPath) {
    const item = this.outputItem(job);
    const query = new URLSearchParams({
      filename: item.filename,
      type: item.type || "output",
    });
    if (item.subfolder) query.set("subfolder", item.subfolder);
    const response = await this.request(`/view?${query.toString()}`, { signal: AbortSignal.timeout(5 * 60_000) });
    if (!response.ok || !response.body) {
      throw new WorkerError("comfy_output_download_failed", `ComfyUI output download returned HTTP ${response.status}`);
    }
    await mkdir(path.dirname(destinationPath), { recursive: true });
    const partPath = `${destinationPath}.part`;
    await rm(partPath, { force: true });
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partPath, { flags: "wx" }));
      await rename(partPath, destinationPath);
    } catch (error) {
      await rm(partPath, { force: true });
      throw new WorkerError("comfy_output_write_failed", "Could not save ComfyUI output to the worker spool", { cause: error });
    }
    return { path: destinationPath, item };
  }
}

export { findMp4Item };
