// @rc-component/portal 2.2.1 schedules a state update on every passive effect,
// even when its container is unchanged. With React 19, rapid editor updates can
// exceed the nested-update limit. Transform the pinned module at build time so
// installed dependencies stay untouched; preserve dynamic container changes.
/** @returns {import("vite").Plugin} */
export function portalContainerGuard() {
    return {
        name: "stable-portal-container",
        enforce: "pre",
        transform(code, id) {
            if (!id.replaceAll("\\", "/").endsWith("/@rc-component/portal/es/Portal.js")) return null;
            const original = /setInnerContainer\(\(\) =>\s*\/\/ React do the state update even the value is the same,\s*\/\/ Use function call to force React to compare update\s*customizeContainer \?\? null\);/;
            if (!original.test(code)) throw new Error("Portal container guard needs review for the installed dependency version");
            return {
                code: code.replace(original, "const nextContainer = customizeContainer ?? null;\n    if (innerContainer !== nextContainer) setInnerContainer(nextContainer);"),
                map: null,
            };
        },
    };
}
