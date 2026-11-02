import { platformClientId, subscribePlatformLeases } from "@/lib/platform-storage";
import { apiErrorFromResponse } from "@/services/api-error";

export type PlatformLeaseStatus = "loading" | "editor" | "viewer" | "readonly" | "offline";

const leaseUrl = (resource: string) => `/api/local/leases/${encodeURIComponent(resource)}`;

export async function acquirePlatformLease(resource: string, force = false) {
    try {
        const response = await fetch(leaseUrl(resource), {
            method: "PUT",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clientId: platformClientId, force }),
        });
        if (response.status === 403) return { status: "readonly" as const };
        if (response.status === 409) return { status: "viewer" as const };
        if (!response.ok) throw await apiErrorFromResponse(response, "画布编辑租约服务请求失败");
        return { status: "editor" as const };
    } catch (error) {
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("infinite-canvas:platform-offline", { detail: error instanceof Error ? error.message : String(error) }));
        return { status: "offline" as const, error: error instanceof Error ? error.message : String(error) };
    }
}

export async function releasePlatformLease(resource: string) {
    await fetch(leaseUrl(resource), {
        method: "DELETE",
        cache: "no-store",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: platformClientId }),
    }).catch(() => undefined);
}

export function subscribePlatformLease(resource: string, onStatus: (status: PlatformLeaseStatus) => void) {
    return subscribePlatformLeases((event) => {
        if (event.resource !== resource) return;
        if (event.released) return;
        onStatus(event.clientId === platformClientId ? "editor" : "viewer");
    });
}
