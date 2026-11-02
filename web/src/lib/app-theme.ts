import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

const neutral = {
    light: {
        primary: "#171813",
        primaryHover: "#070807",
        primaryText: "#f0eddc",
        elevatedBg: "#f4f0df",
        itemHoverBg: "rgba(23, 24, 19, 0.07)",
        itemSelectedBg: "rgba(23, 24, 19, 0.11)",
        itemSelectedHoverBg: "rgba(23, 24, 19, 0.15)",
        itemText: "#171813",
        tableSelectedBg: "rgba(23, 24, 19, 0.06)",
        tableSelectedHoverBg: "rgba(23, 24, 19, 0.1)",
    },
    dark: {
        primary: "#e5e1cd",
        primaryHover: "#f0eddc",
        primaryText: "#070807",
        elevatedBg: "#151714",
        itemHoverBg: "rgba(229, 225, 205, 0.08)",
        itemSelectedBg: "rgba(229, 225, 205, 0.13)",
        itemSelectedHoverBg: "rgba(229, 225, 205, 0.18)",
        itemText: "#f0eddc",
        tableSelectedBg: "rgba(229, 225, 205, 0.08)",
        tableSelectedHoverBg: "rgba(229, 225, 205, 0.12)",
    },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? neutral.dark : neutral.light;

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "infinite-canvas-dark" : "infinite-canvas-light" },
        token: {
            fontFamily: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif',
            borderRadius: 10,
            borderRadiusLG: 12,
            controlHeight: 40,
            colorPrimary: color.primary,
            colorInfo: color.primary,
            colorLink: color.primary,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
            colorBgElevated: color.elevatedBg,
            controlItemBgHover: color.itemHoverBg,
            controlItemBgActive: color.itemSelectedBg,
            controlItemBgActiveHover: color.itemSelectedHoverBg,
        },
        components: {
            Button: {
                primaryShadow: "none",
                borderRadius: 10,
                fontWeight: 620,
            },
            Input: { activeShadow: "none", borderRadius: 10 },
            Modal: { borderRadiusLG: 16 },
            Drawer: { colorBgElevated: color.elevatedBg },
            Dropdown: {
                colorBgElevated: color.elevatedBg,
                colorText: color.itemText,
                controlItemBgHover: color.itemHoverBg,
                controlItemBgActive: color.itemSelectedBg,
                controlItemBgActiveHover: color.itemSelectedHoverBg,
            },
            Menu: {
                popupBg: color.elevatedBg,
                itemActiveBg: color.itemSelectedBg,
                itemHoverBg: color.itemHoverBg,
                itemSelectedBg: color.itemSelectedBg,
                itemSelectedColor: color.itemText,
                darkPopupBg: neutral.dark.elevatedBg,
                darkItemHoverBg: neutral.dark.itemHoverBg,
                darkItemSelectedBg: neutral.dark.itemSelectedBg,
                darkItemSelectedColor: neutral.dark.itemText,
            },
            Select: {
                optionActiveBg: color.itemHoverBg,
                optionSelectedBg: color.itemSelectedBg,
                optionSelectedColor: color.itemText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}
