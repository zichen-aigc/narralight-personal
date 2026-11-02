export type StablePromptReference = { nodeId: string; label: string; active?: boolean };

const referenceTokenPattern = /@\[node:([^\]]+)\]/g;

export function stabilizeReferencePrompt(value: string, references: StablePromptReference[]) {
    const active = references.filter((reference) => reference.active !== false).sort((a, b) => b.label.length - a.label.length);
    if (!value || !active.length) return value;
    const referenceByLabel = new Map(active.map((reference) => [reference.label, reference]));
    const labelPattern = new RegExp(`(${active.map((reference) => escapeRegExp(reference.label)).join("|")})`, "g");
    return mapPromptText(value, (text) => text.replace(labelPattern, (label) => {
        const reference = referenceByLabel.get(label);
        return reference ? `@[node:${reference.nodeId}]` : label;
    }));
}

export function resolveReferencePrompt(value: string, references: StablePromptReference[]) {
    const labelByNodeId = new Map(references.filter((reference) => reference.active !== false).map((reference) => [reference.nodeId, reference.label]));
    return value.replace(referenceTokenPattern, (token, nodeId) => labelByNodeId.get(nodeId) || token);
}

function mapPromptText(value: string, transform: (text: string) => string) {
    let result = "";
    let lastIndex = 0;
    for (const match of value.matchAll(referenceTokenPattern)) {
        if (match.index === undefined) continue;
        result += transform(value.slice(lastIndex, match.index)) + match[0];
        lastIndex = match.index + match[0].length;
    }
    return result + transform(value.slice(lastIndex));
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
