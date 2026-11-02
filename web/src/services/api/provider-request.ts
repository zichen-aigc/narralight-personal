import { assertBackendRequestSupported } from "@/lib/backend-model-contract";
export async function prepareProviderRequest(input: { requestUrl: string; requestPayload: Record<string, unknown>; projectId?: string; taskId?: string }) {
    assertBackendRequestSupported(input.requestUrl, input.requestPayload);
    return { taskId: undefined, headers: {} as Record<string, string>, created: false };
}
