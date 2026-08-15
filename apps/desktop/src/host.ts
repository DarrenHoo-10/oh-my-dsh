/** Separate Node Host process for the Electron desktop application. */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { toFetchHandler, type ApiProxy, type ServerRequest } from '@deepseek-ai/dsh-host-apiproxy'
import {
  loadLayeredEnv,
  runProfile,
} from '@deepseek-ai/dsh-app-boot'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {
  DesktopBootManifest, DesktopFetchRequest, DesktopFetchResponse, DesktopHostMessage, DesktopHostRequest,
  DesktopStreamChannel,
} from '@deepseek-ai/dsh-client-connection'
import { DESKTOP_PROTOCOL_VERSION, isDesktopHostRequest } from '@deepseek-ai/dsh-client-connection'

interface DesktopHostState {
  ctx: Context
  apiProxy: ApiProxy
  connection: HostConnectionService
  modules: ClientModuleRegistry
}

type DesktopHostStartup =
  | { ok: true; state: DesktopHostState }
  | { ok: false; error: unknown }

const active = new Map<string, AbortController>()

function send(message: DesktopHostMessage): void {
  if (process.send !== undefined) process.send(message)
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const details: string[] = []
  const seen = new Set<unknown>()
  const collectLeaves = (value: unknown): void => {
    if (!(value instanceof Error) || seen.has(value)) return
    seen.add(value)
    if (value instanceof AggregateError) {
      for (const nested of value.errors) collectLeaves(nested)
      if (value.cause !== undefined) collectLeaves(value.cause)
      return
    }
    if (value.cause !== undefined) {
      collectLeaves(value.cause)
      return
    }
    if (value.message !== error.message && !details.includes(value.message)) details.push(value.message)
  }
  collectLeaves(error)
  const shown = details.slice(0, 8)
  const omitted = details.length - shown.length
  return `${error.message}${shown.length === 0 ? '' : `\n${shown.join('\n')}`}${omitted === 0 ? '' : `\n... ${String(omitted)} more plugin errors`}`
}

async function startHost(): Promise<DesktopHostState> {
  const installAnchor = fileURLToPath(new URL('../package.json', import.meta.url))
  const shippedPresetRoot = process.env.DSH_DESKTOP_PRESET_ROOT ?? fileURLToPath(new URL('../../cli/config/agent-presets/', import.meta.url))
  const { ctx } = await runProfile({
    binName: 'dsh-desktop',
    installAnchor,
    shippedPresetRoot,
    environment: loadLayeredEnv('dsh-desktop'),
    profile: 'desktop',
    patchFiles: [],
    args: [],
    watchPatches: false,
    ...(process.env.DSH_DESKTOP_MODULE_BASE_URL === undefined
      ? {} : { bareModuleBaseUrl: process.env.DSH_DESKTOP_MODULE_BASE_URL }),
  })
  const apiProxy = ctx.get('apiProxy')
  const connection = ctx.get('connection')
  const modules = ctx.get('clientModules')
  if (apiProxy === undefined || !(connection instanceof HostConnectionService) || modules === undefined) {
    throw new Error('dsh-desktop: desktop profile did not provide API, Connection, and client modules')
  }
  return { ctx, apiProxy, connection, modules }
}

function requestFrom(value: DesktopFetchRequest, signal: AbortSignal): Request {
  if (!value.path.startsWith('/api/')) throw new Error('dsh-desktop: IPC fetch path must stay under /api')
  const url = new URL(value.path, 'http://dsh.internal')
  const init: RequestInit = {
    method: value.method,
    headers: value.headers,
    signal,
    ...(value.body === undefined || value.method === 'GET' || value.method === 'HEAD'
      ? {} : { body: value.body }),
  }
  return new Request(url, init)
}

async function serialiseResponse(response: Response): Promise<DesktopFetchResponse> {
  const bytes = Buffer.from(await response.arrayBuffer())
  const headers = Object.fromEntries(response.headers.entries())
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (bytes.byteLength === 0) return { status: response.status, headers }
  if (contentType.startsWith('application/json') || contentType.startsWith('text/')) {
    return { status: response.status, headers, body: bytes.toString('utf8'), bodyEncoding: 'utf8' }
  }
  return { status: response.status, headers, body: bytes.toString('base64'), bodyEncoding: 'base64' }
}

function bootManifest(modules: ClientModuleRegistry): DesktopBootManifest {
  const graph = modules.graph()
  return {
    rev: graph.rev,
    entries: graph.entries.map(entry => ({
      id: entry.id,
      url: entry.url,
      rev: entry.rev,
      ...(entry.inject === undefined ? {} : { inject: [...entry.inject] }),
      ...(entry.immediately === true ? { immediately: true } : {}),
    })),
  }
}

async function bundleSource(modules: ClientModuleRegistry, url: string): Promise<string> {
  const parsed = new URL(url, 'http://dsh.internal')
  const prefix = '/plugins/'
  const suffix = '/client.js'
  if (!parsed.pathname.startsWith(prefix) || !parsed.pathname.endsWith(suffix)) {
    throw new Error('dsh-desktop: invalid client bundle URL')
  }
  const id = parsed.pathname.slice(prefix.length, -suffix.length)
  const row = modules.graph().entries.find(entry => entry.id === id && entry.url === url)
  if (row === undefined) throw new Error(`dsh-desktop: stale or unknown client bundle ${JSON.stringify(id)}`)
  const path = modules.clientPath(id)
  if (path === undefined) throw new Error(`dsh-desktop: client bundle path missing for ${JSON.stringify(id)}`)
  return readFile(path, 'utf8')
}

function fullFrame(narrow: { rpcId: ServerRequest['rpcId']; payload: { type: string } & Record<string, unknown> }): ServerRequest {
  return {
    type: 'server-request',
    rpcId: narrow.rpcId,
    method: narrow.payload.type,
    payload: narrow.payload,
  }
}

async function stream(state: DesktopHostState, requestId: string, channel: DesktopStreamChannel): Promise<void> {
  const abort = new AbortController()
  active.set(requestId, abort)
  send({ version: DESKTOP_PROTOCOL_VERSION, type: 'host-reply', requestId, ok: true, operation: 'stream' })
  try {
    const source = channel === 'mux'
      ? state.apiProxy.events.mux({ rpcId: RpcId(randomUUID()), payload: {} }, abort.signal)
      : state.apiProxy.events.host({ rpcId: RpcId(randomUUID()), payload: {} }, abort.signal)
    for await (const frame of source) send({ version: DESKTOP_PROTOCOL_VERSION, type: 'host-stream-frame', requestId, frame: fullFrame(frame) })
    send({ version: DESKTOP_PROTOCOL_VERSION, type: 'host-stream-end', requestId })
  } catch (error) {
    if (!abort.signal.aborted) send({ version: DESKTOP_PROTOCOL_VERSION, type: 'host-stream-end', requestId, message: errorMessage(error) })
  } finally {
    active.delete(requestId)
  }
}

async function handle(state: DesktopHostState, request: Exclude<DesktopHostRequest, { type: 'host-cancel' }>): Promise<void> {
  try {
    if (request.operation === 'boot') {
      send({ version: DESKTOP_PROTOCOL_VERSION, type: 'host-reply', requestId: request.requestId, ok: true, operation: 'boot', value: bootManifest(state.modules) })
      return
    }
    if (request.operation === 'bundle') {
      send({ version: DESKTOP_PROTOCOL_VERSION, type: 'host-reply', requestId: request.requestId, ok: true, operation: 'bundle', value: await bundleSource(state.modules, request.url) })
      return
    }
    if (request.operation === 'stream') {
      await stream(state, request.requestId, request.channel)
      return
    }
    const abort = new AbortController()
    active.set(request.requestId, abort)
    try {
      const fetchHandler = state.connection.createSharedFetchHandler('/api', toFetchHandler(state.apiProxy))
      const response = await fetchHandler.fetch(requestFrom(request.request, abort.signal))
      send({ version: DESKTOP_PROTOCOL_VERSION, type: 'host-reply', requestId: request.requestId, ok: true, operation: 'fetch', value: await serialiseResponse(response) })
    } finally {
      active.delete(request.requestId)
    }
  } catch (error) {
    send({ version: DESKTOP_PROTOCOL_VERSION, type: 'host-reply', requestId: request.requestId, ok: false, message: errorMessage(error) })
  }
}

const ready: Promise<DesktopHostStartup> = startHost().then(
  state => ({ ok: true, state }),
  (error: unknown) => ({ ok: false, error }),
)
process.on('message', (value: unknown) => {
  if (!isDesktopHostRequest(value)) return
  const request = value
  if (request.type === 'host-cancel') {
    active.get(request.requestId)?.abort()
    return
  }
  void ready.then((startup) => {
    if (startup.ok) return handle(startup.state, request)
    send({ version: DESKTOP_PROTOCOL_VERSION, type: 'host-reply', requestId: request.requestId, ok: false, message: errorMessage(startup.error) })
  })
})
