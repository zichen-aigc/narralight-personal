import { create } from "zustand";

import i18n from "@/i18n";

import type { CanvasNodeDefinition } from "@/types/canvas-plugin";
import { CanvasNodeType } from "@/types/canvas";

const definitions = new Map<string, CanvasNodeDefinition>();
const ownerByType = new Map<string, string>(); // type -> pluginId; built-in nodes use "builtin".
const registrationByType = new Map<string, symbol>();

// Increment the registry version on registration or removal to update dependent UI such as creation menus.
export const useNodeRegistryVersion = create<{ version: number }>(() => ({ version: 0 }));
function bump() {
    useNodeRegistryVersion.setState((state) => ({ version: state.version + 1 }));
}

export function registerNodeDefinitions(defs: CanvasNodeDefinition[], pluginId = "builtin") {
    return stageNodeDefinitions(defs, pluginId).dispose;
}

export function stageNodeDefinitions(defs: CanvasNodeDefinition[], pluginId = "builtin") {
    const previous = new Map<string, { definition: CanvasNodeDefinition; owner: string; registration?: symbol } | null>();
    const registration = Symbol(pluginId);
    defs.forEach((def) => {
        if (!previous.has(def.type)) {
            const definition = definitions.get(def.type);
            previous.set(def.type, definition ? { definition, owner: ownerByType.get(def.type) || "builtin", registration: registrationByType.get(def.type) } : null);
        }
        definitions.set(def.type, def);
        ownerByType.set(def.type, pluginId);
        registrationByType.set(def.type, registration);
    });
    bump();
    let active = true;
    let restorePrevious = true;
    return {
        commit: () => {
            restorePrevious = false;
        },
        dispose: () => {
            if (!active) return;
            active = false;
            for (const [type, snapshot] of previous) {
                if (ownerByType.get(type) !== pluginId || registrationByType.get(type) !== registration) continue;
                if (restorePrevious && snapshot) {
                    definitions.set(type, snapshot.definition);
                    ownerByType.set(type, snapshot.owner);
                    if (snapshot.registration) registrationByType.set(type, snapshot.registration);
                    else registrationByType.delete(type);
                } else {
                    definitions.delete(type);
                    ownerByType.delete(type);
                    registrationByType.delete(type);
                }
            }
            bump();
        },
    };
}

export function unregisterPluginNodes(pluginId: string) {
    for (const [type, owner] of ownerByType) {
        if (owner !== pluginId) continue;
        definitions.delete(type);
        ownerByType.delete(type);
        registrationByType.delete(type);
    }
    bump();
}

export function getNodeDefinition(type: string) {
    return definitions.get(type);
}

export function getNodePluginId(type: string) {
    return ownerByType.get(type) || "builtin";
}

export function listNodeDefinitions() {
    return Array.from(definitions.values());
}

export function isRegisteredNodeType(type: string) {
    return definitions.has(type);
}

const FALLBACK_SPEC = { width: 340, height: 240, title: i18n.t("canvas.node.node"), metadata: {} as CanvasNodeDefinition["defaultMetadata"] };

// Provide default size, title, and metadata shared by createCanvasNode and agent operations.
export function getNodeSpec(type: string) {
    const def = definitions.get(type);
    if (!def) return FALLBACK_SPEC;
    return { width: def.defaultSize.width, height: def.defaultSize.height, title: def.title, metadata: def.defaultMetadata };
}

export function isBuiltinNodeType(type: string) {
    return (Object.values(CanvasNodeType) as string[]).includes(type);
}
