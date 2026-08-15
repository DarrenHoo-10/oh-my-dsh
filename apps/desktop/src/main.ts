/** Electron main process: window lifecycle plus the renderer-to-Host bridge. */

import { existsSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { fork, spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app, BrowserWindow, dialog, ipcMain, Menu, shell,
} from 'electron'
import type { MenuItemConstructorOptions, OpenDialogOptions } from 'electron'
import {
  DESKTOP_PROTOCOL_VERSION,
  isDesktopHostRequest,
  isDesktopHostMessage,
  type DesktopHostMessage,
  type DesktopHostRequest,
  type DesktopStreamChannel,
  type DesktopTerminalMessage,
} from '@deepseek-ai/dsh-client-connection'
import { configureDesktopChromiumStorage } from './chromium-storage.ts'

type HostReply = Extract<DesktopHostMessage, { type: 'host-reply' }>
type StreamListener = (message: DesktopHostMessage) => void
const DESKTOP_HOST_STOP_TIMEOUT_MS = 5_000
const TERMINAL_CWD_MARKER = '__DSH_TERMINAL_CWD__:'

function terminalRequestOf(value: unknown): { terminalId: string; cwd?: string; data?: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as { terminalId?: unknown; cwd?: unknown; data?: unknown }
  if (typeof row.terminalId !== 'string' || row.terminalId === '') return undefined
  if (row.cwd !== undefined && typeof row.cwd !== 'string') return undefined
  if (row.data !== undefined && typeof row.data !== 'string') return undefined
  return {
    terminalId: row.terminalId,
    ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
    ...(row.data === undefined ? {} : { data: row.data }),
  }
}

function saveFileRequestOf(value: unknown): { filename: string; bodyBase64: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as { filename?: unknown; bodyBase64?: unknown }
  if (typeof row.filename !== 'string' || row.filename === '' || typeof row.bodyBase64 !== 'string') return undefined
  return { filename: row.filename.replace(/[\\/:*?"<>|]/g, '_'), bodyBase64: row.bodyBase64 }
}

function terminalEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(KEY|SECRET|TOKEN|PASSWORD)/i.test(key)))
}

interface DesktopTerminalProcess {
  readonly child: ChildProcessWithoutNullStreams
  readonly emit: (message: DesktopTerminalMessage) => void
  stderrBuffer: string
}

function terminalDirectoryProbe(): string {
  return process.platform === 'win32'
    ? `[Console]::Error.WriteLine('${TERMINAL_CWD_MARKER}' + (Get-Location).Path)\r\n`
    : `printf '${TERMINAL_CWD_MARKER}%s\\n' "$PWD" >&2\n`
}

/** Desktop-owned interactive shells; every renderer terminal owns one child. */
class DesktopTerminals {
  private readonly processes = new Map<string, DesktopTerminalProcess>()

  private emitStderrLine(process: DesktopTerminalProcess, line: string): void {
    const content = line.replace(/\r?\n$/, '')
    if (content.startsWith(TERMINAL_CWD_MARKER)) {
      const cwd = content.slice(TERMINAL_CWD_MARKER.length)
      if (cwd !== '') process.emit({ type: 'cwd', cwd })
      return
    }
    process.emit({ type: 'output', data: line })
  }

  private acceptStderr(process: DesktopTerminalProcess, chunk: string): void {
    process.stderrBuffer += chunk
    let newline = process.stderrBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = process.stderrBuffer.slice(0, newline + 1)
      process.stderrBuffer = process.stderrBuffer.slice(newline + 1)
      this.emitStderrLine(process, line)
      newline = process.stderrBuffer.indexOf('\n')
    }
  }

  async open(terminalId: string, cwd: string, emit: (message: DesktopTerminalMessage) => void): Promise<void> {
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error('terminal working directory is unavailable')
    await this.close(terminalId)
    const executable = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL ?? '/bin/sh')
    const args = process.platform === 'win32'
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-']
      : ['-i']
    const child = spawn(executable, args, { cwd, env: terminalEnvironment(), windowsHide: true })
    const terminal = { child, emit, stderrBuffer: '' }
    this.processes.set(terminalId, terminal)
    emit({ type: 'cwd', cwd })
    child.stdout.on('data', (chunk) => { emit({ type: 'output', data: String(chunk) }) })
    child.stderr.on('data', (chunk) => { this.acceptStderr(terminal, String(chunk)) })
    child.on('error', (error) => { emit({ type: 'error', message: error.message }) })
    child.on('exit', (code) => {
      if (terminal.stderrBuffer !== '') {
        this.emitStderrLine(terminal, terminal.stderrBuffer)
        terminal.stderrBuffer = ''
      }
      if (this.processes.get(terminalId) === terminal) this.processes.delete(terminalId)
      emit({ type: 'exit', code })
    })
  }

  write(terminalId: string, data: string): void {
    const process = this.processes.get(terminalId)
    if (process === undefined) return
    process.child.stdin.write(data === '\x03' ? data : `${data}${terminalDirectoryProbe()}`)
  }

  async close(terminalId: string): Promise<void> {
    const process = this.processes.get(terminalId)
    if (process === undefined) return
    if (process.child.exitCode !== null || process.child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      process.child.once('exit', () => { resolve() })
      process.child.kill()
    })
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.processes.keys()].map(id => this.close(id)))
  }
}

/** Small process manager for the separate Node Host. */
class DesktopHostProcess {
  private readonly child: ChildProcess
  private readonly pending = new Map<string, {
    resolve: (message: HostReply) => void
    reject: (error: unknown) => void
  }>()
  private readonly streams = new Map<string, StreamListener>()
  private stopped = false

  constructor(entry: string) {
    const developmentHost = app.isPackaged ? undefined : {
      loader: import.meta.resolve('tsx/esm'),
      tsconfigPath: join(app.getAppPath(), '..', '..', 'tsconfig.json'),
    }
    this.child = fork(entry, [], {
      execPath: process.execPath,
      execArgv: [
        '--expose-internals',
        ...(developmentHost === undefined ? [] : ['--import', developmentHost.loader]),
      ],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_DESKTOP_PRESET_ROOT: presetRoot(),
        ...(app.isPackaged ? {
          DSH_DESKTOP_MODULE_BASE_URL: pathToFileURL(join(app.getAppPath(), 'package.json')).href,
        } : {}),
        ...(developmentHost === undefined ? {} : { TSX_TSCONFIG_PATH: developmentHost.tsconfigPath }),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child.stdout?.on('data', (chunk) => { process.stderr.write(`[dsh-desktop-host] ${String(chunk)}`) })
    this.child.stderr?.on('data', (chunk) => { process.stderr.write(`[dsh-desktop-host] ${String(chunk)}`) })
    this.child.on('message', (value: unknown) => {
      if (!isDesktopHostMessage(value)) return
      const stream = this.streams.get(value.requestId)
      if (stream !== undefined) {
        stream(value)
        if (value.type === 'host-stream-end') this.streams.delete(value.requestId)
        return
      }
      const waiting = this.pending.get(value.requestId)
      if (waiting === undefined || value.type !== 'host-reply') return
      this.pending.delete(value.requestId)
      waiting.resolve(value)
    })
    this.child.on('exit', (code, signal) => {
      const error = new Error(`desktop Host exited${code === null ? ` by ${signal ?? 'unknown signal'}` : ` with code ${String(code)}`}`)
      for (const waiting of this.pending.values()) waiting.reject(error)
      this.pending.clear()
      for (const [requestId, listener] of this.streams) listener({
        version: DESKTOP_PROTOCOL_VERSION, type: 'host-stream-end', requestId, message: error.message,
      })
      this.streams.clear()
    })
  }

  request(request: Exclude<DesktopHostRequest, { type: 'host-cancel' }>): Promise<HostReply> {
    if (this.stopped) return Promise.reject(new Error('desktop Host is stopped'))
    return new Promise<HostReply>((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject })
      this.child.send(request, (error) => {
        if (error === null) return
        this.pending.delete(request.requestId)
        reject(error)
      })
    })
  }

  cancel(requestId: string): void {
    if (this.stopped || !this.child.connected) return
    this.child.send({ version: DESKTOP_PROTOCOL_VERSION, type: 'host-cancel', requestId } satisfies DesktopHostRequest)
  }

  openStream(streamId: string, channel: DesktopStreamChannel, listener: StreamListener): void {
    if (this.stopped) {
      listener({ version: DESKTOP_PROTOCOL_VERSION, type: 'host-stream-end', requestId: streamId, message: 'desktop Host is stopped' })
      return
    }
    this.streams.set(streamId, listener)
    this.child.send({ version: DESKTOP_PROTOCOL_VERSION, type: 'host-request', requestId: streamId, operation: 'stream', channel })
  }

  closeStream(streamId: string): void {
    this.streams.delete(streamId)
    this.cancel(streamId)
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (!this.child.connected) return
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        this.child.kill()
        done()
      }, DESKTOP_HOST_STOP_TIMEOUT_MS)
      this.child.once('exit', done)
      this.child.kill('SIGTERM')
    })
  }
}

function rendererIndex(): string {
  const packagedFrontend = join(
    app.getAppPath(),
    'node_modules',
    '@deepseek-ai',
    'dsh-web-frontend',
    'dist',
    'index.html',
  )
  if (existsSync(packagedFrontend)) return packagedFrontend
  const packaged = join(app.getAppPath(), 'apps', 'web', 'dist', 'index.html')
  if (existsSync(packaged)) return packaged
  return fileURLToPath(new URL('../../web/dist/index.html', import.meta.url))
}

function hostEntry(): string {
  const packaged = join(app.getAppPath(), 'lib', 'host.js')
  if (existsSync(packaged)) return packaged
  return fileURLToPath(new URL('./host.js', import.meta.url))
}

function presetRoot(): string {
  const packaged = join(process.resourcesPath, 'agent-presets')
  if (app.isPackaged && existsSync(packaged)) return packaged
  return fileURLToPath(new URL('../../cli/config/agent-presets/', import.meta.url))
}

function requestIdOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const requestId = (value as { requestId?: unknown }).requestId
  return typeof requestId === 'string' && requestId !== '' ? requestId : undefined
}

function streamRequestOf(value: unknown): { streamId: string; channel: DesktopStreamChannel } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as { streamId?: unknown; channel?: unknown }
  if (typeof row.streamId !== 'string' || row.streamId === '') return undefined
  if (row.channel !== 'mux' && row.channel !== 'host') return undefined
  return { streamId: row.streamId, channel: row.channel }
}

function shellMenuRequestOf(value: unknown): { menu: 'file' | 'edit' | 'view' | 'help'; x: number; y: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as { menu?: unknown; x?: unknown; y?: unknown }
  if (row.menu !== 'file' && row.menu !== 'edit' && row.menu !== 'view' && row.menu !== 'help') return undefined
  if (typeof row.x !== 'number' || typeof row.y !== 'number') return undefined
  return { menu: row.menu, x: Math.round(row.x), y: Math.round(row.y) }
}

function shellMenuTemplate(menu: 'file' | 'edit' | 'view' | 'help'): MenuItemConstructorOptions[] {
  switch (menu) {
    case 'file': return [
      { label: '关闭窗口', role: 'close' },
      { type: 'separator' },
      { label: '退出', role: 'quit' },
    ]
    case 'edit': return [
      { label: '撤销', role: 'undo' },
      { label: '重做', role: 'redo' },
      { type: 'separator' },
      { label: '剪切', role: 'cut' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
      { label: '全选', role: 'selectAll' },
    ]
    case 'view': return [
      { label: '重新加载', role: 'reload' },
      { label: '强制重新加载', role: 'forceReload' },
      { type: 'separator' },
      { label: '放大', role: 'zoomIn' },
      { label: '缩小', role: 'zoomOut' },
      { label: '重置缩放', role: 'resetZoom' },
      { type: 'separator' },
      { label: '全屏', role: 'togglefullscreen' },
    ]
    case 'help': return [
      { label: 'DeepSeek Harness', enabled: false },
      { label: '版本 0.1.0', enabled: false },
    ]
  }
}

async function main(): Promise<void> {
  configureDesktopChromiumStorage(process.env.LOCALAPPDATA ?? '', app.isPackaged, {
    setSessionDataPath: (path) => { app.setPath('sessionData', path) },
    setDiskCachePath: (path) => { app.commandLine.appendSwitch('disk-cache-dir', path) },
  })
  if (app.isPackaged && !app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  await app.whenReady()
  const host = new DesktopHostProcess(hostEntry())
  const terminals = new DesktopTerminals()
  const renderer = { id: undefined as number | undefined }
  ipcMain.handle('dsh:host-request', async (_event, value: unknown) => {
    if (renderer.id !== undefined && _event.sender.id !== renderer.id) throw new Error('desktop IPC sender is not trusted')
    if (!isDesktopHostRequest(value) || value.type !== 'host-request') {
      throw new Error('desktop IPC request is malformed')
    }
    const reply = await host.request(value)
    if (!reply.ok) throw new Error(reply.message)
    return reply
  })
  ipcMain.handle('dsh:pick-directory', async (event) => {
    if (renderer.id !== undefined && event.sender.id !== renderer.id) throw new Error('desktop IPC sender is not trusted')
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: 'Select Workspace Directory',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = owner === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(owner, options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.on('dsh:host-cancel', (event, value: unknown) => {
    if (renderer.id !== undefined && event.sender.id !== renderer.id) return
    if (isDesktopHostRequest(value) && value.type === 'host-cancel') host.cancel(value.requestId)
  })
  ipcMain.on('dsh:stream-open', (event, value: unknown) => {
    if (renderer.id !== undefined && event.sender.id !== renderer.id) return
    const request = streamRequestOf(value)
    if (request === undefined) return
    host.openStream(request.streamId, request.channel, (message) => {
      if (!event.sender.isDestroyed()) event.sender.send('dsh:stream-message', {
        streamId: request.streamId,
        message,
      })
    })
  })
  ipcMain.on('dsh:stream-cancel', (event, value: unknown) => {
    if (renderer.id !== undefined && event.sender.id !== renderer.id) return
    const requestId = requestIdOf(value)
    if (requestId !== undefined) host.closeStream(requestId)
  })
  ipcMain.on('dsh:shell-menu', (event, value: unknown) => {
    if (renderer.id !== undefined && event.sender.id !== renderer.id) return
    const request = shellMenuRequestOf(value)
    if (request === undefined) return
    const owner = BrowserWindow.fromWebContents(event.sender)
    Menu.buildFromTemplate(shellMenuTemplate(request.menu)).popup({
      ...(owner === null ? {} : { window: owner }),
      x: request.x,
      y: request.y,
    })
  })
  ipcMain.handle('dsh:terminal-open', async (event, value: unknown) => {
    if (renderer.id !== undefined && event.sender.id !== renderer.id) throw new Error('desktop IPC sender is not trusted')
    const request = terminalRequestOf(value)
    if (request?.cwd === undefined) throw new Error('desktop terminal request is malformed')
    await terminals.open(request.terminalId, request.cwd, (message) => {
      if (!event.sender.isDestroyed()) event.sender.send('dsh:terminal-message', { terminalId: request.terminalId, message })
    })
  })
  ipcMain.on('dsh:terminal-write', (event, value: unknown) => {
    if (renderer.id !== undefined && event.sender.id !== renderer.id) return
    const request = terminalRequestOf(value)
    if (request?.data !== undefined) terminals.write(request.terminalId, request.data)
  })
  ipcMain.on('dsh:terminal-close', (event, value: unknown) => {
    if (renderer.id !== undefined && event.sender.id !== renderer.id) return
    const request = terminalRequestOf(value)
    if (request !== undefined) void terminals.close(request.terminalId)
  })
  ipcMain.handle('dsh:save-file', async (event, value: unknown) => {
    if (renderer.id !== undefined && event.sender.id !== renderer.id) throw new Error('desktop IPC sender is not trusted')
    const request = saveFileRequestOf(value)
    if (request === undefined) throw new Error('desktop save request is malformed')
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = { defaultPath: request.filename, filters: [{ name: 'ZIP archive', extensions: ['zip'] }] }
    const result = owner === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(owner, options)
    if (result.canceled) return false
    await writeFile(result.filePath, Buffer.from(request.bodyBase64, 'base64'))
    return true
  })

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f7f8fa',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f4f7fb',
      symbolColor: '#747b88',
      height: 48,
    },
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.js', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  app.on('second-instance', () => {
    if (window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  window.setMenuBarVisibility(false)
  renderer.id = window.webContents.id
  const rendererPath = rendererIndex()
  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    if (target.protocol !== 'file:' || fileURLToPath(target) !== rendererPath) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url)
    if (target.protocol === 'http:' || target.protocol === 'https:') {
      void shell.openExternal(target.toString()).catch(() => {
        // An external-link failure must not affect the running desktop session.
      })
    }
    return { action: 'deny' }
  })
  await window.loadFile(rendererPath)

  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    if (!window.isDestroyed()) window.destroy()
    void Promise.all([terminals.closeAll(), host.stop()]).finally(() => { app.exit(0) })
  })
  app.on('window-all-closed', () => { if (!quitting && process.platform !== 'darwin') app.quit() })
}

void main().catch((error: unknown) => {
  process.stderr.write(`dsh desktop: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  app.exit(1)
})
