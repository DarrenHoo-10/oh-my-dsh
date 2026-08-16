# @deepseek-ai/dsh-agent-vision-model

[English](README.md) | 中文

当路由会话模型无法接收图片时，宿主图片中转会请这个可选的图片理解模型先把图片描述成文本。`AgentVisionModelConfig` 提供 `ctx.agentVisionModel`；ApiProxy 的 prompt 准入在拒绝带图 prompt 之前会先读取 `currentSelection()`。

插件配置可选，默认留空：`{ provider, model }` 必须成对提供，`maxOutputTokens`（默认 1024）限制中转输出，`timeoutMs`（默认 30,000）限制中转调用。该组合项是 `agent-vision-model` 设置段的基座；挂载设置提供方后，用户的选择叠加在其上，下一次读取 `currentSelection()` 即可见。未配置时，向不支持图片的模型发送带图 prompt 维持原有的拒绝行为。

- `ctx.agentVisionModel.currentSelection()` 返回校验过的 `{ provider, model, maxOutputTokens, timeoutMs }`，未配置时为 `undefined`。
- `ctx.agentVisionModel.saveSelection(selection)` 保存完整的用户选择。没有设置提供方时为空操作，组合项保持生效。

中转每次分发会记录一条 `session/vision-transcription` 事件（精确的路由、系统提示、消息与 token 上限），因此路由模型看到的文本可以从会话日志重建。用户自己的消息保留在表面会话中；中转描述以 `surfaceOp: replace` 副本进入模型视图，聊天展示原始图片与问题，轨迹中两者（中转事件与描述）都可见。

## 模型体验

间接影响：中转得到的描述文本（以 `【图片已由视觉模型理解】` 为前缀）以模型专用替换副本的形式到达路由模型；中转调用本身是一次模型请求，由 `session/vision-transcription` 事件记录。

#### KV 缓存影响

中转使用固定系统提示与随 prompt 变化的图片内容，其前缀不与会话共享缓存。描述文本作为普通用户文本进入路由会话。

## 已知限制与延期工作

- 中转只覆盖 prompt 中的图片。工具结果携带的图片（`read_image`）仍由工具自身的能力门禁拒绝。
- 会话切换到纯文本模型后仍保留带图历史；向新模型重放该历史会被适配器拒绝，因此只有配置了中转时才允许切换，且切换后发送的图片会走中转。
