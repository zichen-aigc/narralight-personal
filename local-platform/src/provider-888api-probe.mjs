import { API888_CREDENTIAL_TARGET } from "./provider-888api.mjs";

const MODELS_URL = "https://888api.xin/v1/models";
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_MODELS = 500;

function probeFailure(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}

export async function probe888ApiModels({ credentialResolver, fetchImpl = fetch }) {
    let key;
    try { key = credentialResolver(API888_CREDENTIAL_TARGET); }
    catch { throw probeFailure(409, "api888_probe_credential_missing", "888API 服务端密钥未配置或无效"); }
    if (typeof key !== "string" || !key || key.length > 4096 || /[\r\n\x00-\x1f\x7f]/.test(key)) {
        throw probeFailure(409, "api888_probe_credential_missing", "888API 服务端密钥未配置或无效");
    }
    let response;
    try {
        response = await fetchImpl(MODELS_URL, {
            method: "GET",
            headers: { authorization: `Bearer ${key}`, accept: "application/json" },
            redirect: "manual",
            signal: AbortSignal.timeout(5_000),
        });
    } catch {
        throw probeFailure(502, "api888_probe_network_failed", "888API 型号查询网络失败");
    }
    if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw probeFailure(502, "api888_probe_upstream_rejected", "888API 型号查询未成功");
    }
    if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type") || "")) {
        await response.body?.cancel().catch(() => undefined);
        throw probeFailure(502, "api888_probe_invalid_response", "888API 型号响应格式无效");
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        throw probeFailure(502, "api888_probe_response_too_large", "888API 型号响应超过限制");
    }
    if (!response.body) throw probeFailure(502, "api888_probe_invalid_response", "888API 型号响应为空");
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) throw probeFailure(502, "api888_probe_response_too_large", "888API 型号响应超过限制");
            chunks.push(value);
        }
    } catch (error) {
        if (error.code === "api888_probe_response_too_large") throw error;
        throw probeFailure(502, "api888_probe_network_failed", "888API 型号响应读取失败");
    } finally {
        await reader.cancel().catch(() => undefined);
    }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes).toString("utf8")); }
    catch { throw probeFailure(502, "api888_probe_invalid_response", "888API 型号响应格式无效"); }
    if (!payload || !Array.isArray(payload.data) || payload.data.length > MAX_MODELS) {
        throw probeFailure(502, "api888_probe_invalid_response", "888API 型号响应格式无效");
    }
    const ids = [];
    const seen = new Set();
    for (const row of payload.data) {
        const id = row?.id;
        if (typeof id !== "string" || id.length < 1 || id.length > 200 || /[\x00-\x1f\x7f]/.test(id) || id.includes(key)) {
            throw probeFailure(502, "api888_probe_invalid_response", "888API 型号响应格式无效");
        }
        if (!seen.has(id)) { seen.add(id); ids.push(id); }
    }
    return { connectionId: "888api", status: "models_visible", modelIds: ids, executionAuthority: false };
}
