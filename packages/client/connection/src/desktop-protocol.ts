/**
 * Versioned messages exchanged by the Electron main process and the separate
 * Node Host. The renderer never receives a Node object or an arbitrary path;
 * bundle ids, API paths, and stream names are the only selectors crossing the
 * bridge.
 */

/** Current desktop Host protocol version. */
export const DESKTOP_PROTOCOL_VERSION = 1

/** A client bundle row carried to a file:// renderer. */
export interface DesktopBootEntry {
  /** Package id used by the browser module table. */
  id: string
  /** Web-shaped row URL retained as the cache/revision key. */
  url: string
  /** Content revision. */
  rev: string
  /** Informational dependency edges. */
  inject?: string[]
  /** Whether the shell prefetches the bundle before Cordis mounts. */
  immediately?: boolean
}

/** Host-composed graph sent to the desktop renderer. */
export interface DesktopBootManifest {
  /** Graph revision. */
  rev: string
  /** Client bundle rows. */
  entries: DesktopBootEntry[]
}

/** Fetch-shaped request carried over IPC. */
export interface DesktopFetchRequest {
  /** Absolute API path including the query string. */
  path: string
  /** HTTP method preserved for the shared fetch handler. */
  method: string
  /** Lower-level request headers. */
  headers: Record<string, string>
  /** UTF-8 request body, normally JSON. */
  body?: string
}

/** Fetch-shaped response returned over IPC. */
export interface DesktopFetchResponse {
  /** Carrier status code. */
  status: number
  /** Response headers. */
  headers: Record<string, string>
  /** Body bytes represented as UTF-8 text or base64. */
  body?: string
  /** Encoding of {@link body}; absent means an empty body. */
  bodyEncoding?: 'utf8' | 'base64'
}

/** Two long-lived event streams exposed by the Host API. */
export type DesktopStreamChannel = 'mux' | 'host'

/** Native desktop menu selected by the custom title bar. */
export type DesktopShellMenu = 'file' | 'edit' | 'view' | 'help'

/** Renderer callback receiving one validated Host stream message. */
export type DesktopStreamListener = (message: DesktopHostMessage) => void

/** Output, current-directory, or lifecycle notification from a desktop-local terminal. */
export type DesktopTerminalMessage =
  | { readonly type: 'output'; readonly data: string }
  | { readonly type: 'cwd'; readonly cwd: string }
  | { readonly type: 'exit'; readonly code: number | null }
  | { readonly type: 'error'; readonly message: string }

/** Renderer callback receiving terminal output and lifecycle notifications. */
export type DesktopTerminalListener = (message: DesktopTerminalMessage) => void

/** Renderer-facing operations exposed by the trusted desktop preload. */
export interface DesktopRendererBridge {
  /** Read the Host-composed client graph. */
  getBootManifest(): Promise<DesktopBootManifest>
  /** Read one graph-selected client bundle by its web-shaped URL. */
  loadBundle(url: string): Promise<string>
  /** Execute one fetch-shaped API request in the Host process. */
  fetch(requestId: string, request: DesktopFetchRequest): Promise<DesktopFetchResponse>
  /** Open the desktop operating system's directory chooser. */
  pickDirectory(): Promise<string | null>
  /** Cancel one in-flight fetch request. */
  cancelRequest(requestId: string): void
  /** Open one generation-scoped event stream and forward its messages. */
  openStream(streamId: string, channel: DesktopStreamChannel, listener: DesktopStreamListener): void
  /** Close one generation-scoped event stream. */
  closeStream(streamId: string): void
  /** Open one native application menu below the custom title bar control. */
  showShellMenu(menu: DesktopShellMenu, x: number, y: number): void
  /** Start a desktop-local shell in the supplied Session workspace. */
  openTerminal?(terminalId: string, cwd: string, listener: DesktopTerminalListener): Promise<void>
  /** Write UTF-8 input to a desktop-local shell. */
  writeTerminal?(terminalId: string, data: string): void
  /** Close a desktop-local shell and release its process tree. */
  closeTerminal?(terminalId: string): void
  /** Ask the user where to save one base64-encoded desktop download. */
  saveFile?(filename: string, bodyBase64: string): Promise<boolean>
}

/** Operations understood by the Host process. */
export type DesktopHostRequest =
  | { version: typeof DESKTOP_PROTOCOL_VERSION; type: 'host-request'; requestId: string; operation: 'boot' }
  | { version: typeof DESKTOP_PROTOCOL_VERSION; type: 'host-request'; requestId: string; operation: 'bundle'; url: string }
  | { version: typeof DESKTOP_PROTOCOL_VERSION; type: 'host-request'; requestId: string; operation: 'fetch'; request: DesktopFetchRequest }
  | { version: typeof DESKTOP_PROTOCOL_VERSION; type: 'host-request'; requestId: string; operation: 'stream'; channel: DesktopStreamChannel }
  | { version: typeof DESKTOP_PROTOCOL_VERSION; type: 'host-cancel'; requestId: string }

/** Successful or failed single-response message. */
export type DesktopHostReply =
  | { version: typeof DESKTOP_PROTOCOL_VERSION; type: 'host-reply'; requestId: string; ok: true; operation: 'boot'; value: DesktopBootManifest }
  | { version: typeof DESKTOP_PROTOCOL_VERSION; type: 'host-reply'; requestId: string; ok: true; operation: 'bundle'; value: string }
  | { version: typeof DESKTOP_PROTOCOL_VERSION; type: 'host-reply'; requestId: string; ok: true; operation: 'fetch'; value: DesktopFetchResponse }
  | { version: typeof DESKTOP_PROTOCOL_VERSION; type: 'host-reply'; requestId: string; ok: true; operation: 'stream' }
  | { version: typeof DESKTOP_PROTOCOL_VERSION; type: 'host-reply'; requestId: string; ok: false; message: string }

/** Stream frame message. The payload is schema-validated by the client carrier. */
export interface DesktopHostStreamFrame {
  version: typeof DESKTOP_PROTOCOL_VERSION
  type: 'host-stream-frame'
  requestId: string
  frame: unknown
}

/** Stream termination message. */
export interface DesktopHostStreamEnd {
  version: typeof DESKTOP_PROTOCOL_VERSION
  type: 'host-stream-end'
  requestId: string
  message?: string
}

/** Any message emitted by the Host process. */
export type DesktopHostMessage = DesktopHostReply | DesktopHostStreamFrame | DesktopHostStreamEnd

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function requestIdOf(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function headersOf(value: unknown): value is Record<string, string> {
  const record = recordOf(value)
  return record !== undefined && Object.values(record).every(header => typeof header === 'string')
}

function fetchRequestOf(value: unknown): value is DesktopFetchRequest {
  const record = recordOf(value)
  return record !== undefined
    && typeof record.path === 'string'
    && typeof record.method === 'string'
    && headersOf(record.headers)
    && (record.body === undefined || typeof record.body === 'string')
}

function fetchResponseOf(value: unknown): value is DesktopFetchResponse {
  const record = recordOf(value)
  return record !== undefined
    && typeof record.status === 'number'
    && headersOf(record.headers)
    && (record.body === undefined || typeof record.body === 'string')
    && (record.bodyEncoding === undefined || record.bodyEncoding === 'utf8' || record.bodyEncoding === 'base64')
}

/**
 * Validate and narrow an unknown IPC/process value to a supported Host request.
 * @param value - value received across the renderer or process boundary.
 * @returns `true` when the value is a supported desktop Host request.
 */
export function isDesktopHostRequest(value: unknown): value is DesktopHostRequest {
  const record = recordOf(value)
  if (record === undefined || record.version !== DESKTOP_PROTOCOL_VERSION || !requestIdOf(record.requestId)) return false
  if (record.type === 'host-cancel') return true
  if (record.type !== 'host-request' || typeof record.operation !== 'string') return false
  if (record.operation === 'boot') return true
  if (record.operation === 'bundle') return typeof record.url === 'string'
  if (record.operation === 'fetch') return fetchRequestOf(record.request)
  return record.operation === 'stream' && (record.channel === 'mux' || record.channel === 'host')
}

/**
 * Validate and narrow an unknown process value to a versioned Host message.
 * @param value - value received from the desktop Host process.
 * @returns `true` when the value is a supported Host message.
 */
export function isDesktopHostMessage(value: unknown): value is DesktopHostMessage {
  const message = recordOf(value)
  if (message === undefined || message.version !== DESKTOP_PROTOCOL_VERSION || !requestIdOf(message.requestId)) return false
  if (message.type === 'host-stream-frame') return 'frame' in message
  if (message.type === 'host-stream-end') return message.message === undefined || typeof message.message === 'string'
  if (message.type !== 'host-reply' || typeof message.ok !== 'boolean') return false
  if (!message.ok) return typeof message.message === 'string'
  if (message.operation === 'boot') return recordOf(message.value) !== undefined
  if (message.operation === 'bundle') return typeof message.value === 'string'
  if (message.operation === 'fetch') return fetchResponseOf(message.value)
  return message.operation === 'stream'
}
