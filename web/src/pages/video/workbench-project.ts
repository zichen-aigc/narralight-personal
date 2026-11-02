export function workbenchProjectId(profile: string | undefined, status: string) {
    return profile === "personal_local" && status === "personal" ? "video-workbench" : "";
}
export async function verifyWorkbenchProject(projectId: string, profile: string | undefined) {
    if (profile !== "personal_local" || projectId !== "video-workbench") throw new Error("本地工作台尚未就绪");
}
