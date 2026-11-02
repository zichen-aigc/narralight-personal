import { type LucideIcon } from "lucide-react";
import { ArrowLeftRight, FileText, Home, ImagePlus, Images, Maximize2, Settings2, Video } from "lucide-react";

export type AppNavigationItem = {
    key: string;
    path: string;
    labelKey: string;
    icon: LucideIcon;
};

export type AppNavigationGroup = {
    key: string;
    labelKey: string;
    items: AppNavigationItem[];
};

export const appNavigationGroups: AppNavigationGroup[] = [
    {
        key: "create",
        labelKey: "navigation.groups.create",
        items: [
            { key: "projects", path: "/", labelKey: "navigation.projects", icon: Home },
            { key: "canvas", path: "/canvas", labelKey: "navigation.canvas", icon: Maximize2 },
            { key: "image", path: "/image", labelKey: "navigation.image", icon: ImagePlus },
            { key: "video", path: "/video", labelKey: "navigation.video", icon: Video },
        ],
    },
    {
        key: "library",
        labelKey: "navigation.groups.library",
        items: [
            { key: "assets", path: "/assets", labelKey: "navigation.assets", icon: Images },
            { key: "prompts", path: "/prompts", labelKey: "navigation.prompts", icon: FileText },
            { key: "format-converter", path: "/format-converter", labelKey: "navigation.formatConverter", icon: ArrowLeftRight },
            { key: "config", path: "/config", labelKey: "navigation.config", icon: Settings2 },
        ],
    },
];

export const appNavigationItems = appNavigationGroups.flatMap((group) => group.items);

export function isAppNavigationItemActive(pathname: string, path: string) {
    return path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);
}
