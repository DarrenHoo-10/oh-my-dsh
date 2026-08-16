# @deepseek-ai/dsh-agent-vision-model

English | [中文](README.zh.md)

The optional image-understanding model the host image relay asks to describe images when the routed conversation model cannot take them. `AgentVisionModelConfig` provides `ctx.agentVisionModel`; the ApiProxy prompt admission consults `currentSelection()` before refusing an image-bearing prompt.

The plugin config is optional and empty by default: `{ provider, model }` must be supplied together, `maxOutputTokens` (default 1024) bounds the relay output, and `timeoutMs` (default 30,000) bounds the relay call. That composition entry is the base of the `agent-vision-model` Settings section; a mounted settings provider layers the user's choice over it and changes are visible on the next `currentSelection()` read. Unconfigured means image-bearing prompts to a model without image input keep the pre-relay refusal.

- `ctx.agentVisionModel.currentSelection()` returns a validated `{ provider, model, maxOutputTokens, timeoutMs }` or `undefined` when unconfigured.
- `ctx.agentVisionModel.saveSelection(selection)` saves the complete user selection. Without a settings provider it is a no-op.

The relay records one `session/vision-transcription` event per dispatch (the exact route, system prompt, messages, and token cap), so the text the routed model sees is reconstructable from the session log. The user's own message stays in the surface transcript; the relayed description enters the model view as a `surfaceOp: replace` copy, so the chat shows the original image and question while the trajectory shows both the relay event and the description.

## Model Experience

Indirectly: the relayed description text (prefixed with `【图片已由视觉模型理解】`) reaches the routed model as a model-only replacement of the user's message; the relay call itself is a model request recorded by the `session/vision-transcription` event.

#### KV Cache effect

The relay uses a fixed system prompt and per-prompt image content, so its prefix does not share the conversation's cache. The described text enters the routed conversation as ordinary user text.

## Known Limitations and Deferred Work

- The relay covers prompt images only. Tool results carrying images (`read_image`) are still refused at the tool's own capability gate.
- A session switched to a text-only model keeps its image-bearing history; replaying that history to the new model is refused by the adapter, so the switch is allowed only when the relay is configured, and images sent after the switch are relayed.
