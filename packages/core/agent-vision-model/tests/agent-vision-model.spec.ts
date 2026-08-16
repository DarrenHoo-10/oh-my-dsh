/** Default image-understanding model selection layered over a real settings provider. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentVisionModelConfig, { AGENT_VISION_MODEL_SETTINGS_NAMESPACE } from '../src/index.ts'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function boot(): Promise<{
  ctx: Context
  settingsFiber: Context['fiber']
  visionModel: AgentVisionModelConfig
}> {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  await ctx.plugin(AgentVisionModelConfig, {})
  return { ctx, settingsFiber, visionModel: ctx.agentVisionModel }
}

describe('AgentVisionModelConfig', () => {
  it('resolves the user layer over defaults', async () => {
    const bench = await boot()
    expect(bench.visionModel.currentSelection()).toBeUndefined()

    await bench.visionModel.saveSelection({
      provider: 'acme-gateway', model: 'acme-vision', maxOutputTokens: 512, timeoutMs: 10_000,
    })
    expect(bench.visionModel.currentSelection()).toEqual({
      provider: 'acme-gateway', model: 'acme-vision', maxOutputTokens: 512, timeoutMs: 10_000,
    })
    await bench.ctx.fiber.dispose()
  })

  it('applies the composition-entry defaults for unset policy fields', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentVisionModelConfig, {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      maxOutputTokens: 2048,
      timeoutMs: 60_000,
    })
    expect(ctx.agentVisionModel.currentSelection()).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      maxOutputTokens: 2048,
      timeoutMs: 60_000,
    })
    await ctx.fiber.dispose()
  })

  it('lays a hand-written partial section over the entry', async () => {
    const bench = await boot()
    await bench.settingsFiber.ctx.settings.replace(AGENT_VISION_MODEL_SETTINGS_NAMESPACE, {
      provider: 'acme-gateway',
      model: 'acme-vision',
    })
    expect(bench.visionModel.currentSelection()).toEqual({
      provider: 'acme-gateway',
      model: 'acme-vision',
      maxOutputTokens: 1024,
      timeoutMs: 30_000,
    })
    await bench.ctx.fiber.dispose()
  })

  it('refuses a provider without its paired model', async () => {
    const bench = await boot()
    await bench.settingsFiber.ctx.settings.replace(AGENT_VISION_MODEL_SETTINGS_NAMESPACE, {
      provider: 'acme-gateway',
    })
    expect(() => bench.visionModel.currentSelection()).toThrow(
      'agent-vision-model: provider and model must be supplied together',
    )
    await bench.ctx.fiber.dispose()
  })

  it('keeps the composition entry when no settings provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentVisionModelConfig, {})
    await ctx.agentVisionModel.saveSelection({
      provider: 'other', model: 'other', maxOutputTokens: 1024, timeoutMs: 30_000,
    })
    expect(ctx.agentVisionModel.currentSelection()).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
