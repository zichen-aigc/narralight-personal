export type AgentUrlBootstrap = { remainingHash: string };

/** 识别并移除 URL fragment 中的 Agent 凭据，但绝不把凭据值交给浏览器状态。 */
export function stripAgentCredentialsFromHash(hash: string): AgentUrlBootstrap | null {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    if (!params.has("agentUrl") && !params.has("agentToken")) return null;
    params.delete("agentUrl");
    params.delete("agentToken");
    const remaining = params.toString();
    return { remainingHash: remaining ? `#${remaining}` : "" };
}
