import { createHash, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { WorkerError } from "./errors.mjs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = path.resolve(MODULE_DIR, "../scripts");

export function sha256Hex(body = Buffer.alloc(0)) {
  return createHash("sha256").update(body).digest("hex");
}

export function canonicalRequest({ workerId, timestamp, nonce, method, pathnameWithQuery, body }) {
  return [
    "v1",
    workerId,
    timestamp,
    nonce,
    method.toUpperCase(),
    pathnameWithQuery,
    sha256Hex(body),
  ].join("\n");
}

export function signedHeaders({ workerId, privateKeyPem, method, pathnameWithQuery, body = Buffer.alloc(0), now = Date.now(), nonce }) {
  const timestamp = String(Math.floor(now / 1000));
  const requestNonce = nonce || randomBytes(18).toString("base64url");
  const canonical = canonicalRequest({
    workerId,
    timestamp,
    nonce: requestNonce,
    method,
    pathnameWithQuery,
    body,
  });
  const signature = sign(null, Buffer.from(canonical, "utf8"), privateKeyPem).toString("base64");
  return {
    "X-Narralight-Worker-Id": workerId,
    "X-Narralight-Worker-Timestamp": timestamp,
    "X-Narralight-Worker-Nonce": requestNonce,
    "X-Narralight-Worker-Signature": signature,
  };
}

export function verifySignedRequest({ publicKey, signatureBase64, ...request }) {
  const canonical = canonicalRequest(request);
  return verify(null, Buffer.from(canonical, "utf8"), publicKey, Buffer.from(signatureBase64, "base64"));
}

export function generateWorkerKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeySpkiDerBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    publicKey,
  };
}

async function runPowerShell(scriptName, args, stdinText = "") {
  if (process.platform !== "win32") {
    throw new WorkerError("dpapi_windows_only", "DPAPI worker keys can only be used on Windows");
  }
  const scriptPath = path.join(SCRIPT_DIR, scriptName);
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      ...args,
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => reject(new WorkerError("dpapi_process_failed", "Unable to start DPAPI helper", { cause: error })));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new WorkerError("dpapi_failed", `DPAPI helper failed with exit code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
      } else {
        resolve(stdout.trim());
      }
    });
    child.stdin.end(stdinText);
  });
}

export async function protectPrivateKeyToFile(privateKeyPem, destinationPath) {
  const protectedBase64 = await runPowerShell("Protect-WorkerKey.ps1", [], Buffer.from(privateKeyPem, "utf8").toString("base64"));
  const absolute = path.resolve(destinationPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temp = `${absolute}.${process.pid}.tmp`;
  await writeFile(temp, `${protectedBase64}\n`, { encoding: "ascii", mode: 0o600 });
  await rename(temp, absolute);
  return absolute;
}

export async function loadPrivateKey(config) {
  if (process.env.NARRALIGHT_H3_WORKER_PRIVATE_KEY_PEM) {
    return process.env.NARRALIGHT_H3_WORKER_PRIVATE_KEY_PEM;
  }
  if (!config.privateKeyDpapiPath) {
    throw new WorkerError("worker_private_key_missing", "No DPAPI worker key path is configured");
  }
  const protectedValue = (await readFile(config.privateKeyDpapiPath, "ascii")).trim();
  const plaintextBase64 = await runPowerShell("Unprotect-WorkerKey.ps1", [], protectedValue);
  return Buffer.from(plaintextBase64, "base64").toString("utf8");
}

export async function removeProtectedKey(destinationPath) {
  await rm(destinationPath, { force: true });
}
