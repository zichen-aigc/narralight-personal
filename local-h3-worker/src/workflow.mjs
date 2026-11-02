import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ALLOWED_DURATIONS, ALLOWED_PROFILES, FIXED_SPEC } from "./constants.mjs";
import { WorkerError } from "./errors.mjs";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new WorkerError("workflow_contract_invalid", `${label} must remain ${JSON.stringify(expected)}`);
  }
}

function validateTemplate(template) {
  const classes = {
    "1": "UNETLoader",
    "2": "CLIPLoader",
    "3": "VAELoader",
    "4": "VAELoader",
    "5": "MiniMaxH3ImageToVideo",
    "6": "RandomNoise",
    "7": "BasicGuider",
    "8": "KSamplerSelect",
    "9": "BasicScheduler",
    "10": "SamplerCustomAdvanced",
    "11": "VAEDecode",
    "12": "VAEDecodeAudio",
    "13": "CreateVideo",
    "14": "SaveVideo",
  };
  for (const [nodeId, classType] of Object.entries(classes)) {
    expectEqual(template?.[nodeId]?.class_type, classType, `node ${nodeId} class_type`);
  }
  expectEqual(template[5].inputs.width, FIXED_SPEC.width, "width");
  expectEqual(template[5].inputs.height, FIXED_SPEC.height, "height");
  expectEqual(template[5].inputs.length, FIXED_SPEC.frames, "frame count");
  expectEqual(template[9].inputs.steps, 12, "sampling steps");
  expectEqual(template[9].inputs.scheduler, "simple", "scheduler");
  expectEqual(template[8].inputs.sampler_name, "res_multistep", "sampler");
  expectEqual(template[13].inputs.fps, FIXED_SPEC.fps, "fps");
  expectEqual(template[14].inputs.format, "mp4", "output format");
}

export async function loadWorkflowTemplate(workflowPath, expectedSha256) {
  const bytes = await readFile(workflowPath);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new WorkerError("workflow_hash_mismatch", `Workflow SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }
  let template;
  try {
    template = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new WorkerError("workflow_json_invalid", "Fixed workflow is not valid JSON", { cause: error });
  }
  validateTemplate(template);
  return { template, sha256: actualSha256 };
}

function normalizeSeed(seed) {
  if (seed === null || seed === undefined) {
    return Math.floor(Math.random() * 0xffff_ffff);
  }
  const parsed = Number(seed);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new WorkerError("seed_invalid", "Seed must be a non-negative safe integer");
  }
  return parsed;
}

function safeOutputPrefix(jobId, requestedPrefix) {
  const fallback = `video/narralight_h3/${String(jobId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  if (typeof requestedPrefix !== "string") return fallback;
  if (!/^video\/narralight_h3\/[a-zA-Z0-9_-]{1,96}$/.test(requestedPrefix) || requestedPrefix.includes("..")) {
    return fallback;
  }
  return requestedPrefix;
}

function allowedSpec(spec) {
  const profile = ALLOWED_PROFILES.find((item) => item.width === spec?.width && item.height === spec?.height);
  const duration = ALLOWED_DURATIONS.find((item) => item.frames === spec?.frames);
  if (!profile || !duration || spec.fps !== FIXED_SPEC.fps) throw new WorkerError("workflow_spec_not_allowed", "H3 workflow spec is not allowlisted");
  return { ...FIXED_SPEC, ...profile, ...duration, durationSeconds: duration.frames / FIXED_SPEC.fps };
}

function referenceInputs(references) {
  if (!Array.isArray(references) || references.length > 2) throw new WorkerError("workflow_references_invalid", "H3 workflow accepts at most two reference images");
  return references.map((reference, index) => {
    const role = index === 0 ? "first_frame" : "last_frame";
    const image = String(reference?.inputName || "");
    if (reference?.role !== role || !/^narralight_h3\/[a-zA-Z0-9_.-]{1,180}$/.test(image) || image.includes("..")) throw new WorkerError("workflow_reference_invalid", "H3 workflow reference input is invalid");
    return { role, image };
  });
}

export function buildWorkflow({ template, prompt, seed, jobId, outputPrefix, spec = FIXED_SPEC, references = [] }) {
  const selectedSpec = allowedSpec(spec);
  const selectedReferences = referenceInputs(references);
  const workflow = structuredClone(template);
  workflow[5].inputs.prompt = prompt;
  workflow[5].inputs.width = selectedSpec.width;
  workflow[5].inputs.height = selectedSpec.height;
  workflow[5].inputs.length = selectedSpec.frames;
  workflow[6].inputs.noise_seed = normalizeSeed(seed);
  workflow[14].inputs.filename_prefix = safeOutputPrefix(jobId, outputPrefix);
  selectedReferences.forEach((reference, index) => {
    const nodeId = String(15 + index);
    workflow[nodeId] = { class_type: "LoadImage", inputs: { image: reference.image } };
    workflow[5].inputs[reference.role] = [nodeId, 0];
  });
  expectEqual(workflow[5].inputs.width, selectedSpec.width, "width");
  expectEqual(workflow[5].inputs.height, selectedSpec.height, "height");
  expectEqual(workflow[5].inputs.length, selectedSpec.frames, "frame count");
  return {
    workflow,
    seed: workflow[6].inputs.noise_seed,
    outputPrefix: workflow[14].inputs.filename_prefix,
    spec: selectedSpec,
  };
}
