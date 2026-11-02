import { formatApiError, type ApiErrorDetails, type ProviderApiError } from "@/services/api-error";
export type LocalPlatformMeta = { profile: string; instanceKind?: string; authRequired: boolean; dataRoot?: string; database?: string; network?: string };
export class PlatformApiError extends Error {
    status: number;
    code: string;
    requestId: string;

    constructor(status: number, code: string, message: string, requestId: string, details?: ApiErrorDetails, providerError?: ProviderApiError) {
        super(formatApiError({ httpStatus: status, code, message, requestId, details, providerError }));
        this.name = "PlatformApiError";
        this.status = status;
        this.code = code;
        this.requestId = requestId;
    }
}

type ApiErrorPayload = { error?: unknown; message?: unknown; code?: unknown; requestId?: unknown; details?: unknown; providerError?: unknown };

async function readPayload(response: Response) {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

export async function platformRequest<T>(path: string, init?: RequestInit, options?: { notifyGate?: boolean }): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetch(path, { ...init, headers, cache: "no-store", credentials: "same-origin" });
    const payload = await readPayload(response);
    if (!response.ok) {
        const errorPayload = payload && typeof payload === "object" ? (payload as ApiErrorPayload) : {};
        const message = typeof errorPayload.error === "string" ? errorPayload.error : typeof errorPayload.message === "string" ? errorPayload.message : `请求失败（HTTP ${response.status}）`;
        const requestId =
            typeof errorPayload.requestId === "string"
                ? errorPayload.requestId
                : response.headers.get("x-request-id") || `WEB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`.toUpperCase();
        const details = errorPayload.details && typeof errorPayload.details === "object" && !Array.isArray(errorPayload.details) ? (errorPayload.details as ApiErrorDetails) : undefined;
        const providerError =
            errorPayload.providerError && typeof errorPayload.providerError === "object" && !Array.isArray(errorPayload.providerError) ? (errorPayload.providerError as ProviderApiError) : undefined;
        throw new PlatformApiError(response.status, typeof errorPayload.code === "string" ? errorPayload.code : "request_failed", message, requestId, details, providerError);
    }
    return payload as T;
}

export const getLocalPlatformMeta = () => platformRequest<LocalPlatformMeta>("/api/local/meta");
