import { throwApiError } from "@/services/api-error";

export type StorageCategoryUsage = { bytes: number; files: number };
export type LocalStorageUsage = {
    dataRoot: string;
    totalBytes: number;
    totalFiles: number;
    databaseBytes: number;
    objects: StorageCategoryUsage;
    backups: StorageCategoryUsage;
    agent: StorageCategoryUsage;
    logs: StorageCategoryUsage;
    disk: { totalBytes: number; freeBytes: number; usedBytes: number };
};

export async function readLocalStorageUsage(): Promise<LocalStorageUsage> {
    const response = await fetch("/api/local/storage/usage");
    if (!response.ok) await throwApiError(response, "本地存储使用情况读取失败");
    return (await response.json()) as LocalStorageUsage;
}
