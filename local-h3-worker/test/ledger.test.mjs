import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkerLedger } from "../src/ledger.mjs";

test("ledger durably records submission intent before Comfy ID can be reused", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "h3-worker-ledger-"));
  const filename = path.join(dir, "ledger.sqlite");
  let ledger = new WorkerLedger(filename);
  ledger.saveClaim({
    jobId: "job-1",
    leaseId: "lease-1",
    workflowSha256: "a".repeat(64),
    promptOriginalZh: "测试",
    promptFinal: null,
    seed: 7,
  });
  ledger.transition("job-1", "claimed", "compiling", { prompt_final: "执行稿", compiler_id: "zh-direct-v1" });
  ledger.transition("job-1", "compiling", "submission_intent", { comfy_prompt_id: "11111111-1111-4111-8111-111111111111" });
  ledger.close();

  ledger = new WorkerLedger(filename);
  const recovered = ledger.assertSingleActive();
  assert.equal(recovered.state, "submission_intent");
  assert.equal(recovered.comfy_prompt_id, "11111111-1111-4111-8111-111111111111");
  assert.throws(() => ledger.transition("job-1", "compiling", "submitted"), { code: "ledger_state_conflict" });
  ledger.close();
});

test("ledger refuses to run with more than one unfinished job", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "h3-worker-concurrency-"));
  const ledger = new WorkerLedger(path.join(dir, "ledger.sqlite"));
  for (const index of [1, 2]) {
    ledger.saveClaim({
      jobId: `job-${index}`,
      leaseId: `lease-${index}`,
      workflowSha256: "a".repeat(64),
      promptOriginalZh: `测试${index}`,
      promptFinal: null,
      seed: index,
    });
  }
  assert.throws(() => ledger.assertSingleActive(), { code: "ledger_multiple_active_jobs" });
  ledger.close();
});
