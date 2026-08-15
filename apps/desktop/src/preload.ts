/** Trusted preload: expose only typed, path-free desktop operations. */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  DesktopFetchRequest, DesktopRendererBridge, DesktopShellMenu, DesktopStreamChannel, DesktopStreamListener,
  DesktopTerminalListener,
} from '@deepseek-ai/dsh-client-connection'
import { DESKTOP_PROTOCOL_VERSION } from '@deepseek-ai/dsh-client-connection'

function randomId(): string {
  return crypto.randomUUID()
}

async function request(
  operation: 'boot' | 'bundle',
  value: { url?: string },
): Promise<unknown> {
  const requestId = randomId()
  return ipcRenderer.invoke('dsh:host-request', {
    version: DESKTOP_PROTOCOL_VERSION, type: 'host-request', requestId, operation, ...value,
  })
}

function fetchRequest(requestId: string, value: DesktopFetchRequest): Promise<unknown> {
  return ipcRenderer.invoke('dsh:host-request', {
    version: DESKTOP_PROTOCOL_VERSION, type: 'host-request', requestId, operation: 'fetch', request: value,
  })
}

type StreamHandler = (event: IpcRendererEvent, envelope: unknown) => void

const streamHandlers = new Map<string, StreamHandler>()
const terminalHandlers = new Map<string, StreamHandler>()

function removeStreamHandler(streamId: string): void {
  const handler = streamHandlers.get(streamId)
  if (handler !== undefined) ipcRenderer.removeListener('dsh:stream-message', handler)
  streamHandlers.delete(streamId)
}

function closeStream(streamId: string): void {
  removeStreamHandler(streamId)
  ipcRenderer.send('dsh:stream-cancel', { requestId: streamId })
}

function openStream(streamId: string, channel: DesktopStreamChannel, listener: DesktopStreamListener): void {
  removeStreamHandler(streamId)
  const onMessage: StreamHandler = (_event, envelope) => {
    if (typeof envelope !== 'object' || envelope === null) return
    const value = envelope as { streamId?: unknown; message?: unknown }
    if (value.streamId !== streamId || typeof value.message !== 'object' || value.message === null) return
    listener(value.message as Parameters<DesktopStreamListener>[0])
    if ((value.message as { type?: unknown }).type === 'host-stream-end') closeStream(streamId)
  }
  streamHandlers.set(streamId, onMessage)
  ipcRenderer.on('dsh:stream-message', onMessage)
  ipcRenderer.send('dsh:stream-open', { streamId, channel })
}

function showShellMenu(menu: DesktopShellMenu, x: number, y: number): void {
  ipcRenderer.send('dsh:shell-menu', { menu, x, y })
}

const bridge: DesktopRendererBridge = {
  async getBootManifest() {
    const reply = await request('boot', {}) as { value: unknown }
    return reply.value as Awaited<ReturnType<DesktopRendererBridge['getBootManifest']>>
  },
  async loadBundle(url) {
    const reply = await request('bundle', { url }) as { value: unknown }
    return reply.value as string
  },
  async fetch(requestId, value) {
    const reply = await fetchRequest(requestId, value) as { value: unknown }
    return reply.value as Awaited<ReturnType<DesktopRendererBridge['fetch']>>
  },
  async pickDirectory() {
    return await ipcRenderer.invoke('dsh:pick-directory') as string | null
  },
  cancelRequest(requestId) {
    ipcRenderer.send('dsh:host-cancel', { requestId })
  },
  openStream,
  closeStream,
  showShellMenu,
  async openTerminal(terminalId, cwd, listener: DesktopTerminalListener) {
    const existing = terminalHandlers.get(terminalId)
    if (existing !== undefined) ipcRenderer.removeListener('dsh:terminal-message', existing)
    const handler: StreamHandler = (_event, envelope) => {
      if (typeof envelope !== 'object' || envelope === null) return
      const value = envelope as { terminalId?: unknown; message?: unknown }
      if (value.terminalId !== terminalId || typeof value.message !== 'object' || value.message === null) return
      listener(value.message as Parameters<DesktopTerminalListener>[0])
    }
    terminalHandlers.set(terminalId, handler)
    ipcRenderer.on('dsh:terminal-message', handler)
    await ipcRenderer.invoke('dsh:terminal-open', { terminalId, cwd })
  },
  writeTerminal(terminalId, data) {
    ipcRenderer.send('dsh:terminal-write', { terminalId, data })
  },
  closeTerminal(terminalId) {
    const handler = terminalHandlers.get(terminalId)
    if (handler !== undefined) ipcRenderer.removeListener('dsh:terminal-message', handler)
    terminalHandlers.delete(terminalId)
    ipcRenderer.send('dsh:terminal-close', { terminalId })
  },
  async saveFile(filename, bodyBase64) {
    return await ipcRenderer.invoke('dsh:save-file', { filename, bodyBase64 }) as boolean
  },
}

contextBridge.exposeInMainWorld('__DSH_DESKTOP__', bridge)
