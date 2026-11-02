import { volcAssetGenerationStatusTone, volcAssetStatusTone, type VolcAssetBinding, type VolcAssetGenerationStatus, type VolcAssetStatusTone, type VolcAssetValidationStatus } from "@/services/volc-asset-validation";

export const ASSET_STATUS_TOOLTIP_DELAY_SECONDS = 0.7;

export type AssetValidationIndicator = { kind: "review"; status: VolcAssetValidationStatus; tone: VolcAssetStatusTone } | { kind: "generation"; status: VolcAssetGenerationStatus; tone: VolcAssetStatusTone };

export function buildAssetValidationIndicators(binding?: Pick<VolcAssetBinding, "classification" | "status" | "generationStatus">): AssetValidationIndicator[] {
    const status = binding?.status || "unverified";
    const indicators: AssetValidationIndicator[] = [{ kind: "review", status, tone: volcAssetStatusTone(status) }];
    if (binding?.classification === "real_person" && status === "active") {
        const generationStatus = binding.generationStatus || "unverified";
        indicators.push({ kind: "generation", status: generationStatus, tone: volcAssetGenerationStatusTone(generationStatus) });
    }
    return indicators;
}
