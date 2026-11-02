import { apimartGrokOfficialVideoCapabilitiesFor } from "@/lib/apimart-grok-official-video";

import { type ApimartGrokOfficialPricing } from "@/services/api/apimart-grok-official-video";

import { isModelBackendSupported, probeBackendModelContracts, useBackendModelContracts } from "@/lib/backend-model-contract";

export function grokOfficialReadiness(model: string | undefined, pricing?: ApimartGrokOfficialPricing, error = "") {
    const capability = apimartGrokOfficialVideoCapabilitiesFor(model);

    if (!capability) return { canSubmit: true, reason: "" };

    if (error || pricing?.status === "blocked") return { canSubmit: false, reason: error || pricing?.message || "价格未验证，暂不能提交。" };

    if (!pricing) return { canSubmit: false, reason: "正在验证官方模型价格…" };

    const expires = Date.parse(pricing.expiresAt || "");

    const rate = pricing.models[capability.requestModel];

    const requiredResolutions = capability.workflow === "video_edit" ? ["720p"] : capability.resolutions;

    const validRate = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

    if (
        !Number.isFinite(expires) ||
        expires <= Date.now() ||
        !rate ||
        !requiredResolutions.every((resolution) => validRate(rate.rates[resolution]) && rate.rates[resolution] > 0) ||
        !validRate(rate.imageMicrousd) ||
        (capability.workflow === "video_edit" && !validRate(rate.videoMicrousd))
    )
        return { canSubmit: false, reason: "价格目录已过期或缺少当前型号，请重新打开页面刷新价格。" };

    if (capability.workflow === "video_edit" && pricing.editSourceRelayAvailable !== true) return { canSubmit: false, reason: "当前未配置公网素材中继，视频编辑暂不可提交。" };

    return { canSubmit: true, reason: "" };
}

export function useGrokOfficialReadiness(model: string | undefined) {
    const state = useBackendModelContracts();

    const official = Boolean(apimartGrokOfficialVideoCapabilitiesFor(model));

    const refreshedCatalog = useRef("");

    const expiresAt = state.pricing?.expiresAt;

    useEffect(() => {
        const expires = Date.parse(expiresAt || "");

        if (!official || state.status !== "supported" || false || !Number.isFinite(expires)) return;

        const key = `${state.context}:${expiresAt}`;

        if (refreshedCatalog.current === key) return;

        const refreshExpired = () => {
            if (Date.now() < expires || refreshedCatalog.current === key) return;

            refreshedCatalog.current = key;

            void probeBackendModelContracts();
        };

        // Refresh only the read-only price evidence. Never restart a generation.

        const timer = window.setTimeout(refreshExpired, Math.max(0, expires - Date.now() + 50));

        window.addEventListener("focus", refreshExpired);

        return () => {
            window.clearTimeout(timer);
            window.removeEventListener("focus", refreshExpired);
        };
    }, [official, state.status, state.context, state.pricing?.submissionPolicy, expiresAt]);

    if (!isModelBackendSupported(model)) return { canSubmit: false, reason: "当前后台尚未确认此型号合同；历史配置保留，只能查看或切换已支持的模型。" };

    return grokOfficialReadiness(model, state.pricing);
}

import { useEffect, useRef } from "react";
