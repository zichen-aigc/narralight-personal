export function resolveDeploymentProfile(value = process.env.INFINITE_CANVAS_DEPLOYMENT_PROFILE) {
    const profile = String(value || "personal_local").trim();
    if (profile !== "personal_local") throw Object.assign(new Error("此应用仅支持本机运行配置"), { code: "deployment_profile_invalid" });
    return profile;
}
export function deploymentProfileMetadata() {
    return { profile: "personal_local", instanceKind: "standard", authRequired: false };
}
