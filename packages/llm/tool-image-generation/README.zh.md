# @deepseek-ai/dsh-tool-image-generation

[English](README.md) | 中文

`generate_image` 工具让纯文本主模型也能透明地生成图片：模型用描述调用工具，工具把生成请求路由给已配置的图片理解模型的提供方（与图片中转使用同一个 `agent-vision-model` 选择），把结果保存到会话工作区的 `generated-images/` 目录，并返回本地文件路径。模型永远不会看到图片字节——工具结果是文本——因此不需要支持图片的主模型。

不存在专门的生成配置。端点由提供方自己的 profile 推导：OpenAI 兼容路由调用 `{baseURL}/v1/images/generations`；MiniMax 的 anthropic-messages 路由（`.../anthropic`）调用其原生 `{baseURL}/v1/image_generation`。无法生成的提供方——未配置图片理解模型、没有存储的密钥、端点拒绝——都会带着端点自己的响应大声失败，由模型向用户报告。

工具注册进宿主 `tools` 注册表；agent preset 按 agent 挂载该行。生成的文件落在会话工作区下，与其他 agent 创建的文件一样出现在产物行中。

## 模型体验

工具调用与结果是普通的 `tool/call` + `tool/result` 事件：prompt 模型可见、返回的路径模型可见，两者都可以从会话日志重建。图片字节本身不进入模型视图。

#### KV 缓存影响

除普通工具调用表面外没有额外影响。

## 已知限制与延期工作

- 只产出 PNG 光栅图；格式/尺寸选项跟随提供方自己的方言，模型具名时透传。
- 提供方的生成端点按协议推导；在其它路径提供图片的网关需要自定义端点行。
