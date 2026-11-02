# Narralight 本机 H3 Worker（可选）

Windows ComfyUI 与叙光的任务桥接：配对、Ed25519签名、串行领取任务、工作流编译、取消与恢复、分块上传和结果校验。Node.js 24，无额外 npm 依赖。

**先安装叙光，H3不是核心安装的前置条件。** 硬件评估、配置和配对步骤见 [H3本地搭建](../docs/H3_LOCAL_SETUP.md)。模型、ComfyUI、GPU驱动不随仓库分发，代码 MIT 不替代模型许可。

config.json、certs/、data/均忽略，勿提交身份或运行数据。开发检查在本目录运行 `npm test` 和 `npm run check`；协议/工作流测试不能代替真实GPU验收。

仅连接本机服务，配置与身份保存在你的设备上。
