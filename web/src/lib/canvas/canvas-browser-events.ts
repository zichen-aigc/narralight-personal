import { isImeComposing } from "@/lib/keyboard-event";

const OVERLAY = "[data-canvas-no-zoom],[data-canvas-shortcuts-ignore],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown";
const TEXT_INPUT = "input,textarea,select,[contenteditable]:not([contenteditable='false'])";

export function bindCanvasBrowserZoomGuard(workspace: HTMLElement) {
    const preventBrowserZoom = (event: WheelEvent) => {
        if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    workspace.addEventListener("wheel", preventBrowserZoom, { capture: true, passive: false });
    return () => workspace.removeEventListener("wheel", preventBrowserZoom, true);
}

export function bindCanvasWheelEvents(container: HTMLElement, onWheel: (event: WheelEvent) => void) {
    const isProtected = (event: WheelEvent) => event.target instanceof Element && Boolean(event.target.closest(`${OVERLAY},${TEXT_INPUT}`));
    const captureZoom = (event: WheelEvent) => {
        if (!event.ctrlKey && !event.metaKey) return;
        // Cancel browser zoom before a node can stop bubbling, including over an editor.
        event.preventDefault();
        if (!isProtected(event)) onWheel(event);
    };
    const bubblePan = (event: WheelEvent) => {
        if (event.ctrlKey || event.metaKey || isProtected(event) || event.defaultPrevented) return;
        event.preventDefault();
        onWheel(event);
    };
    container.addEventListener("wheel", captureZoom, { capture: true, passive: false });
    container.addEventListener("wheel", bubblePan, { passive: false });
    return () => {
        container.removeEventListener("wheel", captureZoom, true);
        container.removeEventListener("wheel", bubblePan);
    };
}

export function bindCanvasDuplicateShortcut(container: HTMLElement, duplicate: () => void) {
    const doc = container.ownerDocument;
    const view = doc.defaultView!;
    let claimed = false;
    const keydown = (event: KeyboardEvent) => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "d" || isImeComposing(event)) return;
        // A duplicate may focus its editor before auto-repeat arrives.
        if (claimed && event.repeat) {
            event.preventDefault();
            return;
        }
        const target = event.target;
        if (event.defaultPrevented || !(target instanceof Element)) return;
        if (target.closest(`${OVERLAY},${TEXT_INPUT}`)) return;
        if (!container.contains(target) && target !== doc.body && target !== doc.documentElement) return;
        event.preventDefault();
        claimed = true;
        if (!event.repeat) duplicate();
    };
    const release = () => { claimed = false; };
    const keyup = (event: KeyboardEvent) => {
        if (["d", "control", "meta"].includes(event.key.toLowerCase())) release();
    };
    view.addEventListener("keydown", keydown, true);
    view.addEventListener("keyup", keyup, true);
    view.addEventListener("blur", release);
    return () => {
        view.removeEventListener("keydown", keydown, true);
        view.removeEventListener("keyup", keyup, true);
        view.removeEventListener("blur", release);
    };
}
