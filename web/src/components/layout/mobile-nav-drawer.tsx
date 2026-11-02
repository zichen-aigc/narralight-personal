import { UserStatusActions } from "@/components/layout/user-status-actions";
import { Link } from "react-router";
import { Drawer } from "antd";
import { useTranslation } from "react-i18next";
import { appNavigationGroups } from "@/constant/app-navigation";
import { cn } from "@/lib/utils";

type MobileNavDrawerProps = {
    open: boolean;
    pathname: string;
    onClose: () => void;
};

export function MobileNavDrawer({ open, pathname, onClose }: MobileNavDrawerProps) {
    const { t } = useTranslation();

    return (
        <Drawer title={t("topNav.drawerTitle")} placement="left" size={300} open={open} onClose={onClose} className="nl-mobile-drawer md:hidden">
            <div className="nl-mobile-drawer-nav">
                {appNavigationGroups.map((group) => {
                    const items = group.items.filter((item) => true);
                    if (!items.length) return null;
                    return (
                        <div key={group.key}>
                            <span>{t(group.labelKey)}</span>
                            {items.map((item) => {
                                const Icon = item.icon;
                                const active = item.path === "/" ? pathname === "/" : pathname === item.path || pathname.startsWith(`${item.path}/`);
                                return (
                                    <Link key={item.key} to={item.path} onClick={onClose} className={cn(active && "is-active")} aria-current={active ? "page" : undefined}>
                                        <Icon aria-hidden="true" />
                                        <span>{t(item.labelKey)}</span>
                                    </Link>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
            <div className="nl-mobile-drawer-tools">
                <span>{t("topNav.workspaceTools")}</span>
                <UserStatusActions showAccount={false} />
                <small>{t("topNav.workspaceToolsDescription")}</small>
            </div>
        </Drawer>
    );
}
