import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { env } from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { runProfile } from '@deepseek-ai/dsh-app-boot'
import { toFetchHandler, type ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

const homes: string[] = []
const originalHome = env.DSH_HOME

async function rpc<T>(handler: { fetch(request: Request): Promise<Response> }, method: string, payload: unknown): Promise<T> {
  const response = await handler.fetch(new Request(`http://dsh.internal/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `desktop-${method}`, method, payload }),
  }))
  expect(response.status).toBe(200)
  const body = await response.json() as { result: { ok: true; value: T } | { ok: false; error: { message: string } } }
  if (!body.result.ok) throw new Error(body.result.error.message)
  return body.result.value
}

afterEach(async () => {
  if (originalHome === undefined) delete env.DSH_HOME
  else env.DSH_HOME = originalHome
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

describe('desktop profile composition', () => {
  it('ships agent presets outside ASAR for filesystem discovery', async () => {
    const manifest = JSON.parse(await readFile(resolve('apps/desktop/package.json'), 'utf8')) as {
      build: { extraResources: Array<{ from: string; to: string }> }
    }
    expect(manifest.build.extraResources).toContainEqual({
      from: '../cli/config/agent-presets',
      to: 'agent-presets',
    })
  })

  it('boots without a WebServer and exposes the native picker and client graph', { timeout: 60_000 }, async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-profile-'))
    homes.push(home)
    env.DSH_HOME = home
    const { ctx, shutdown } = await runProfile({
      binName: 'dsh-desktop-test',
      installAnchor: resolve('apps/desktop/package.json'),
      shippedPresetRoot: resolve('apps/cli/config/agent-presets'),
      environment: { get: () => undefined, getFrom: () => undefined },
      profile: 'desktop',
      patchFiles: [],
      args: [],
      watchPatches: false,
    })
    try {
      expect(ctx.get('webServer')).toBeUndefined()
      expect(ctx.get('apiProxy')).toBeDefined()
      expect((ctx.get('directoryPicker') as { capability(): { kind: string } }).capability().kind).toBe('native')
      const graph = (ctx.get('clientModules') as { graph(): { entries: Array<{ id: string }> } }).graph()
      expect(graph.entries.some(entry => entry.id === '@deepseek-ai/dsh-client-ui-directory-picker-native')).toBe(true)
      const apiProxy = ctx.get('apiProxy') as ApiProxy
      const connection = ctx.get('connection') as {
        createSharedFetchHandler(channel: '/api', fallback: ReturnType<typeof toFetchHandler>): ReturnType<typeof toFetchHandler>
      }
      const handler = connection.createSharedFetchHandler('/api', toFetchHandler(apiProxy))
      const createdWorkspace = await rpc<{ workspace: { workspaceId: string } }>(handler, 'workspace.create', { path: home })
      const createdSession = await rpc<{ sessionId: string }>(handler, 'session.create', {
        workspaceId: createdWorkspace.workspace.workspaceId,
      })
      expect(createdSession.sessionId).toMatch(/^session-/)
    } finally {
      await shutdown.shutdown(0)
    }
  })
})
