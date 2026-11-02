import { UserStatusActions } from "@/components/layout/user-status-actions";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { Button, Tooltip } from "antd";
import { Bot, Menu } from "lucide-react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";

import { appNavigationItems } from "@/constant/app-navigation";

import { useEffect, useRef, useState } from "react";

import { useAgentStore } from "@/stores/use-agent-store";

export function AppTopNav() {
    const { t } = useTranslation();

    const { pathname } = useLocation();

    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    const autoConnectRef = useRef(false);

    const agentToken = useAgentStore((state) => state.token);

    const agentEnabled = useAgentStore((state) => state.enabled);

    const agentConnected = useAgentStore((state) => state.connected);

    const connectAgent = useAgentStore((state) => state.connectAgent);

    const togglePanel = useAgentStore((state) => state.togglePanel);

    const panelOpen = useAgentStore((state) => state.panelOpen);

    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);

    const activeItem = appNavigationItems.find((item) => (item.path === "/" ? pathname === "/" : pathname === item.path || pathname.startsWith(`${item.path}/`)));

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;

        autoConnectRef.current = true;

        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <>
            {!hideHeader ? (
                <header className="nl-globalbar">
                    <div className="nl-global-path">
                        <button
                            type="button"

                            className="nl-mobile-menu md:hidden"

                            onClick={() => setMobileNavOpen(true)}

                            aria-label={t("topNav.openMenu")}

                            title={t("topNav.menu")}
                        >
                            <Menu />
                        </button>

                        <span>{t("brand.name")}</span>

                        <span aria-hidden="true">/</span>

                        <strong>{activeItem ? t(activeItem.labelKey) : t("meta.title")}</strong>

                        <em>{t(pathname === "/" ? "topNav.liveProjects" : "topNav.workspace")}</em>
                    </div>

                    <div className="nl-global-tools">
                        <Tooltip title={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")}>
                            <Button type="text" shape="circle" className="nl-global-icon" icon={<Bot />} onClick={togglePanel} aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")} />
                        </Tooltip>

                        <UserStatusActions mobileEssentialOnly />
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} pathname={pathname} onClose={() => setMobileNavOpen(false)} />

            <AppConfigModal />
        </>
    );
}
