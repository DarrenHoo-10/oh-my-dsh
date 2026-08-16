/**
 * Serialize harness messages into DeepSeek chat completions. User text is joined; assistant text
 * becomes `content`, tool calls become `tool_calls`, and tool results become separate tool messages.
 * Assistant reasoning is replayed as `reasoning_content` only on tool-call turns, as required by
 * thinking-mode passback. A message carrying image blocks serializes as the OpenAI-compatible
 * content-array form (data URLs) only when the routed model declares image input and an image
 * resolver is supplied; otherwise the image is refused before any text-flattening path can
 * silently erase it. Unknown declaration-merged block types retain the adapter's documented
 * extension fallback.
 * @module dsh-llm-deepseek/serialize
 */

import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message, ModelModality } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { WireMessage, WireRequest, WireTool, WireUserContent, WireUserContentPart } from './types.ts'

/** Adapter-level request defaults (from plugin config). */
export interface RequestDefaults {
  thinking?: 'enabled' | 'disabled' | undefined
  reasoningEffort?: 'off' | 'high' | 'max' | undefined
}

/** Reads one durable image into bytes and its media type for a wire data URL. */
export type WireImageResolver = (
  ref: ImageAttachmentRef,
) => Promise<{ data: Uint8Array; mediaType: string }>

interface ResolvedThinking {
  thinking?: 'enabled' | 'disabled'
  reasoningEffort?: 'high' | 'max'
}

/** Validate the adapter-owned effort before resolving its DeepSeek wire fields. */
function reasoningEffort(effort: NonNullable<GenerateOptions['reasoningEffort']>): 'off' | 'high' | 'max' {
  if (effort === 'off' || effort === 'high' || effort === 'max') {
    return effort as 'off' | 'high' | 'max'
  }
  throw new LlmError(
    `DeepSeek does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/** Resolve one legal thinking/effort pair without exposing `off` as a wire effort. */
function resolveThinking(options: GenerateOptions, defaults: RequestDefaults): ResolvedThinking {
  if (options.purpose === 'session-title') return { thinking: 'disabled' }
  const effort = options.reasoningEffort === undefined
    ? defaults.reasoningEffort
    : reasoningEffort(options.reasoningEffort)
  if (defaults.thinking === 'disabled' && effort !== undefined && effort !== 'off') {
    throw new LlmError(
      `DeepSeek deployment does not support reasoning effort "${effort}"`,
      'UNSUPPORTED_REASONING_EFFORT',
    )
  }
  if (effort === 'off') return { thinking: 'disabled' }
  if (effort === 'high' || effort === 'max') {
    return { thinking: 'enabled', reasoningEffort: effort }
  }
  return defaults.thinking === undefined ? {} : { thinking: defaults.thinking }
}

/** Join the text blocks of a message (used for user/tool-result content). */
function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Reject image content this wire route cannot carry: an undeclared modality or a missing resolver. */
function assertImageTransport(
  blocks: readonly ContentBlock[],
  input: readonly ModelModality[],
  resolveImage: WireImageResolver | undefined,
): void {
  if (!contentHasImage(blocks)) return
  if (!input.includes('image')) {
    throw new LlmError('The DeepSeek chat-completions adapter does not support image content for this model.', 'UNSUPPORTED_CONTENT')
  }
  if (resolveImage === undefined) {
    throw new LlmError('DeepSeek image input requires the durable attachment service', 'UNSUPPORTED_CONTENT')
  }
}

/** Serialize one user message into its wire content: plain text, or the content-array form with images. */
async function serializeUserContent(
  blocks: readonly ContentBlock[],
  resolveImage: WireImageResolver,
): Promise<WireUserContent> {
  const parts: WireUserContentPart[] = []
  const text = flattenText(blocks)
  if (text.length > 0) parts.push({ type: 'text', text })
  for (const block of blocks) {
    if (block.type !== 'image') continue
    const stored = await resolveImage(block.attachment)
    const data = Buffer.from(stored.data).toString('base64')
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${stored.mediaType};base64,${data}` },
    })
  }
  // A text-less user message with no images is "" on the wire (never null).
  if (parts.length === 0) return ''
  if (parts.every(part => part.type === 'text')) return parts.map(part => part.text).join('')
  return parts
}

/** Serialize one assistant message (text + reasoning + tool calls). */
function serializeAssistant(message: Message): WireMessage {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))

  return {
    role: 'assistant',
    // Text-less turns send "" — NEVER null. Pure tool-call turns: the
    // official samples replay message.content verbatim (which is "") and
    // some gateways reject null outright. Reasoning-ONLY turns (the model
    // can answer entirely in the reasoning channel, e.g. a v4-flash
    // greeting): the live API rejects null-content/no-tool_calls assistant
    // messages with a 400 ("content or tool_calls must be set"), and since
    // the message sits durably in the session log, a null here bricks every
    // later turn of that session.
    content: text,
    // Official passback rule (guides/thinking_mode.mdx): reasoning_content
    // must return on tool-call turns; it is ignored on plain turns, so we
    // drop it there to save tokens.
    ...toolCalls.length > 0 && reasoning.length > 0 ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages; the harness puts each tool result in its own
 * user-role message, so a mixed user message contributes its text first and
 * its tool results as separate wire messages after. Images serialize only in
 * user-role content; a tool result carrying an image is refused because the
 * wire route carries tool content as plain strings.
 * @param messages - the harness conversation, in order.
 * @param input - the routed model's declared request modalities.
 * @param resolveImage - durable-image reader for user content, when the attachment service is mounted.
 * @returns the wire messages; order preserved, each tool result expanded into its own entry.
 */
export async function serializeMessages(
  messages: Message[],
  input: readonly ModelModality[] = ['text'],
  resolveImage?: WireImageResolver,
): Promise<WireMessage[]> {
  const wire: WireMessage[] = []
  for (const message of messages) {
    assertImageTransport(message.content, input, resolveImage)
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    // user role: tool results ride in user messages in the harness
    // vocabulary, but DeepSeek wants them as role:'tool' messages.
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    for (const result of toolResults) {
      if (contentHasImage(result.content)) {
        throw new LlmError('The DeepSeek chat-completions adapter does not support images inside tool results.', 'UNSUPPORTED_CONTENT')
      }
    }
    const text = flattenText(message.content)
    const hasImage = contentHasImage(message.content)
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({
        role: 'user',
        content: hasImage && resolveImage !== undefined
          ? await serializeUserContent(message.content, resolveImage)
          : text,
      })
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        // Empty tool output still needs SOME content on the wire.
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

/**
 * Build the full wire request. Always streaming (`stream: true`, usage
 * reporting on); optional fields are omitted rather than sent as null, so
 * provider defaults apply.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param defaults - adapter-level thinking defaults; undefined fields put nothing on the wire.
 * @param input - the routed model's declared request modalities (default `[text]`).
 * @param resolveImage - durable-image reader for user content, when the attachment service is mounted.
 * @returns the chat-completions request body.
 */
export async function serializeRequest(
  options: GenerateOptions,
  defaults: RequestDefaults = {},
  input: readonly ModelModality[] = ['text'],
  resolveImage?: WireImageResolver,
): Promise<WireRequest> {
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...await serializeMessages(options.messages, input, resolveImage))

  const tools: WireTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  // A short title budget must produce visible text; conversation and
  // compaction calls continue to inherit the adapter's thinking defaults.
  const resolvedThinking = resolveThinking(options, defaults)

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...resolvedThinking.thinking !== undefined ? { thinking: { type: resolvedThinking.thinking } } : {},
    ...resolvedThinking.reasoningEffort !== undefined
      ? { reasoning_effort: resolvedThinking.reasoningEffort }
      : {},
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== undefined ? { stop: options.stop } : {},
  }
}
