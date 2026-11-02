import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkflow, loadWorkflowTemplate } from "../src/workflow.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, "workflow/h3-base-4070-api.json");
const expectedHash = "3d177045457dc8191f4ad646c4b61fa4d8531c182c5f281d160a7a3f0055bb47";

test("fixed H3 workflow hash and locked contract are accepted", async () => {
  const { template, sha256 } = await loadWorkflowTemplate(workflowPath, expectedHash);
  assert.equal(sha256, expectedHash);
  const original = structuredClone(template);
  const built = buildWorkflow({ template, prompt: "中文提示词", seed: 42, jobId: "h3job-1", outputPrefix: "h3job-untrusted" });
  assert.equal(built.workflow[5].inputs.prompt, "中文提示词");
  assert.equal(built.workflow[6].inputs.noise_seed, 42);
  assert.equal(built.workflow[14].inputs.filename_prefix, "video/narralight_h3/h3job-1");
  assert.deepEqual(template, original, "template must not be mutated");
  built.workflow[5].inputs.prompt = original[5].inputs.prompt;
  built.workflow[6].inputs.noise_seed = original[6].inputs.noise_seed;
  built.workflow[14].inputs.filename_prefix = original[14].inputs.filename_prefix;
  assert.deepEqual(built.workflow, original, "only prompt, seed and output prefix may change");
});

test("wrong workflow hash is rejected before parsing or execution", async () => {
  await assert.rejects(() => loadWorkflowTemplate(workflowPath, "0".repeat(64)), { code: "workflow_hash_mismatch" });
});

test("allowlisted portrait, duration and first/last frames compile into fixed nodes", async () => {
  const { template } = await loadWorkflowTemplate(workflowPath, expectedHash);
  const built = buildWorkflow({
    template,
    prompt: "首尾帧测试",
    seed: 9,
    jobId: "h3job-profile",
    spec: { width: 480, height: 864, frames: 243, fps: 24 },
    references: [
      { role: "first_frame", inputName: "narralight_h3/job-first.png" },
      { role: "last_frame", inputName: "narralight_h3/job-last.webp" },
    ],
  });
  assert.equal(built.workflow[5].inputs.width, 480);
  assert.equal(built.workflow[5].inputs.height, 864);
  assert.equal(built.workflow[5].inputs.length, 243);
  assert.deepEqual(built.workflow[5].inputs.first_frame, ["15", 0]);
  assert.deepEqual(built.workflow[5].inputs.last_frame, ["16", 0]);
  assert.equal(built.workflow[15].class_type, "LoadImage");
  assert.equal(built.workflow[16].inputs.image, "narralight_h3/job-last.webp");
});
