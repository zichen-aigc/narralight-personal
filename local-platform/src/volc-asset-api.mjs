import { createHash, createHmac } from "node:crypto";

export const VOLC_ASSET_API_CONTRACT = Object.freeze({
    endpoint: "https://ark.cn-beijing.volcengineapi.com/",
    region: "cn-beijing",
    service: "ark",
    version: "2024-01-01",
    createGroupAction: "CreateAssetGroup",
    listGroupsAction: "ListAssetGroups",
    listAction: "ListAssets",
    createAction: "CreateAsset",
    getAction: "GetAsset",
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value, encoding) => createHmac("sha256", key).update(value).digest(encoding);
const rfc3986 = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

function safeIdentifier(value, max = 200) {
    const text = String(value ?? "").trim();
    return /^[a-zA-Z0-9_.:@/-]+$/.test(text) ? text.slice(0, max) : "";
}

function safeMessage(value) {
    return String(value ?? "")
        .replace(/https?:\/\/\S+/gi, "[url-redacted]")
        .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[authorization-redacted]")
        .replace(/\b(?:api[_-]?key|token|secret|signature|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
}

function errorObject(payload) {
    const result = resultObject(payload);
    const metadata = payload?.ResponseMetadata && typeof payload.ResponseMetadata === "object" ? payload.ResponseMetadata : {};
    const metadataError = metadata.Error && typeof metadata.Error === "object" ? metadata.Error : {};
    const error = result?.Error && typeof result.Error === "object" ? result.Error : payload?.Error && typeof payload.Error === "object" ? payload.Error : payload?.error && typeof payload.error === "object" ? payload.error : {};
    return {
        code: safeIdentifier(metadataError.Code ?? error.Code ?? error.code ?? payload?.Code ?? payload?.code, 100),
        message: safeMessage(metadataError.Message ?? error.Message ?? error.message ?? payload?.Message ?? payload?.message),
        requestId: safeIdentifier(metadata.RequestId ?? metadata.RequestID ?? payload?.RequestId ?? payload?.RequestID ?? payload?.request_id, 200),
    };
}

function resultObject(payload) {
    return payload?.Result && typeof payload.Result === "object" ? payload.Result : payload?.result && typeof payload.result === "object" ? payload.result : payload || {};
}

export function normalizeVolcAssetResponse(payload, httpStatus = 200, headers) {
    const result = resultObject(payload);
    const providerError = errorObject(payload);
    const headerRequestId = ["x-request-id", "x-tt-logid", "request-id"].map((name) => headers?.get?.(name)).find(Boolean);
    if (!providerError.requestId) providerError.requestId = safeIdentifier(headerRequestId, 200);
    const status = String(result.Status ?? result.status ?? "").trim();
    const assetId = safeIdentifier(result.Id ?? result.ID ?? result.id ?? result.AssetId ?? result.AssetID ?? result.asset_id, 200);
    const failed = status.toLowerCase() === "failed" || Boolean(providerError.code) || httpStatus < 200 || httpStatus >= 300;
    return {
        httpStatus,
        assetId: assetId || undefined,
        providerStatus: status || undefined,
        state: failed ? "failed" : status.toLowerCase() === "active" ? "active" : "processing",
        providerError: Object.values(providerError).some(Boolean) ? providerError : undefined,
    };
}

function normalizeVolcAssetGroupListResponse(payload, httpStatus = 200, headers) {
    const result = resultObject(payload);
    const providerError = errorObject(payload);
    const headerRequestId = ["x-request-id", "x-tt-logid", "request-id"].map((name) => headers?.get?.(name)).find(Boolean);
    if (!providerError.requestId) providerError.requestId = safeIdentifier(headerRequestId, 200);
    const sourceItems = Array.isArray(result.Items) ? result.Items : Array.isArray(result.AssetGroups) ? result.AssetGroups : [];
    const items = sourceItems.map((item) => ({
        id: safeIdentifier(item?.Id ?? item?.ID ?? item?.id, 200),
        name: safeIdentifier(item?.Name ?? item?.name, 100),
        groupType: safeIdentifier(item?.GroupType ?? item?.group_type, 50),
        projectName: safeIdentifier(item?.ProjectName ?? item?.project_name ?? "default", 128) || "default",
    })).filter((item) => item.id);
    const failed = Boolean(providerError.code) || httpStatus < 200 || httpStatus >= 300;
    return {
        httpStatus,
        items,
        totalCount: Number(result.TotalCount ?? items.length),
        state: failed ? "failed" : "active",
        providerError: Object.values(providerError).some(Boolean) ? providerError : undefined,
    };
}

export function normalizeVolcAssetListResponse(payload, httpStatus = 200, headers) {
    const result = resultObject(payload);
    const providerError = errorObject(payload);
    const headerRequestId = ["x-request-id", "x-tt-logid", "request-id"].map((name) => headers?.get?.(name)).find(Boolean);
    if (!providerError.requestId) providerError.requestId = safeIdentifier(headerRequestId, 200);
    const sourceItems = Array.isArray(result.Items) ? result.Items : Array.isArray(result.Assets) ? result.Assets : [];
    const items = sourceItems.map((item) => {
        const status = String(item?.Status ?? item?.status ?? "").trim();
        return {
            id: safeIdentifier(item?.Id ?? item?.ID ?? item?.id ?? item?.AssetId ?? item?.AssetID, 200),
            name: String(item?.Name ?? item?.name ?? "").trim().slice(0, 64),
            groupId: safeIdentifier(item?.GroupId ?? item?.GroupID ?? item?.group_id, 200),
            projectName: safeIdentifier(item?.ProjectName ?? item?.project_name ?? "default", 128) || "default",
            assetType: safeIdentifier(item?.AssetType ?? item?.asset_type, 50),
            providerStatus: status || undefined,
            state: status.toLowerCase() === "active" ? "active" : status.toLowerCase() === "failed" ? "failed" : "processing",
            createTime: String(item?.CreateTime ?? item?.create_time ?? "").slice(0, 100) || undefined,
            updateTime: String(item?.UpdateTime ?? item?.update_time ?? "").slice(0, 100) || undefined,
        };
    }).filter((item) => item.id);
    const failed = Boolean(providerError.code) || httpStatus < 200 || httpStatus >= 300;
    return {
        httpStatus,
        items,
        totalCount: Number(result.TotalCount ?? items.length),
        state: failed ? "failed" : "active",
        providerError: Object.values(providerError).some(Boolean) ? providerError : undefined,
    };
}

function signedHeaders({ accessKey, secretKey, body, action, contract, now }) {
    const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = timestamp.slice(0, 8);
    const endpoint = new URL(contract.endpoint);
    const query = new URLSearchParams({ Action: action, Version: contract.version });
    const canonicalQuery = [...query.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`).join("&");
    const payloadHash = sha256(body);
    const canonicalHeaders = `content-type:application/json\nhost:${endpoint.host}\nx-content-sha256:${payloadHash}\nx-date:${timestamp}\n`;
    const names = "content-type;host;x-content-sha256;x-date";
    const canonicalRequest = `POST\n${endpoint.pathname || "/"}\n${canonicalQuery}\n${canonicalHeaders}\n${names}\n${payloadHash}`;
    const scope = `${date}/${contract.region}/${contract.service}/request`;
    const stringToSign = `HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
    const dateKey = hmac(secretKey, date);
    const regionKey = hmac(dateKey, contract.region);
    const serviceKey = hmac(regionKey, contract.service);
    const signingKey = hmac(serviceKey, "request");
    const signature = hmac(signingKey, stringToSign, "hex");
    return {
        url: new URL(`?${canonicalQuery}`, endpoint),
        headers: {
            authorization: `HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names}, Signature=${signature}`,
            "content-type": "application/json",
            host: endpoint.host,
            "x-content-sha256": payloadHash,
            "x-date": timestamp,
        },
    };
}

export function createVolcAssetOpenApiClient(options) {
    const contract = { ...VOLC_ASSET_API_CONTRACT, ...(options.contract || {}) };
    const endpoint = new URL(contract.endpoint);
    const allowedEndpoint = endpoint.protocol === "https:" && endpoint.hostname === "ark.cn-beijing.volcengineapi.com";
    const testEndpoint = options.allowTestEndpoint === true && endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname);
    if (!allowedEndpoint && !testEndpoint) throw new Error("火山资产接口只允许官方 HTTPS 地址或显式测试回环地址");
    const fetchImpl = options.fetchImpl || fetch;
    const now = typeof options.now === "function" ? options.now : () => new Date();
    const request = async (action, payload, normalize, timeoutMs = options.timeoutMs ?? 15_000) => {
        if (options.enabled !== true) throw Object.assign(new Error("火山真人资产远程接入仍关闭"), { code: "volc_asset_remote_disabled" });
        const accessKey = options.credentialResolver("VOLCENGINE_ARK_ASSETS_ACCESS_KEY");
        const secretKey = options.credentialResolver("VOLCENGINE_ARK_ASSETS_SECRET_KEY");
        if (!accessKey || !secretKey) throw Object.assign(new Error("火山真人资产 AK/SK 未配置"), { code: "volc_asset_credentials_missing" });
        const body = JSON.stringify(payload || {});
        if (Buffer.byteLength(body) > 1024 * 1024) throw Object.assign(new Error("火山资产请求内容过大"), { code: "volc_asset_request_too_large" });
        const signed = signedHeaders({ accessKey, secretKey, body, action, contract, now: now() });
        const response = await fetchImpl(signed.url, { method: "POST", headers: signed.headers, body, signal: AbortSignal.timeout(Math.max(1_000, Number(timeoutMs))) });
        const responseBody = await response.json().catch(() => ({}));
        return normalize(responseBody, response.status, response.headers);
    };
    return {
        contract,
        createAssetGroup: async (payload) => {
            const result = await request(contract.createGroupAction, payload, normalizeVolcAssetResponse);
            return { ...result, groupId: result.assetId };
        },
        listAssetGroups: (payload) => request(contract.listGroupsAction, payload, normalizeVolcAssetGroupListResponse),
        listAssets: (payload) => request(contract.listAction, payload, normalizeVolcAssetListResponse),
        createAsset: (payload) => request(contract.createAction, payload, normalizeVolcAssetResponse, options.createTimeoutMs ?? 60_000),
        getAsset: (assetId, projectName = "default") => request(contract.getAction, { Id: assetId, ProjectName: projectName }, normalizeVolcAssetResponse),
    };
}
