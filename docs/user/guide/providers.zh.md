# 配置模型

[English](providers.md) | 中文

本指南假定你已按照[根 README](../../../README.md#run)启动 Web UI。模型变更会在下一次请求时生效，不需要重启服务器。

## 配置 DeepSeek

打开**设置 → 模型**。DeepSeek 卡片提供一个 API 密钥字段；输入密钥并保存。

![模型页：DeepSeek 卡片，以及添加提供方与添加自定义提供方两个入口](providers-models-page.zh.png)

密钥是只写的。保存后，页面只会收到脱敏描述符，永远不会收到明文密钥。密钥存储在 `$DSH_HOME/.credentials.yaml` 中，settings 只保留它的凭据引用。

## 添加目录提供方

选择**添加提供方**，选取 Anthropic 或 OpenAI 等提供方，输入其 API 密钥并保存。已安装目录会提供端点、协议和模型列表。

使用原生认证的提供方需要各自的原生凭据。Bedrock、Vertex、Azure 和 Codex 分别使用 AWS 凭据与区域、ADC 项目、`api-version` 和 OAuth；只填写 API 密钥字段无法完成配置。

## 添加自定义提供方

对于公司网关、自建服务器或已安装目录中不存在的提供方，选择**添加自定义提供方**。提供小写 Provider ID、基础 URL、API 协议、凭据和至少一个模型。

![自定义提供方表单：Provider ID、显示名称、API 地址、API 协议、API 密钥](providers-custom-form.zh.png)

Provider ID 是永久的，因为请求、已保存会话、模型默认值和凭据引用都会使用它。如需重命名提供方，请添加新提供方并删除旧提供方。显示名称、基础 URL、协议、凭据和模型仍可编辑。

在**模型目录**中选择**获取可用模型**，可查询表单当前显示的基础 URL 和凭据。选择候选项只会更新草稿；保存前不会存储提供方。目录提供方使用已安装目录，不发起网络请求。

### 图片输入

手动输入的模型在自己声明之前一律按纯文本对待，因为没有任何环节能去询问端点接受哪些模态。给这类模型附加图片，会在发送前就被拒绝，并点名该模型。

自定义提供方下的视觉模型，可以在该模型容量区域勾选**支持图片**来声明图片输入，也可以在 `$DSH_HOME/settings.yaml` 中写一行 `input`：

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: legacy-chat
        - id: vision-preview
          input: [text, image]
```

`input` 接受 `text` 和 `image`，且只作用于该模型，因此一条路由可以同时服务两类模型。省略它——或写成空列表，两者同义——则保留已安装目录为该模型记录的模态；目录未描述的模型则回退到该路由的 `defaultInput`。

如果你手动录入的模型全都接受图片，可以在路由上设置一次回退值，不必逐个模型写：

```yaml
llm-pi-ai:
  providers:
    vision-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://vision.example/v1
      defaultInput: [text, image]
      models:
        - id: first-model
        - id: second-model
```

`defaultInput` 是回退值而不是覆盖值，默认为 `[text]`：在目录提供方上，它只为目录未描述的模型作答，因此绝不会把目录中本就具备图片能力的模型的该能力去掉。要收窄这类模型，请用它自己的 `input`。目录提供方没有可供填写的 `models` 列表，因此写在 `modelOverrides` 下，以模型 id 为键：

```yaml
llm-pi-ai:
  providers:
    anthropic:
      modelOverrides:
        claude-sonnet-4-5:
          input: [text]
```

除模型自身的列表外，每个列表都至少要写一项模态；模型自身的空列表与省略它同义。未知模态在任何位置写入都会被拒绝。

这两个字段都是对你端点的断言，而不是对它的检查。声明了端点并不提供的图片能力的模型不会在这里被拦下，改由提供方拒绝该请求。

DeepSeek 提供方的目录模型默认仅文本；该路由上的自定义模型可以用同样方式声明图片输入——在其行上勾选**支持图片**，或在 `llm-deepseek` 设置段的 `input` 中写明。

### 图片理解模型

向不支持图片的模型发送图片时，除非在模型设置页配置了**图片理解模型**，否则会被拒绝。配置后，宿主会先请该模型描述图片，然后把文本描述（以 `【图片已由视觉模型理解】` 为前缀）而不是图片发给路由模型。聊天保留用户自己的图片与问题；中转描述仅模型可见，并出现在会话轨迹中。中转调用会记入会话日志；中转失败则拒绝本次发送。

## 选择模型

已配置的提供方会出现在模型选择器中。选择模型也会将其设为新会话的默认值。已发送过请求的会话会保留自身日志中记录的模型。

如果已保存默认值指向已删除的提供方，输入框会显示**选择模型**，并在选择其他模型前阻止输入。

## 排错

- **`MISSING_CREDENTIAL`**：通过模型页存储提供方密钥，或提供被引用的环境变量。
- **`UNKNOWN_MODEL`**：选择已配置的模型，或向自定义提供方添加缺失的模型。
- **获取可用模型返回 401**：检查密钥。模型发现会调用 OpenAI 兼容的 `GET /models` 端点；对于不提供该端点的服务，请手动输入模型。
- **图片在发送前被拒绝**：该模型未声明图片模态。请给该模型加上 `input: [text, image]`（或在其行上勾选**支持图片**），或者在模型页配置**图片理解模型**，让图片先被转为文本而不是被拒绝。
- **提供方拒绝了带图片的请求**：该模型声明了其端点实际并不提供的图片能力。请从授予它图片能力的那个列表中移除 `image`——可能是模型的 `input`，也可能是路由的 `defaultInput`——然后开启新会话：附加的图片会留在会话日志里，因此在会话离开它之前，同一个请求会不断重复。

## 进阶配置

自动生成的[插件配置目录](../../config-catalog.md)列出所有受支持的字段与默认值。[`dsh-llm-pi-ai`](../../../packages/llm/llm-pi-ai/README.md) 和 [`dsh-llm-deepseek`](../../../packages/llm/llm-deepseek/README.md) 参考文档负责直接 `settings.yaml` 配置、目录解析、推理控制、凭据与适配器错误。
