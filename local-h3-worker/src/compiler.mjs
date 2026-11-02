import { WorkerError } from "./errors.mjs";

const MAX_PROMPT_LENGTH = 12_000;

export function compilePrompt(sourcePrompt, compilerId = "zh-direct-v1") {
  if (compilerId !== "zh-direct-v1") {
    throw new WorkerError("compiler_not_allowed", `Unsupported offline compiler: ${compilerId}`);
  }
  if (typeof sourcePrompt !== "string" || !sourcePrompt.trim()) {
    throw new WorkerError("prompt_empty", "Prompt must not be empty");
  }
  const original = sourcePrompt.trim();
  if (original.length > MAX_PROMPT_LENGTH) {
    throw new WorkerError("prompt_too_long", `Prompt exceeds ${MAX_PROMPT_LENGTH} characters`);
  }
  const executionPrompt = [
    "integrated_multimodal_description:",
    original,
    "",
    "overall_soundscape:",
    "Generate synchronized natural ambience, action sounds, and dialogue described above. Keep timing consistent with the visible action.",
    "",
    "language_and_text_preservation:",
    "Keep every quoted Chinese dialogue line and every requested visible Chinese text exactly in its original language. Do not translate or paraphrase quoted text.",
  ].join("\n");
  return {
    compilerId,
    compilerVersion: "1",
    originalPrompt: original,
    executionPrompt,
  };
}
