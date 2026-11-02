import { type ApimartGrokOfficialPricing } from "@/services/api/apimart-grok-official-video";
import { create } from "zustand";
import { isApimartGrokOfficialVideoModel } from "@/lib/apimart-grok-official-video";
import { currentRuntimeIdentity, subscribeRuntimeIdentity } from "@/lib/runtime-version-guard";
import { fetchApimartGrokOfficialPricing } from "@/services/api/apimart-grok-official-video";
import { useRuntimeStore } from "@/stores/use-runtime-store";

type BackendContract = "apimart.grok-official.v1";
type ContractState = {
    context: string;
    status: "unknown" | "checking" | "supported" | "unavailable";
    contracts: readonly BackendContract[];
    pricing?: ApimartGrokOfficialPricing;
    api888Ready: boolean;
    api888Models: readonly string[];
};
// Ephemeral runtime evidence only. Never persist a browser's claim into shared configuration.
export const useBackendModelContracts = create<ContractState>(() => ({ context: "", status: "unknown", contracts: [], api888Ready: false, api888Models: [] }));
let controller: AbortController | undefined;
let pending: Promise<void> | undefined;

export function currentBackendContractContext() {
    const runtime = currentRuntimeIdentity();
    const identity = useRuntimeStore.getState();
    if (!runtime || identity.status !== "personal") return "";
    return JSON.stringify([runtime.runtimeId, identity.status, "local"]);
}

export function resetBackendModelContracts() {
    controller?.abort();
    controller = undefined;
    pending = undefined;
    useBackendModelContracts.setState({ context: "", status: "unknown", contracts: [], pricing: undefined, api888Ready: false, api888Models: [] });
}

export function isModelBackendSupported(model: string | undefined) {
    if (String(model || "").startsWith("888api::")) {
        const state = useBackendModelContracts.getState();
        const context = currentBackendContractContext();
        return Boolean(context && state.context === context && state.api888Ready && state.api888Models.includes(String(model).slice("888api::".length)));
    }
    // The five RH Grok entries already exist in production index4f6's JS. Preserve
    // their established validation path; lack of new evidence is not a removal vote.
    const contract: BackendContract | undefined = isApimartGrokOfficialVideoModel(model) ? "apimart.grok-official.v1" : undefined;
    if (!contract) return true;
    const state = useBackendModelContracts.getState();
    const context = currentBackendContractContext();
    return Boolean(context && state.context === context && state.status === "supported" && state.contracts.includes(contract));
}

export function assertModelBackendSupported(model: string | undefined) {
    if (!isModelBackendSupported(model))
        throw Object.assign(
            new Error(
                String(model || "").startsWith("888api::")
                    ? "888API 服务端尚未就绪，请检查密钥、素材中继和当前版本。"
                    : "当前后台尚未确认支持此 Grok 型号，已保留历史配置并阻止新建任务；请选择已支持的模型。",
            ),
            { code: "backend_model_contract_unavailable" },
        );
}

export function assertBackendRequestSupported(_requestUrl: string, payload: Record<string, unknown>) {
    assertModelBackendSupported(String(payload.model || ""));
}

export function probeBackendModelContracts(): Promise<void> {
    const context = currentBackendContractContext();
    if (!context) {
        resetBackendModelContracts();
        return Promise.resolve();
    }
    const state = useBackendModelContracts.getState();
    if (state.context === context && pending) return pending;
    resetBackendModelContracts();
    const requestController = new AbortController();
    controller = requestController;
    useBackendModelContracts.setState({ context, status: "checking", contracts: [], pricing: undefined, api888Ready: false, api888Models: [] });
    const task = (async () => {
        try {
            const pricing = await fetchApimartGrokOfficialPricing({ signal: requestController.signal });
            // This endpoint attests only the APIMart official adapter. It says nothing
            // about the independently packaged RunningHub module in a runtime image.
            if (!requestController.signal.aborted && currentBackendContractContext() === context)
                useBackendModelContracts.setState((state) => ({ ...state, context, status: "supported", contracts: ["apimart.grok-official.v1"], pricing }));
        } catch {
            if (!requestController.signal.aborted && currentBackendContractContext() === context)
                useBackendModelContracts.setState((state) => ({ ...state, context, status: "unavailable", contracts: [], pricing: undefined }));
        }
        if (requestController.signal.aborted || currentBackendContractContext() !== context) {
            if (controller === requestController) pending = undefined;
            return;
        }
        const models = await fetch("/api/local/provider-catalog/888api/readiness", { credentials: "same-origin", cache: "no-store", signal: requestController.signal })
            .then(async (response) => {
                if (!response.ok) return null;
                const body = (await response.json()) as { ready?: boolean; models?: string[] };
                return body.ready === true && Array.isArray(body.models) ? body.models.filter((item): item is string => typeof item === "string") : null;
            })
            .catch(() => null);
        if (!requestController.signal.aborted && currentBackendContractContext() === context)
            useBackendModelContracts.setState((state) => ({ ...state, api888Ready: models !== null, api888Models: models || [] }));
        if (controller === requestController) pending = undefined;
    })();
    pending = task;
    return task;
}

useRuntimeStore.subscribe(() => {
    if (useBackendModelContracts.getState().context !== currentBackendContractContext()) resetBackendModelContracts();
});
subscribeRuntimeIdentity(resetBackendModelContracts);
