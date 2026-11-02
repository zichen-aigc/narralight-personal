import { apimartGrokOfficialVideoCapabilitiesFor } from "./apimart-grok-official-video";
import { isGrokApimartVideoModel } from "./grok-apimart-video";
import { runningHubGrokCapabilitiesFor } from "./runninghub-grok-video";

export function grokVideoPromptGuide(model: string | undefined, imageCount = 0) {
    const official = apimartGrokOfficialVideoCapabilitiesFor(model);
    const runningHub = runningHubGrokCapabilitiesFor(model);
    if (!official && !runningHub && !isGrokApimartVideoModel(model)) return undefined;
    const workflow = official?.workflow === "video_edit" ? "video_edit" : runningHub?.workflow || (imageCount ? "multi_image" : "text_to_video");
    const modes = {
        text_to_video: { title: "文生视频", structure: "主体与环境 → 动作与变化 → 运镜 → 风格与连续性", example: "清晨的室内，一名穿灰色外套的男子走向窗边，缓慢转头。镜头从侧面平稳推进，柔和自然光，动作连贯。" },
        first_frame: { title: "单图生视频", structure: "画面要保留的特征 → 人物与环境怎样动 → 运镜 → 结束状态", example: "保持图片中的人物、服装与环境一致。人物缓慢转头，发丝轻微摆动，镜头稳定推进，最后停在面部近景。" },
        multi_image: { title: "参考图生成视频", structure: "每张图片的参考用途 → 人物关系与场景 → 动作 → 运镜与风格", example: "第一张参考人物外貌，第二张参考服装，第三张参考室内环境。人物推门进屋后走向窗边，镜头从身后缓慢跟随，光线与外观连续。" },
        video_edit: { title: "视频编辑", structure: "要修改的内容 → 要保留的人物、动作与镜头 → 整体效果", example: "将环境改为温暖的黄昏光线，保留原视频人物的外貌、动作节奏和镜头运动，画面自然连贯。" },
        video_extend: { title: "视频续写", structure: "原片结尾状态 → 接下来发生的动作 → 连续运镜 → 新结束状态", example: "接着原片结尾继续，人物向前走两步后停下，镜头保持原方向缓慢跟随，光线与人物外观连续。" },
    };
    const guide = { ...(modes[workflow as keyof typeof modes] || modes.multi_image) };
    if (workflow === "multi_image" && imageCount === 1) guide.example = "人物外貌与服装参考第一张图。人物推门进屋后走向窗边，镜头从身后缓慢跟随，光线与外观连续。";
    if (workflow === "multi_image" && imageCount === 2) guide.example = "人物外貌与服装参考第一张图，室内环境参考第二张图。人物推门进屋后走向窗边，镜头从身后缓慢跟随，光线与外观连续。";
    const limit = official
        ? official.workflow === "video_edit"
            ? "只接受一段待编辑原片；不提供参考图、音频参考、输出时长或比例设置。平台保护上限为30秒、200MB；供应商未公布固定上限。"
            : `未添加图片时为文生视频；添加图片后为参考图生成。平台最多接收${official.platformImageLimit}张图，本地上传单图不超过20MB；这些是平台保护，供应商未公布固定张数上限。`
        : isGrokApimartVideoModel(model)
            ? "Ext 接受最多7张参考图，多图分别控制外貌、服装等用途的效果仍需验证；输出比例跟随图片。"
            : runningHub?.workflow === "multi_image" ? "接受1–7张参考图，用于主体与风格引导。"
                : runningHub?.workflow === "first_frame" ? "只接受一张图片；提示词描述该画面接下来的变化。"
                    : runningHub?.workflow === "text_to_video" ? "此模式不接受图片、视频或音频素材。"
                        : runningHub?.workflow === "video_extend" ? "只接受一段源视频，6秒或10秒表示新增长度。" : "只接受一段待编辑原片。";
    return { ...guide, limit, note: "可用素材引用按钮点选图片，系统按素材栏顺序转换为普通文字说明；具体遵循程度以生成结果为准。" };
}
