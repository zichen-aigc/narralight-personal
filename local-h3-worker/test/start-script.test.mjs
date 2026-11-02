import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("launcher preserves the accepted 4070 H3 runtime arguments", async () => {
  const source = await readFile(new URL("../scripts/Start-H3Worker.ps1", import.meta.url), "ascii");
  for (const fragment of [
    "--listen', '127.0.0.1'",
    "--port', '8188'",
    "--disable-auto-launch",
    "--lowvram",
    "--offline",
    "--disable-all-custom-nodes",
    "--preview-method', 'none'",
    "--models-directory', $modelsRoot",
    "--input-directory', $inputRoot",
    "--output-directory', $outputRoot",
    "--temp-directory', $tempRoot",
    "--user-directory', $userRoot",
    "-WindowStyle Hidden",
  ]) {
    assert.ok(source.includes(fragment), `missing accepted launch argument: ${fragment}`);
  }
});
