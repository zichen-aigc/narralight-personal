import { AssetValidationBatchButton } from "@/components/asset-validation-control";
import { assetValidationRef, dedupeVolcAssetReferences, type VolcAssetValidationReference } from "@/services/volc-asset-validation";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export function canvasVolcValidationReferences(projectId: string, references: CanvasResourceReference[]): VolcAssetValidationReference[] {
    return dedupeVolcAssetReferences(references.filter((reference) => reference.kind === "image" || reference.kind === "video" || reference.kind === "audio").map((reference) => ({
        localRef: assetValidationRef({ storageKey: reference.storageKey, assetId: reference.sourceAssetId, projectId, nodeId: reference.nodeId }),
        projectId,
        mediaKind: reference.kind as "image" | "video" | "audio",
        title: reference.title,
        previewUrl: reference.previewUrl,
    })));
}

export function CanvasVideoAssetValidationButton({ projectId, config, references }: { projectId: string; config: AiConfig; references: CanvasResourceReference[] }) {
    return <AssetValidationBatchButton config={config} references={canvasVolcValidationReferences(projectId, references)} />;
}
