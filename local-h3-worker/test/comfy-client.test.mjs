import test from "node:test";
import assert from "node:assert/strict";
import { ComfyClient, findMp4Item } from "../src/comfy-client.mjs";

test("MP4 selection prefers fixed SaveVideo node 14", () => {
  const item = findMp4Item({ outputs: {
    "9": { video: [{ filename: "other.mp4", type: "output", subfolder: "" }] },
    "14": { video: [{ filename: "h3.mp4", type: "output", subfolder: "video" }] },
  } });
  assert.equal(item.filename, "h3.mp4");
  assert.equal(item.nodeId, "14");
});

test("Comfy submission supplies the precommitted UUID and provenance", async () => {
  let body;
  const client = new ComfyClient({
    baseUrl: "http://127.0.0.1:8188",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return Response.json({ prompt_id: body.prompt_id, number: 1, node_errors: {} });
    },
  });
  const promptId = "11111111-1111-4111-8111-111111111111";
  await client.submit({ promptId, workflow: { "1": {} }, workflowSha256: "a".repeat(64), serverJobId: "job-1" });
  assert.equal(body.prompt_id, promptId);
  assert.equal(body.extra_data.narralight_job_id, "job-1");
  assert.equal(body.workflow_metadata.workflow_id, "h3-base-4070-v2");
});

test("reference images are uploaded to the fixed Comfy input subfolder", async () => {
  let form;
  const client = new ComfyClient({ baseUrl: "http://127.0.0.1:8188", fetchImpl: async (_url, options) => {
    form = options.body;
    return Response.json({ name: "job-first_frame.png", subfolder: "narralight_h3", type: "input" });
  } });
  const uploaded = await client.uploadImage({ bytes: Buffer.from("png"), filename: "job-first_frame.png", mimeType: "image/png" });
  assert.equal(form.get("subfolder"), "narralight_h3");
  assert.equal(form.get("overwrite"), "true");
  assert.equal(uploaded.inputName, "narralight_h3/job-first_frame.png");
});
