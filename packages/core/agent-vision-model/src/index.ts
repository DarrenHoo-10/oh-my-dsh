/**
 * Default image-understanding model selection for the host-side
 * image-to-text relay.
 *
 * When the routed conversation model cannot accept images and a prompt
 * carries them, the host relay asks this model to transcribe the images into
 * text before the conversation request is built. The selection is optional:
 * absent means the relay refuses image-bearing prompts exactly as before, and
 * the composition entry stays usable without a settings provider.
 * @module @deepseek-ai/dsh-agent-vision-model
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Message } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session/types'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default image-understanding model selection for the host image relay. */
    agentVisionModel: AgentVisionModelConfig
  }
}

/** Settings namespace carrying the default image-understanding model selection. */
export const AGENT_VISION_MODEL_SETTINGS_NAMESPACE = settingsNamespace('agent-vision-model')

/** One exact relay configuration: the vision route and its call policy. */
export interface AgentVisionModelSettings {
  /** Registered provider route; paired with {@link model} or both absent. */
  provider?: string
  /** Provider-owned model id; paired with {@link provider} or both absent. */
  model?: string
  /** Relay output-token cap (default 1024). */
  maxOutputTokens?: number
  /** End-to-end relay deadline in milliseconds (default 30,000). */
  timeoutMs?: number
}

/** Schema of the agent-vision-model settings section. */
export const AGENT_VISION_MODEL_SETTINGS_SCHEMA: z<AgentVisionModelSettings> = z.object({
  provider: z.string(),
  model: z.string(),
  maxOutputTokens: z.number().step(1).min(1),
  timeoutMs: z.number().step(1).min(1),
})

/** Composition entry for the default image-understanding model selection. */
export interface Config {
  /** Registered provider route; paired with {@link model} or both absent. */
  provider?: string
  /** Provider-owned model id; paired with {@link provider} or both absent. */
  model?: string
  /** Relay output-token cap (default 1024). */
  maxOutputTokens?: number
  /** End-to-end relay deadline in milliseconds (default 30,000). */
  timeoutMs?: number
}

/** A validated vision route plus its relay call policy. */
export interface ResolvedVisionModelSelection {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Relay output-token cap. */
  maxOutputTokens: number
  /** End-to-end relay deadline in milliseconds. */
  timeoutMs: number
}

/** Default relay output-token cap. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024
/** Default end-to-end relay deadline in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** Reject a settings snapshot whose optional pair or bounds are inconsistent. */
function resolveSettings(
  settings: AgentVisionModelSettings,
  defaults: Config,
): ResolvedVisionModelSelection | undefined {
  const provider = settings.provider ?? defaults.provider
  const model = settings.model ?? defaults.model
  if (provider === undefined && model === undefined) return undefined
  if (provider === undefined || model === undefined) {
    throw new Error('agent-vision-model: provider and model must be supplied together')
  }
  if (provider.length === 0 || model.length === 0) {
    throw new Error('agent-vision-model: provider and model must be non-empty strings')
  }
  const maxOutputTokens = settings.maxOutputTokens ?? defaults.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  const timeoutMs = settings.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    throw new Error('agent-vision-model: maxOutputTokens must be a positive integer')
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('agent-vision-model: timeoutMs must be a positive integer')
  }
  return { provider, model, maxOutputTokens, timeoutMs }
}

/**
 * Owns the default image-understanding model selection independently of any
 * Host or transport. The composition entry remains usable without a settings
 * provider; when one is mounted, its user layer is read live.
 */
export class AgentVisionModelConfig extends Service {
  static Config: z<Config> = z.object({
    provider: z.string(),
    model: z.string(),
    maxOutputTokens: z.number().step(1).min(1),
    timeoutMs: z.number().step(1).min(1),
  })

  private source: () => AgentVisionModelSettings
  private readonly defaults: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentVisionModel')
    this.defaults = config
    const entry: AgentVisionModelSettings = {
      ...config.provider === undefined ? {} : { provider: config.provider },
      ...config.model === undefined ? {} : { model: config.model },
      ...config.maxOutputTokens === undefined ? {} : { maxOutputTokens: config.maxOutputTokens },
      ...config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs },
    }
    this.source = () => entry
    installSettingsSection(ctx, AGENT_VISION_MODEL_SETTINGS_NAMESPACE, AGENT_VISION_MODEL_SETTINGS_SCHEMA, entry, {
      setSource: (current) => { this.source = current },
      // Consumers resolve per relay, so no registration-level fact needs
      // rebuilding when the settings document changes.
      onChange: () => {},
    })
  }

  /**
   * Resolve the current image-understanding selection.
   * @returns the validated route and relay policy, or `undefined` when unconfigured.
   */
  currentSelection(): ResolvedVisionModelSelection | undefined {
    return resolveSettings(this.source(), this.defaults)
  }

  /**
   * Save the image-understanding selection. A deployment without a settings
   * provider keeps its composition entry.
   * @param next - the route to persist.
   * @returns fulfillment after the optional settings write settles.
   */
  async saveSelection(next: ResolvedVisionModelSelection): Promise<void> {
    await this.ctx.get('settings')?.replace(AGENT_VISION_MODEL_SETTINGS_NAMESPACE, {
      provider: next.provider,
      model: next.model,
      maxOutputTokens: next.maxOutputTokens,
      timeoutMs: next.timeoutMs,
    })
  }
}

/**
 * Log-only pre-dispatch record of one image-to-text relay model request.
 * The relay produces text the routed model then sees, so the exact auxiliary
 * request must be reconstructable from the session log.
 */
export interface VisionTranscriptionEventData {
  /** Exact auxiliary LLM route. */
  readonly route: { provider: string; model: string }
  /** Exact auxiliary system prompt. */
  readonly system: string
  /** Exact auxiliary message list. */
  readonly messages: Message[]
  /** Exact auxiliary output-token cap. */
  readonly maxTokens: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only pre-dispatch record of one image-to-text relay request. */
    'session/vision-transcription': VisionTranscriptionEventData
  }
}

export default AgentVisionModelConfig
