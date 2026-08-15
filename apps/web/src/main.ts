/**
 * Web application entry: thin bootstrap over the shell library. Everything —
 * loader holding, module-table seeding, AppRoot gate, plugin assembly — lives
 * in @deepseek-ai/dsh-client-web; this file only finds the mount point.
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { installDesktopShell } from './desktop-shell.ts'
import { renderDesktopStartupError } from './desktop-startup-error.ts'
import './desktop-shell.css'

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')

interface DesktopShell {
  getBootManifest(): Promise<unknown>
  loadBundle(url: string, signal?: AbortSignal): Promise<string>
  showShellMenu(menu: 'file' | 'edit' | 'view' | 'help', x: number, y: number): void
}

const desktop = (globalThis as { __DSH_DESKTOP__?: DesktopShell }).__DSH_DESKTOP__
if (desktop === undefined) {
  void new AppWebEntry(el).run()
} else {
  installDesktopShell(desktop)
  void (async () => {
    ;(globalThis as { __DSH_BOOT__?: unknown }).__DSH_BOOT__ = await desktop.getBootManifest()
    await new AppWebEntry(el, {
      loadBundle: async (url) => {
        const script = document.createElement('script')
        script.textContent = await desktop.loadBundle(url)
        document.head.append(script)
        script.remove()
      },
    }).run()
  })().catch((error: unknown) => {
    console.error('desktop startup failed', error)
    renderDesktopStartupError(el, error)
  })
}
