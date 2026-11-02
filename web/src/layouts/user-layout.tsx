import { AppTopNav } from "@/components/layout/app-top-nav";
import { AppSidebar, MobileBottomNavigation } from "@/components/layout/app-sidebar";
import { AgentPanel } from "@/components/agent/agent-panel";
import { ReactNode } from "react";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    const { pathname } = useLocation();

    const immersiveCanvas = /^\/canvas\/[^/]+/.test(pathname);

    useEffect(() => {
        const needsCanvas = immersiveCanvas || pathname === "/" || pathname === "/canvas";
        const needsAssets = immersiveCanvas || ["/assets", "/image", "/video"].includes(pathname);
        const tasks: Array<Promise<void> | void> = [];
        if (needsCanvas && !useCanvasStore.persist.hasHydrated()) tasks.push(useCanvasStore.persist.rehydrate());
        if (needsAssets && !useAssetStore.persist.hasHydrated()) tasks.push(useAssetStore.persist.rehydrate());
        void Promise.all(tasks);
    }, [false, immersiveCanvas, pathname]);

    if (immersiveCanvas) {
        return (
            <div className="flex h-dvh overflow-hidden bg-background text-foreground">
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <AppTopNav />
                    <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
                </div>
                <AgentPanel />
            </div>
        );
    }

    return (
        <div className="nl-app-shell">
            <a className="nl-skip-link" href="#main-content">
                {t("navigation.skipToMain")}
            </a>
            <AppSidebar />
            <div className="nl-app-column">
                <AppTopNav />
                <div id="main-content" className="nl-app-content">
                    {children}
                </div>
                <MobileBottomNavigation />
            </div>
            <AgentPanel />
        </div>
    );
}
