# @deepseek-ai/dsh-tool-image-generation

English | [中文](README.zh.md)

The `generate_image` tool lets a text-only main model produce images transparently: the model calls the tool with a description, the tool routes the generation through the configured image-understanding model's provider (the same `agent-vision-model` selection the image relay uses), saves the result into the session workspace under `generated-images/`, and returns the local file path. The model never sees image bytes — the tool result is text — so no image-capable main model is required.

No generation-specific configuration exists. The endpoint derives from the provider's own profile: an OpenAI-compatible route calls `{baseURL}/v1/images/generations`; MiniMax's anthropic-messages route (`.../anthropic`) calls its native `{baseURL}/v1/image_generation`. A provider that cannot generate — no image-understanding model configured, no stored key, an endpoint refusal — fails loud with the endpoint's own response, and the model reports it.

The tool registers into the host `tools` registry; agent presets mount the row per agent. Generated files appear under the session workspace and surface through the produced-files row like any other agent-created file.

## Model Experience

The tool call and its result are ordinary `tool/call` + `tool/result` events: the prompt is model-visible, the returned path is model-visible, and both are reconstructable from the session log. The image bytes themselves are not model-visible.

#### KV Cache effect

None beyond the ordinary tool-call surface.

## Known Limitations and Deferred Work

- Only raster PNG output is produced; format/size options follow the provider's own dialect and are passed through when the model names them.
- The provider's generation endpoint is derived by protocol; a gateway that serves images under a different path needs a custom endpoint row.
