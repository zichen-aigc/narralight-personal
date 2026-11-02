<div align="left">

# 叙光
### 把想法、素材和生成过程，放到同一张画布上。

Narralight 是面向个人创作者的本地 AI 创作工作台。连接素材、组织提示词、生成图像与视频，再把结果留在自己的项目中。

**本地运行 · 独立个人数据 · MIT 开源 · 可选本机 H3**

[开始安装](#开始安装) · [交给 AI 安装](docs/AGENT_INSTALL.md) · [功能介绍](#可以用它做什么) · [可选 H3](docs/H3_LOCAL_SETUP.md)

</div>

---

## 可以用它做什么

| 创作环节 | 叙光提供的能力 |
| --- | --- |
| 整理想法 | 无限画布组织文字、图片、视频与节点连线，让参考与创作上下文放在一起 |
| 图像与视频创作 | 在画布中选择已配置的模型渠道、填写提示词与参数，保留生成状态和视频版本 |
| 复用提示词 | 提示词库整理常用内容，减少在不同工具间反复复制 |
| 准备素材 | 文档转换、视频取帧等工具，把已有内容用于后续创作 |
| Agent 协作 | Canvas Agent 提供画布交互桥接；外部 Codex 等工具需自行安装和登录 |
| 本机视频生成（可选） | 在支持的 Windows 机器接入 H3 Worker 和 ComfyUI，无需把 H3 当成安装前置条件 |

一条常见路径：**导入参考 → 编排画布 → 写提示词 → 选择模型 → 查看结果 → 保存项目**。
模型渠道需自己配置；源码公开不等于附送云端额度，未接入的渠道不能直接生成。

## 开始安装

优先安装叙光核心工作台。**不需要先安装 H3，也不需要先下载大模型。** 当前验证环境为 Windows；macOS/Linux 尚未验收。需要 Git、Node.js 24、npm 和 Bun 1.3.14。

### 方式一：让 AI Agent 安装并修复问题

复制下面这段给能操作你本机的 Codex、WorkBuddy、Claude Code 等 Agent：

```text
请实际帮我安装并启动叙光：https://github.com/zichen-aigc/narralight-personal 。先读取 README.md 和 docs/AGENT_INSTALL.md，按其中流程检查环境、安装依赖、构建、启动并验证画布保存和刷新恢复。遇到问题请查看日志、诊断原因、在保留数据和现有修改的前提下继续修复并复验，不要只给教程或遇错就停。最后交付访问地址、安装/数据位置、启动/停止/更新方法和实际检查结果；确实需要我的权限或凭据时再问具体缺失项，无法解决的外部阻碍如实说明。主要目标是叙光正常可用；H3完全可选，仅在我另行选择且机器经过GPU/显存/内存/磁盘/系统兼容评估后安装，不默认下载模型、不调用付费生成，不影响叙光核心交付。
```

完整的 [Agent 安装与补救指令](docs/AGENT_INSTALL.md) 包括失败处理和验收清单。Agent 需要终端/文件权限；纯聊天窗口无法代替本机安装，也不能保证修复硬件或外部网络限制。

### 方式二：手动安装

```sh
git clone https://github.com/zichen-aigc/narralight-personal.git
cd narralight-personal
node scripts/setup.mjs
node start-personal.mjs
```

打开 **http://127.0.0.1:3000**，保持启动终端开启。平台和 Agent 使用17372、17371，全部仅监听本机；端口占用时启动器会拒绝混用已有服务。停止用 Ctrl+C；以后仍在仓库根目录执行 `node start-personal.mjs`。

这是可克隆运行的源码仓库，尚未提供托管在线工作台。GitHub 地址不是产品登录页。

## 可选加分项：H3 本地生成

叙光已经装好、机器也适合，再看 [H3 本地搭建指南](docs/H3_LOCAL_SETUP.md)。仓库包含 Worker 源码、测试、配置示例、固定 ComfyUI 工作流和 Windows 启动/配对工具。

当前接入文生视频、单首帧及首尾帧，5/10秒档、横竖方三种画幅、带声音MP4。它不包含 H3 官方所有能力。H3需另外准备 ComfyUI、匹配权重和硬件；不支持就跳过。模型遵循各自许可，不随本仓库分发。

## 数据与更新

数据默认在用户目录 `.narralight-personal`，可用 `NARRALIGHT_PERSONAL_DATA_ROOT` 指定独立位置。数据和模型配置保存在本机；不要分享数据目录、浏览器配置或Worker身份。

停止个人版、备份数据后，在仓库根目录运行：

```sh
node scripts/update.mjs
```

更新要求 main 分支和干净工作区，使用 fast-forward 拉取此公开仓并重建；不覆盖已有修改。H3的个人配置/身份被Git忽略，ComfyUI及模型不自动升级。

## 使用条件与验证范围

- 云端模型使用自己的渠道和密钥，调用可能产生供应商费用。不同模型功能、参数和限制以具体接入为准。
- 部分供应商的临时媒体公网中继需自行安装 cloudflared，通过 `INFINITE_CANVAS_CLOUDFLARED_PATH` 指定可执行路径；按你的网络环境配置。
- 首版平台、Agent、插件依赖实际安装，Web构建和服务冒烟通过。前端构建复用了锁文件一致的本机依赖，Bun全新联网安装未完成，完整新机安装仍待验证。
- H3协议与个人接入使用隔离测试验收；GPU生成、模型下载、新机硬件性能和所有供应商真实调用不在本次验证范围。

## 许可证与来源

采用 [MIT](LICENSE) 许可证，保留原作者 basketikun 的版权声明。本项目基于 [Infinite Canvas](https://github.com/basketikun/infinite-canvas) / Narralight 衍生开发；第三方说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 及依赖许可证。模型权重和外部服务另遵循各自条款。
