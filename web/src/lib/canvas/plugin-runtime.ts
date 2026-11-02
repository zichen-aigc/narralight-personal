import React from "react";

import { emitCanvasEvent, onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import type { CanvasPluginApp } from "@/types/canvas-plugin";

// Remote plugins obtain the host React instance through this runtime to avoid multiple React copies.
export type PluginRuntime = CanvasPluginApp & {
    React: typeof React;
    jsx: typeof React.createElement;
    Fragment: typeof React.Fragment;
    injectCSS: (css: string, key?: string) => () => void;
};

let runtime: PluginRuntime | null = null;

// Stage a style replacement so failed plugin activation can restore a same-key previous style.
export function stagePluginCSS(css: string, key?: string) {
    const id = key ? `canvas-plugin-style-${key}` : undefined;
    const previous = id ? document.getElementById(id) : null;
    previous?.remove();
    const style = document.createElement("style");
    if (id) style.id = id;
    style.dataset.canvasPluginStyle = "true";
    style.textContent = css;
    document.head.appendChild(style);
    let restorePrevious = true;
    return {
        commit: () => {
            restorePrevious = false;
        },
        dispose: () => {
            style.remove();
            if (restorePrevious && previous) document.head.appendChild(previous);
        },
    };
}

// Direct runtime use commits immediately; activation setup uses the staged form above.
function injectCSS(css: string, key?: string) {
    const staged = stagePluginCSS(css, key);
    staged.commit();
    return staged.dispose;
}

export function getPluginRuntime(): PluginRuntime {
    if (!runtime) {
        runtime = {
            React,
            jsx: React.createElement,
            Fragment: React.Fragment,
            injectCSS,
            version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
            emit: emitCanvasEvent,
            on: onCanvasEvent,
        };
        (window as unknown as { InfiniteCanvasRuntime?: PluginRuntime }).InfiniteCanvasRuntime = runtime;
    }
    return runtime;
}
