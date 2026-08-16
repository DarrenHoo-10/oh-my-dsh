/** generate_image tool: route resolution, endpoint dialect, and workspace save. */

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let fetched: Array<{ url: string; init: RequestInit | undefined }> = []

function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    fetched.push({ url: String(url), init: init ?? undefined })
    const body = init?.method === 'POST'
      ? String(url).includes('/image_generation')
        ? JSON.stringify({ data: { image_urls: ['https://cdn.example/gen.png'] } })
        : JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] })
      : JSON.stringify({ data: PNG_BASE64 })
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  fetched = []
})

interface Fixture {
  ctx: Context
  agent: Agent
}

function harness(profile?: { baseURL?: string; api?: string; apiKeyEnv?: string }): Fixture {
  const ctx = new Context()
  const piAiValue: Record<string, unknown> = {}
  if (profile !== undefined) {
    piAiValue['providers'] = { 'vision-gw': { ...profile } }
  }
  ctx.provide('settings', {
    describe: () => [
      { ns: 'llm-pi-ai', value: piAiValue },
      { ns: 'agent-vision-model', value: profile === undefined ? {} : { provider: 'vision-gw', model: 'vl-1' } },
    ],
  } as never)
  ctx.provide('credentials', {
    resolve: async (ref: ReturnType<typeof credentialRef>) =>
      String(ref) === 'VISION_API_KEY' ? { value: 'sk-test', source: 'file' } : undefined,
  } as never)
  ctx.provide('agentVisionModel', {
    currentSelection: () => profile === undefined
      ? undefined
      : { provider: 'vision-gw', model: 'vl-1', maxOutputTokens: 512, timeoutMs: 30_000 },
  } as never)
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-image-gen-'))
  const agent = {
    ctx,
    session: {
      header: { cwd },
      id: 'session-test',
    },
  } as unknown as Agent
  return { ctx, agent }
}

const tool = (await import('../src/index.ts')).default

describe('generate_image', () => {
  it('registers a tool named generate_image with a prompt schema', () => {
    const def = tool as unknown as { name: string; apply(ctx: Context): void }
    expect(def.name).toBe('tool-image-generation')
    let registered: ReturnType<typeof defineTool> | undefined
    const probe = {
      tools: { register: (candidate: ReturnType<typeof defineTool>) => { registered = candidate; return () => {} } },
    } as never
    def.apply(probe)
    expect(registered).toBeDefined()
    expect(registered?.name).toBe('generate_image')
  })

  it('refuses without an image-understanding model configured', async () => {
    const { ctx, agent } = harness(undefined)
    let registered: ReturnType<typeof defineTool> | undefined
    const register = (candidate: ReturnType<typeof defineTool>) => { registered = candidate; return () => {} }
    const probe = { tools: { register } } as never
    tool.apply(probe)
    await expect(registered!.execute({ prompt: 'a cat' }, { agent, signal: new AbortController().signal } as never))
      .rejects.toThrow(/no image-understanding model is configured/)
    await ctx.fiber?.dispose?.()
  })

  it('generates through the OpenAI images endpoint and saves into the workspace', async () => {
    stubFetch()
    const { ctx, agent } = harness({ baseURL: 'https://gateway.example/v1', api: 'openai-completions', apiKeyEnv: 'VISION_API_KEY' })
    let registered: ReturnType<typeof defineTool> | undefined
    const register = (candidate: ReturnType<typeof defineTool>) => { registered = candidate; return () => {} }
    const probe = { tools: { register } } as never
    tool.apply(probe)

    const value = await registered!.execute({ prompt: 'a red circle' }, { agent, signal: new AbortController().signal } as never) as {
      path: string
      bytes: number
      mediaType: string
    }
    expect(fetched[0]?.url).toBe('https://gateway.example/v1/v1/images/generations')
    const rawBody = fetched[0]?.init?.body
    const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as { model: string; prompt: string }
    expect(body).toEqual({ model: 'vl-1', prompt: 'a red circle' })
    expect(value.mediaType).toBe('image/png')
    expect(readFileSync(value.path)).toEqual(Buffer.from(PNG_BASE64, 'base64'))
    await ctx.fiber?.dispose?.()
  })

  it('generates through the MiniMax native endpoint for an anthropic-messages route', async () => {
    stubFetch()
    const { ctx, agent } = harness({ baseURL: 'https://api.minimax.io/anthropic', api: 'anthropic-messages', apiKeyEnv: 'VISION_API_KEY' })
    let registered: ReturnType<typeof defineTool> | undefined
    const register = (candidate: ReturnType<typeof defineTool>) => { registered = candidate; return () => {} }
    const probe = { tools: { register } } as never
    tool.apply(probe)

    const value = await registered!.execute({ prompt: 'a blue square' }, { agent, signal: new AbortController().signal } as never) as { path: string }
    expect(fetched[0]?.url).toBe('https://api.minimax.io/v1/image_generation')
    expect(value.path.endsWith('.png')).toBe(true)
    await ctx.fiber?.dispose?.()
  })

  it('surfaces the endpoint refusal to the model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"no such model"}', { status: 404 })))
    const { ctx, agent } = harness({ baseURL: 'https://gateway.example/v1', api: 'openai-completions', apiKeyEnv: 'VISION_API_KEY' })
    let registered: ReturnType<typeof defineTool> | undefined
    const register = (candidate: ReturnType<typeof defineTool>) => { registered = candidate; return () => {} }
    const probe = { tools: { register } } as never
    tool.apply(probe)
    await expect(registered!.execute({ prompt: 'x' }, { agent, signal: new AbortController().signal } as never))
      .rejects.toThrow(/HTTP 404/)
    await ctx.fiber?.dispose?.()
  })
})
