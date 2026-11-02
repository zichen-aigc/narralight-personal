export const APP_VERSION = typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "dev";

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://github.com/zichen-aigc/narralight-personal#readme";

// 本地安全版默认只读取仓库内已构建、已审核的官方插件清单。
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "/plugins/official-plugins.json";
