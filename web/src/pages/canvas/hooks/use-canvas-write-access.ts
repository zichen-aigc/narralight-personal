import { useCallback, useEffect, useState } from "react";

export type CanvasWriteAccessStatus = "loading" | "editor" | "readonly" | "offline";

export function useCanvasWriteAccess(projectId: string) {
    const [status, setStatus] = useState<CanvasWriteAccessStatus>("loading");

    const refresh = useCallback(async () => {
        if (!projectId) return setStatus("loading");
        return setStatus("editor");
    }, [false, projectId]);

    useEffect(() => {
        let active = true;
        const reload = () => active && void refresh();
        const handleOffline = () => active && setStatus("offline");
        void refresh();
        window.addEventListener("infinite-canvas:platform-offline", handleOffline);
        window.addEventListener("infinite-canvas:platform-online", reload);
        return () => {
            active = false;
            window.removeEventListener("infinite-canvas:platform-offline", handleOffline);
            window.removeEventListener("infinite-canvas:platform-online", reload);
        };
    }, [refresh]);

    return { status, isEditor: status === "editor" };
}
