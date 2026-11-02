import { Link } from "react-router";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";

import { appNavigationGroups, isAppNavigationItemActive } from "@/constant/app-navigation";
import { cn } from "@/lib/utils";

export function AppSidebar() {
    const { t } = useTranslation();
    const { pathname } = useLocation();

    return (
        <aside className="nl-sidebar" aria-label={t("topNav.navigation")}>
            <Link to="/" className="nl-brand" aria-label={t("navigation.projects")}>
                <span className="nl-brand-mark" aria-hidden="true" />
                <span>
                    <strong>{t("brand.name")}</strong>
                    <small>Narralight</small>
                </span>
            </Link>

            <div className="nl-workspace-identity">
                <span className="nl-workspace-emblem" aria-hidden="true">
                    叙
                </span>
                <span>
                    <strong>{t("workspace.personal")}</strong>
                    <small>{t("workspace.localData")}</small>
                </span>
            </div>

            <nav className="nl-sidebar-nav">
                {appNavigationGroups.map((group) => {
                    const items = group.items.filter((item) => true);
                    if (!items.length) return null;
                    return (
                        <div key={group.key} className="nl-sidebar-group">
                            <span className="nl-sidebar-label">{t(group.labelKey)}</span>
                            {items.map((item) => {
                                const Icon = item.icon;
                                const active = isAppNavigationItemActive(pathname, item.path);
                                return (
                                    <Link key={item.key} to={item.path} className={cn("nl-sidebar-link", active && "is-active")} aria-current={active ? "page" : undefined}>
                                        <Icon aria-hidden="true" />
                                        <span>{t(item.labelKey)}</span>
                                    </Link>
                                );
                            })}
                        </div>
                    );
                })}
            </nav>

            <div className="nl-sidebar-foot">
                <span className="nl-sidebar-avatar" aria-hidden="true">
                    {"叙".slice(0, 1)}
                </span>
                <span>
                    <strong>{t("workspace.localCreator")}</strong>
                    <small>{t("workspace.creationWorkbench")}</small>
                </span>
            </div>
        </aside>
    );
}

export function MobileBottomNavigation() {
    const { t } = useTranslation();
    const { pathname } = useLocation();

    const items = appNavigationGroups.flatMap((group) => group.items).filter((item) => ["projects", "canvas", "image", "assets", "config"].includes(item.key) && true);

    return (
        <nav className="nl-mobile-bottom" aria-label={t("navigation.mobilePrimary")}>
            {items.map((item) => {
                const Icon = item.icon;
                const active = isAppNavigationItemActive(pathname, item.path);
                return (
                    <Link key={item.key} to={item.path} className={cn(active && "is-active")} aria-current={active ? "page" : undefined}>
                        <Icon aria-hidden="true" />
                        <span>{t(item.labelKey)}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
