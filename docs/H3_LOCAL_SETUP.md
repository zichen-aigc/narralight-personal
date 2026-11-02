# 可选：Windows 本机 H3

**先装好叙光，再决定是否装 H3。** H3 是加分项，不是必装项；不装也能使用画布、素材、提示词和已配置的云端模型。更新仓库不会自动下载大模型。

## 判断机器是否适合

Worker 用 Windows 当前用户 DPAPI 保护私钥，这套步骤仅支持 Windows。先用任务管理器或 nvidia-smi 记录 NVIDIA GPU/显存、内存和可用磁盘，再核对驱动、ComfyUI、PyTorch/CUDA 与显卡兼容性。驱动显示的 CUDA 上限不等于 PyTorch 的运行版本。

已有本地搭建参考：RTX 4070（12 GB）、约64 GB内存，ComfyUI 0.42.1、PyTorch 2.14.0+cu130，低显存模式、CPU文本编码器。**这是参考配置，不是最低配置保证，也不代表本次公开版已完成 GPU 生成验收。** 其他机器须实测。下载前核对四个权重的总大小，另留运行环境、解压、缓存和视频空间；条件不足就跳过。

官方来源：[ComfyUI H3 指南](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)、[Comfy-Org 模型文件](https://huggingface.co/Comfy-Org/MiniMax-H3)。代码 MIT 不替代模型许可；使用权重和输出前阅读模型条款及官方商业授权说明。资料核对于2026-11-02。

## 准备 ComfyUI 和模型

从 [ComfyUI 官方仓库](https://github.com/Comfy-Org/ComfyUI) 取得支持 H3 原生节点的 Windows portable。此工作流不需自定义节点。参考版本升级后需复查节点和启动参数；不要使用来源不明的整合包。

默认 H3 根目录是用户目录下的 `Narralight-H3`，也可自选有足够空间的位置。目录结构：

```text
Narralight-H3/
  app/ComfyUI_windows_portable/
    python_embeded/python.exe
    ComfyUI/main.py
  models/
    diffusion_models/minimax_h3_fl2va_pruned_w6a8.safetensors
    text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors
    vae/minimax_h3_video_vae_int8_convrot.safetensors
    vae/minimax_h3_audio_vae_fp32.safetensors
```

四个文件在上方模型仓库各同名子目录取得；不要下载整个模型仓库。脚本将 models 目录传给 ComfyUI，并创建 input、outputs、temp、user、logs。模型和输出不要放进 Git。另需 Node.js 24 和能运行的 `ffprobe -version`；ffprobe 可用可信安装的完整路径配置。

## 配置与配对

先正常启动叙光。以下命令在**仓库根目录 PowerShell**执行：

```powershell
Copy-Item local-h3-worker/config.example.json local-h3-worker/config.json
node local-h3-worker/scripts/pair-personal.mjs
```

已有 config.json 时跳过复制，先备份核对，避免覆盖身份。配对脚本确认目标是叙光后，在内存中取一次性配对码，生成独立 Worker 身份；不复用其他安装的身份。必须使用同一 Windows 用户配对和运行。

| 配置 | 默认值/含义 |
| --- | --- |
| serverBaseUrl | http://127.0.0.1:17372，个人平台 |
| allowInsecureLoopback | true，仅本机 HTTP，不能据此使用局域网明文 |
| serverCaPath | null，本机连接无需 CA |
| comfyBaseUrl | 固定 http://127.0.0.1:8188 |
| workflowPath | workflow/h3-base-4070-api.json |
| workflowSha256 | 3d177045457dc8191f4ad646c4b61fa4d8531c182c5f281d160a7a3f0055bb47 |
| ffprobePath | ffprobe 或可信可执行文件完整路径 |
| data/ | 私钥、账本、上传缓存，被 Git 忽略 |

相对路径以配置文件目录解析。不要改哈希绕过校验，模板/平台/Worker合同需要共同维护。

## 启动与检查

```powershell
powershell -NoProfile -File local-h3-worker/scripts/Start-H3Worker.ps1
```

自选根目录示例：

```powershell
powershell -NoProfile -File local-h3-worker/scripts/Start-H3Worker.ps1 -H3Root 'D:\AI Tools\Narralight-H3'
```

脚本只在8188没有监听时启动 ComfyUI，使用回环地址、lowvram、offline、禁用自定义节点，再启动 Worker。若已有 ComfyUI，先核对模型目录、版本及监听地址。脚本不自动下载模型，也不替换运行实例。保持 Worker 终端运行，在另一终端检查：

```powershell
node local-h3-worker/src/cli.mjs doctor --config local-h3-worker/config.json
Invoke-RestMethod http://127.0.0.1:17372/api/local/h3/status
```

doctor 检查模板、ffprobe、ComfyUI连接和身份，不加载大模型，不能证明生成成功。确认平台 Worker 在线后，在叙光选择“本机 H3 Worker / local-h3-base”，手动提交小任务，验收视频播放、声音和归档，才算该机器完整可用。

当前接入：文生视频、单首帧、首尾帧；5/10秒；864×480、480×864、640×640；带声音MP4、24fps、固定12步。5秒档124帧（约5.17秒），10秒档243帧（约10.13秒）。不含视频/音频参考、Turbo、任意分辨率及官方其他工作流。一次处理一个任务，支持排队、取消、签名认证和恢复。

## 补救与维护

| 问题 | 处理 |
| --- | --- |
| 目标不是叙光 | 核对17372进程和启动档，不关闭身份检查 |
| 配对中断/pending身份 | 执行下方 recover-pair，不删密钥重新撞配对 |
| DPAPI失败 | 用原 Windows 用户；换机器/用户需新身份，勿复制他人的私钥 |
| 缺模型/节点/参数 | 对照文件名、目录、版本和日志，不随意改模板哈希 |
| ffprobe不可用 | 填真实完整路径并验证可执行 |
| GPU/内存不足 | 停止新任务、查看内存，不并发；不适合则停H3继续用叙光 |
| Worker离线 | 检查平台、ComfyUI、Worker三个进程和端口，不反复配对掩盖问题 |

```powershell
node local-h3-worker/src/cli.mjs recover-pair --config local-h3-worker/config.json
```

Ctrl+C 停 Worker；脚本后台启动的 ComfyUI 会保留。退出时核对8188进程路径并关闭该实例，不结束其他项目Python。手动运行稳定后可自行执行 `Install-H3WorkerTask.ps1` 注册当前用户登录任务（支持 -H3Root）；不默认注册、不覆盖同名任务，也不会代启动叙光平台。停用可在任务计划程序删除 `Narralight Personal H3 Worker`。

更新前停Worker，备份个人数据及Worker的config.json/data，再用主仓库 `node scripts/update.mjs`。被Git忽略的身份和配置不被覆盖；对照新版config.example.json合并新增项。ComfyUI和权重不自动升级。
