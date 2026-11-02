export type ApiErrorDetails = {
    field?: string;
    actual?: unknown;
    allowed?: unknown;
    [key: string]: unknown;
};

export type ProviderApiError = {
    httpStatus?: number;
    code?: string;
    message?: string;
    requestId?: string;
};

export class ApiError extends Error {
    readonly httpStatus: number;
    readonly code: string;
    readonly requestId: string;
    readonly details?: ApiErrorDetails;
    readonly providerError?: ProviderApiError;

    constructor(input: { httpStatus: number; code: string; message: string; requestId: string; details?: ApiErrorDetails; providerError?: ProviderApiError }) {
        super(formatApiError(input));
        this.name = "ApiError";
        this.httpStatus = input.httpStatus;
        this.code = input.code;
        this.requestId = input.requestId;
        this.details = input.details;
        this.providerError = input.providerError;
    }
}

export async function apiErrorFromResponse(response: Response, fallback: string) {
    const raw = await response.text().catch(() => "");
    const body = parseBody(raw);
    const nestedError = record(body?.error);
    const providerBody = record(body?.providerError);
    const providerError = providerBody
        ? compactProviderError({
              httpStatus: numberValue(providerBody.httpStatus),
              code: stringValue(providerBody.code),
              message: sanitize(stringValue(providerBody.message)),
              requestId: stringValue(providerBody.requestId) ? sanitizeIdentifier(stringValue(providerBody.requestId)) : undefined,
          })
        : undefined;
    const message = sanitize(
        stringValue(body?.message) ||
            (typeof body?.error === "string" ? body.error : "") ||
            stringValue(nestedError?.message) ||
            stringValue(body?.msg) ||
            textFallback(raw) ||
            fallback,
    );
    const code = sanitizeCode(stringValue(body?.code) || stringValue(nestedError?.code) || stringValue(nestedError?.type) || `http_${response.status}`);
    const requestId = sanitizeIdentifier(
        stringValue(body?.requestId) ||
            stringValue(body?.request_id) ||
            stringValue(nestedError?.requestId) ||
            response.headers.get("x-request-id") ||
            response.headers.get("x-tt-logid") ||
            response.headers.get("x-trace-id") ||
            localDiagnosticId(),
    );
    const details = record(body?.details) as ApiErrorDetails | undefined;
    return new ApiError({ httpStatus: response.status, code, message, requestId, details, providerError });
}

export async function throwApiError(response: Response, fallback: string): Promise<never> {
    throw await apiErrorFromResponse(response, fallback);
}

export function apiErrorMessageFromUnknownResponse(error: unknown, fallback: string) {
    const source = record(error);
    const response = record(source?.response);
    if (!response) return formatApiError({ httpStatus: 0, code: "network_error", message: error instanceof Error ? sanitize(error.message || fallback) : fallback, requestId: localDiagnosticId() });
    const body = record(response.data);
    const nestedError = record(body?.error);
    const status = numberValue(response.status) || 0;
    const headers = record(response.headers);
    const message = sanitize(stringValue(body?.message) || (typeof body?.error === "string" ? body.error : "") || stringValue(nestedError?.message) || stringValue(body?.msg) || stringValue(source?.message) || fallback);
    const code = sanitizeCode(stringValue(body?.code) || stringValue(nestedError?.code) || stringValue(nestedError?.type) || (status ? `http_${status}` : "network_error"));
    const requestId = sanitizeIdentifier(stringValue(body?.requestId) || stringValue(body?.request_id) || stringValue(nestedError?.requestId) || stringValue(headers?.["x-request-id"]) || stringValue(headers?.["x-tt-logid"]) || localDiagnosticId());
    const providerBody = record(body?.providerError);
    const providerError = providerBody ? compactProviderError({ httpStatus: numberValue(providerBody.httpStatus), code: stringValue(providerBody.code), message: sanitize(stringValue(providerBody.message)), requestId: stringValue(providerBody.requestId) }) : undefined;
    return formatApiError({ httpStatus: status, code, message, requestId, details: record(body?.details) as ApiErrorDetails | undefined, providerError });
}

export function localApiError(code: string, message: string) {
    return new ApiError({ httpStatus: 0, code: sanitizeCode(code), message: sanitize(message), requestId: localDiagnosticId() });
}

export function formatApiError(input: { httpStatus: number; code: string; message: string; requestId: string; details?: ApiErrorDetails; providerError?: ProviderApiError }) {
    const parts = [input.httpStatus ? `HTTP ${input.httpStatus}` : "LOCAL", input.code, sanitize(input.message)];
    if (input.details?.field) parts.push(`字段 ${sanitize(String(input.details.field))}`);
    if (input.details && Object.prototype.hasOwnProperty.call(input.details, "actual")) parts.push(`实际值 ${sanitize(displayValue(input.details.actual))}`);
    if (input.details && Object.prototype.hasOwnProperty.call(input.details, "allowed")) parts.push(`允许值 ${sanitize(displayValue(input.details.allowed))}`);
    if (input.providerError) {
        const provider = [input.providerError.httpStatus ? `供应商 HTTP ${input.providerError.httpStatus}` : "", input.providerError.code ? sanitizeCode(input.providerError.code) : "", sanitize(input.providerError.message || ""), input.providerError.requestId ? `Request ID ${sanitizeIdentifier(input.providerError.requestId)}` : ""].filter(Boolean).join(" · ");
        if (provider) parts.push(provider);
    }
    parts.push(`排查编号 ${input.requestId}`);
    return [...new Set(parts.filter(Boolean))].join("｜");
}

function parseBody(raw: string): Record<string, unknown> | undefined {
    if (!raw.trim()) return undefined;
    try {
        return record(JSON.parse(raw));
    } catch {
        return undefined;
    }
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown) {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return "";
}

function numberValue(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function compactProviderError(value: ProviderApiError) {
    return Object.values(value).some((item) => item !== undefined && item !== "") ? value : undefined;
}

function displayValue(value: unknown) {
    if (Array.isArray(value)) return value.join(", ");
    if (value && typeof value === "object") return JSON.stringify(value);
    return String(value ?? "");
}

function textFallback(raw: string) {
    const text = raw.trim();
    if (!text || /^\s*</.test(text)) return "";
    return text.slice(0, 500);
}

function sanitizeCode(value: string) {
    return sanitizeIdentifier(value || "unknown_error").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120) || "unknown_error";
}

function sanitizeIdentifier(value: string) {
    return String(value || "").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 200) || localDiagnosticId();
}

function sanitize(value: string) {
    return String(value || "")
        .replace(/https?:\/\/\S+\?\S+/gi, "[signed-url-redacted]")
        .replace(/Bearer\s+[a-zA-Z0-9._-]{8,}/gi, "Bearer [redacted]")
        .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, "[secret-redacted]")
        .replace(/\b(api[_-]?key|token|signature|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]")
        .slice(0, 1000);
}

function localDiagnosticId() {
    return `WEB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`.toUpperCase();
}
