export type AgentPromptSubmissionGate = {
    connected: boolean;
    hasPrompt: boolean;
    sending: boolean;
    waiting: boolean;
    activeThreadLoading: boolean;
    threadOperationActive: boolean;
    conversationStatus: string;
};

export function shouldBlockAgentPromptSubmission(gate: AgentPromptSubmissionGate) {
    return !gate.connected
        || !gate.hasPrompt
        || gate.sending
        || gate.waiting
        || gate.activeThreadLoading
        || gate.threadOperationActive
        || !["ready", "warning"].includes(gate.conversationStatus);
}

export type AgentThreadSnapshotGate = {
    threadId: string;
    currentThreadId: string;
    activeOperation: number;
    currentActiveOperation: number;
};

export function isAgentThreadSnapshotCurrent(gate: AgentThreadSnapshotGate) {
    return gate.threadId === gate.currentThreadId
        && gate.activeOperation === gate.currentActiveOperation;
}
