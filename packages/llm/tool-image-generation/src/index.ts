/**
 * `generate_image` tool: routes an image-generation request through the
 * configured image-understanding model's provider (the same route the image
 * relay uses) and saves the result into the session workspace. The routed
 * model never sees image bytes — the tool result is text naming the local
 * file — so a text-only main model can produce images transparently.
 *
 * No generation-specific configuration exists: the generation route is the
 * image-understanding selection, the endpoint derives from the provider's own
 * profile (`/v1/images/generations` for OpenAI-compatible routes, MiniMax's
 * native `/v1/image_generation` for its anthropic-messages route), and a
 * provider that cannot generate fails loud with the endpoint's own response.
 * @module @deepseek-ai/dsh-tool-image-generation
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ResolvedVisionModelSelection } from '@deepseek-ai/dsh-agent-vision-model'
import type { Context } from '@deepseek-ai/cordis'

/** The pi-ai provider-profiles namespace. */
const PI_AI_NS = settingsNamespace('llm-pi-ai')
/** The direct DeepSeek adapter namespace. */
const DEEPSEEK_NS = settingsNamespace('llm-deepseek')
/** Directory (under the session cwd) holding generated images. */
const GENERATED_DIR = 'generated-images'

/** One resolved generation route: endpoint facts plus the bearer token. */
interface GenerationRoute {
  /** Endpoint family; picks the request and response dialect. */
  kind: 'openai' | 'minimax'
  /** Full generation endpoint URL. */
  url: string
  /** Bearer token for the request. */
  apiKey: string
}

/** Read the pi-ai profile of one route. */
function piAiProfile(namespaces: Map<string, { value: unknown }>, provider: string): Record<string, unknown> | undefined {
  const view = namespaces.get(String(PI_AI_NS))
  const providers = view?.value as { providers?: Record<string, unknown> } | undefined
  const profile = providers?.providers?.[provider]
  return typeof profile === 'object' && profile !== null ? profile as Record<string, unknown> : undefined
}

/**
 * Resolve the generation route for the image-understanding selection.
 * @param ctx - host context with settings and credentials.
 * @param provider - the selected provider route.
 * @returns endpoint facts plus the bearer token, or `undefined` when the
 * provider exposes no generation endpoint.
 * @throws when the provider has no stored key.
 */
async function resolveGenerationRoute(
  ctx: Context,
  provider: string,
): Promise<GenerationRoute | undefined> {
  const settings = ctx.get('settings')
  if (settings === undefined) throw new Error('generate_image: no settings service is mounted')
  const namespaces = new Map(settings.describe({ redactSecrets: true }).map(view => [String(view.ns), view]))
  const profile = provider === 'deepseek-official'
    ? undefined
    : piAiProfile(namespaces, provider)
  const apiKeyEnv = typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0
    ? profile.apiKeyEnv
    : provider === 'deepseek-official' ? 'DEEPSEEK_API_KEY' : undefined
  const baseURL = typeof profile?.baseURL === 'string' && profile.baseURL.length > 0
    ? profile.baseURL
    : provider === 'deepseek-official'
      ? (namespaces.get(String(DEEPSEEK_NS))?.value as { baseURL?: unknown } | undefined)?.baseURL
      : undefined
  if (typeof apiKeyEnv !== 'string') {
    throw new Error(`generate_image: provider "${provider}" stores no credential reference for image generation`)
  }
  if (typeof baseURL !== 'string' || baseURL.length === 0) {
    throw new Error(`generate_image: provider "${provider}" declares no baseURL to generate against`)
  }
  const credentials = ctx.get('credentials')
  if (credentials === undefined) throw new Error('generate_image: no credentials service is mounted')
  const hit = await credentials.resolve(credentialRef(apiKeyEnv))
  if (hit === undefined || hit.value.length === 0) {
    throw new Error(`generate_image: provider "${provider}" has no stored key for image generation (${apiKeyEnv})`)
  }
  // MiniMax's anthropic-compatible route carries generation on its native
  // endpoint; every other route family speaks the OpenAI images dialect.
  if (profile?.api === 'anthropic-messages' && baseURL.endsWith('/anthropic')) {
    return {
      kind: 'minimax',
      url: `${baseURL.slice(0, -'/anthropic'.length)}/v1/image_generation`,
      apiKey: hit.value,
    }
  }
  return {
    kind: 'openai',
    url: `${baseURL.replace(/\/$/, '')}/v1/images/generations`,
    apiKey: hit.value,
  }
}

/** Read image bytes from a generation response value. */
async function imageBytesOf(kind: GenerationRoute['kind'], body: unknown, base: string): Promise<Uint8Array> {
  if (kind === 'openai') {
    const data = (body as { data?: unknown } | undefined)?.data
    if (!Array.isArray(data) || data.length === 0 || typeof data[0] !== 'object' || data[0] === null) {
      throw new Error(`generate_image: the endpoint answered no image (${base})`)
    }
    const first = data[0] as { b64_json?: unknown; url?: unknown }
    if (typeof first.b64_json === 'string' && first.b64_json.length > 0) {
      return new Uint8Array(Buffer.from(first.b64_json, 'base64'))
    }
    if (typeof first.url === 'string' && first.url.length > 0) {
      const response = await fetch(first.url)
      if (!response.ok) throw new Error(`generate_image: failed to download the generated image (HTTP ${response.status})`)
      return new Uint8Array(await response.arrayBuffer())
    }
    throw new Error(`generate_image: the endpoint answered an image payload without bytes (${base})`)
  }
  const imageUrls = (body as { data?: { image_urls?: unknown } } | undefined)?.data?.image_urls
  if (!Array.isArray(imageUrls) || imageUrls.length === 0 || typeof imageUrls[0] !== 'string') {
    throw new Error(`generate_image: the endpoint answered no image (${base})`)
  }
  const response = await fetch(imageUrls[0])
  if (!response.ok) throw new Error(`generate_image: failed to download the generated image (HTTP ${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Generate one image through the selected route and return its bytes.
 * @param route - resolved endpoint and token.
 * @param model - generation model id (the vision selection's own by default).
 * @param prompt - the image prompt.
 * @param size - optional OpenAI-style size (`1024x1024`, ...).
 * @param signal - cancellation signal.
 * @returns the generated image bytes.
 */
async function generate(
  route: GenerationRoute,
  model: string,
  prompt: string,
  size: string | undefined,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const payload = route.kind === 'minimax'
    ? { model, prompt }
    : size === undefined ? { model, prompt } : { model, prompt, size }
  let response: Response
  try {
    response = await fetch(route.url, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${route.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error: unknown) {
    if (signal.aborted) throw new Error('generate_image: request aborted')
    throw new Error(`generate_image: generation request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`generate_image: generation endpoint refused (HTTP ${response.status})${detail.length === 0 ? '' : `: ${detail.slice(0, 400)}`}`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error('generate_image: generation endpoint answered non-JSON')
  }
  return imageBytesOf(route.kind, body, route.url)
}

export default {
  name: 'tool-image-generation',
  inject: ['tools'],
  apply(ctx: Context): void {
    ctx.tools.register(defineTool({
      name: 'generate_image',
      description: [
        'Generate an image from a text description using the configured image-understanding model,',
        'and save it into the session workspace. The generated file path is returned; the image is',
        'not visible to this model directly.',
      ].join(' '),
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: 'Detailed description of the image to generate.',
        },
        size: {
          type: 'string',
          description: 'Optional output size as WxH (for example 1024x1024); omit for the provider default.',
        },
        model: {
          type: 'string',
          description: 'Optional generation model id; defaults to the configured image-understanding model.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Absolute path of the generated image in the session workspace.' },
            mediaType: { type: 'string', required: true, description: 'Image media type.' },
            bytes: { type: 'number', required: true, description: 'Image byte count.' },
          },
        },
        render: (_args, value) => {
          const row = value as { path?: unknown; bytes?: unknown }
          return [{
            type: 'text',
            text: `Generated image saved to ${String(row.path)}${typeof row.bytes === 'number' ? ` (${String(row.bytes)} bytes)` : ''}`,
          }]
        },
      },
      timeoutMs: 120_000,
      async execute(args, exec) {
        const agent = exec.agent
        if (agent === undefined) throw new Error('generate_image: requires an agent session')
        const vision: ResolvedVisionModelSelection | undefined =
          agent.ctx.get('agentVisionModel')?.currentSelection()
        if (vision === undefined) {
          throw new Error('generate_image: no image-understanding model is configured; configure one on the Models page')
        }
        const route = await resolveGenerationRoute(agent.ctx, vision.provider)
        if (route === undefined) {
          throw new Error(`generate_image: provider "${vision.provider}" exposes no image-generation endpoint`)
        }
        const arguments_ = args as { prompt?: unknown; size?: unknown; model?: unknown }
        const prompt = typeof arguments_.prompt === 'string' ? arguments_.prompt : ''
        const generationModel = typeof arguments_.model === 'string' && arguments_.model.length > 0
          ? arguments_.model
          : vision.model
        const bytes = await generate(
          route,
          generationModel,
          prompt,
          typeof arguments_.size === 'string' && arguments_.size.length > 0 ? arguments_.size : undefined,
          exec.signal,
        )
        const cwd = agent.session.header.cwd
        if (cwd === undefined || cwd.length === 0) {
          throw new Error('generate_image: the session has no workspace directory')
        }
        const dir = join(cwd, GENERATED_DIR)
        const path = join(dir, `generate-${Date.now()}.png`)
        await mkdir(dir, { recursive: true })
        await writeFile(path, Buffer.from(bytes))
        return {
          path,
          mediaType: 'image/png',
          bytes: bytes.byteLength,
        }
      },
    }))
  },
}
