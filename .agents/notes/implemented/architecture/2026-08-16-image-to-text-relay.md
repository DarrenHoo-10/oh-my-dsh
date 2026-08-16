# Agent Note: Image-to-text relay for models without image input

Status: implemented

English | [中文](2026-08-16-image-to-text-relay.zh.md)

## Problem

A model declares its input modalities through `LlmModelInfo.inputModalities`; the host refuses an image-bearing prompt when the routed model omits `image`. Custom providers and the DeepSeek catalog could not declare image support from the UI, so a hand-declared vision model stayed text-only unless the user hand-edited `settings.yaml`. And for models that genuinely take no images, refusal was the only outcome — there was no way to let another (vision-capable) model look at the image first and hand the routed model a text description.

## Decision

Three changes ship together:

1. **Per-model image declaration reaches the UI and both adapters.** The pi-ai model form already persisted `input`; the DeepSeek catalog gained the same optional field (`input?: ModelModality[]`, absent or empty meaning text-only), the adapter exposes it as `inputModalities`, and its serializer carries user image blocks as OpenAI-compatible `image_url` data-URL content parts when the model declares `image` and an attachment resolver is mounted. Both model editors render an "Image input" checkbox that stores `['text', 'image']` or removes the field.
2. **A configurable image-understanding model relays images to text.** The new `agent-vision-model` settings namespace (`provider`/`model` paired, `maxOutputTokens` default 1024, `timeoutMs` default 30,000) selects the relay route. When the routed model omits `image`, the prompt admission calls that model with the durable image blocks, appends the user's own message (image and all) to the surface transcript, and logs a model-only replacement carrying the description text prefixed with `【图片已由视觉模型理解】` (`surfaceOp: replace` over the original message). The conversation shows what the user sent; the model sees the relayed text; the trajectory shows both the relay event and the replacement. The agent loop skips a user message id that an admission listener already logged, so the followup does not duplicate it. Unconfigured keeps the previous refusal (`MODEL_DOES_NOT_SUPPORT_IMAGES`); a relay route that itself omits `image`, or a failed/empty/tool-calling relay call, refuses the prompt with a named reason.
3. **Model-visible ⟺ logged.** The relay dispatch records a `session/vision-transcription` event (route, system prompt, messages, token cap) before the call, and the relayed description enters the model view as a logged replacement message — both reconstructable from the session log. The system prompt is a pinned constant; the relay call carries `purpose: 'image-to-text'`.

The DeepSeek official endpoint is text-only; `image` on its catalog is for custom endpoints behind the route. `selectModel` allows switching to a text-only model on an image-bearing session only when a relay is configured; the session's image history then still replays to the new model, which the adapter refuses (deferred work).

## Alternatives considered

**Reject at the serializer only.** Without host admission matching the declaration, a declared-image model would accept and persist images the adapter then rejects mid-turn — the over-claiming trap the modality docs warn about. The admission change and the serializer change ship together.

**Relay output verbatim without a prefix.** The description is model-visible text; the fixed prefix marks it as relay-produced so the routed model does not read it as the user's own words. A user-supplied prompt template was considered and deferred: the pinned prompt keeps the relay behavior predictable and reconstructable.

## Consequences

- Custom vision models work from the UI (checkbox) or `settings.yaml` (`input`), on both the pi-ai and DeepSeek routes.
- An image-bearing prompt to a text-only model either relays through the configured image-understanding model or refuses with the same reason as before. The chat transcript keeps the user's own image and text; the relayed description is model-only and visible in the trajectory.
- The relay costs one extra model call and its tokens when triggered; it is never triggered when the routed model accepts images.
- The DeepSeek serializer is now asynchronous (image reads) and its user-message wire content may be a content-part array; text-only requests keep the previous string wire form.
- The agent loop now skips logging a user message whose id is already in the session log (one home per message id), which is what lets an admission listener pre-log the original plus its model-only replacement.
- The `generate_image` tool (mounted by agent presets) reuses the same image-understanding selection as a generation route: OpenAI-compatible `/v1/images/generations` for ordinary routes, MiniMax's native `/v1/image_generation` for its anthropic-messages route, and a loud failure when the provider cannot generate. The result is saved into the session workspace and returned to the model as a path, so a text-only main model produces images without ever seeing bytes.
