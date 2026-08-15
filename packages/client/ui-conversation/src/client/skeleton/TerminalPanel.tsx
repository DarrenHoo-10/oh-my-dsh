import { useEffect, useRef, useState } from 'react'
import type { DetailsSlotProps } from '../contract/slots.ts'
import css from './TerminalPanel.module.css'

interface TerminalBridge {
  openTerminal?(terminalId: string, cwd: string, listener: (message:
    | { type: 'output'; data: string }
    | { type: 'cwd'; cwd: string }
    | { type: 'exit'; code: number | null }
    | { type: 'error'; message: string }) => void): Promise<void>
  writeTerminal?(terminalId: string, data: string): void
  closeTerminal?(terminalId: string): void
}

function desktopBridge(): TerminalBridge | undefined {
  return (globalThis as { __DSH_DESKTOP__?: TerminalBridge }).__DSH_DESKTOP__
}

function plainTerminalText(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

/** Remove terminal control sequences before rendering process output. */
export function visibleTerminalOutput(value: string): string {
  return plainTerminalText(value)
}

function isClearCommand(value: string): boolean {
  return /^(?:clear|cls|clear-host)$/i.test(value.trim())
}

/** Desktop-local command terminal rooted at the current Session workspace. */
export function TerminalPanel({ useSessions, sessionId, closeDetails, openLocation, t }: DetailsSlotProps) {
  const cwd = useSessions(list => list.byId[sessionId]?.cwd)
  const terminalId = useRef(`terminal-${crypto.randomUUID()}`)
  const outputRef = useRef<HTMLDivElement | null>(null)
  const [output, setOutput] = useState('')
  const [draft, setDraft] = useState('')
  const [ready, setReady] = useState(false)
  const [currentCwd, setCurrentCwd] = useState(cwd)

  useEffect(() => {
    const bridge = desktopBridge()
    if (bridge?.openTerminal === undefined || bridge.closeTerminal === undefined || cwd === undefined) {
      setOutput(t('terminal.desktopOnly'))
      return
    }
    const id = terminalId.current
    const closeTerminal = (targetId: string): void => { bridge.closeTerminal?.(targetId) }
    setOutput('')
    setCurrentCwd(cwd)
    void bridge.openTerminal(id, cwd, (message) => {
      if (message.type === 'output') {
        const visible = visibleTerminalOutput(message.data)
        if (visible !== '') setOutput(current => current + visible)
      }
      if (message.type === 'cwd') setCurrentCwd(message.cwd)
      if (message.type === 'error') setOutput(current => `${current}\n${message.message}\n`)
      if (message.type === 'exit') {
        setReady(false)
        setOutput(current => `${current}\n${t('terminal.exited', { code: message.code ?? '-' })}\n`)
      }
    }).then(() => { setReady(true) }, (error: unknown) => {
      setOutput(error instanceof Error ? error.message : String(error))
    })
    return () => { closeTerminal(id) }
  }, [cwd, t])

  useEffect(() => {
    const node = outputRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [output])

  const submit = (): void => {
    const command = draft.trim()
    if (!ready || command === '') return
    if (isClearCommand(command)) {
      setOutput('')
      setDraft('')
      return
    }
    setOutput(current => `${current}${current.endsWith('\n') ? '' : '\n'}PS ${currentCwd ?? ''}> ${command}\n`)
    desktopBridge()?.writeTerminal?.(terminalId.current, `${command}\r\n`)
    setDraft('')
  }

  return (
    <section className={css.root} aria-label={t('terminal.title')}>
      <header className={css.header}>
        <div><strong>{t('terminal.title')}</strong>{currentCwd !== undefined && <span>{currentCwd}</span>}</div>
        <div className={css.actions}>
          {cwd !== undefined && <button type="button" onClick={openLocation}>{t('details.openLocation')}</button>}
          <button type="button" aria-label={t('details.close')} onClick={closeDetails}>×</button>
        </div>
      </header>
      <div ref={outputRef} className={css.terminalBody}>
        <pre className={css.output}>{output}</pre>
        <div className={css.commandRow}>
          <span data-terminal-prompt="">PS {currentCwd ?? ''}&gt;</span>
          <input autoFocus value={draft} disabled={!ready} placeholder={t('terminal.placeholder')}
            onChange={(event) => { setDraft(event.currentTarget.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
              if (event.key === 'c' && event.ctrlKey) desktopBridge()?.writeTerminal?.(terminalId.current, '\x03')
            }} />
        </div>
      </div>
    </section>
  )
}
