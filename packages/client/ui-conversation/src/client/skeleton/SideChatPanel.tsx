import { useEffect, useState } from 'react'
import type { SideChatSlotProps } from '../contract/slots.ts'
import css from './SideChatPanel.module.css'

/** Contextual fork tabs rendered inside the narrow right-side panel. */
export function SideChatPanel({
  useSessions, useStore, actions, closeSideChat, openLocation, renderSlot, SessionProvider,
  createSideChat, openConversationWindow, discardSideChat, t,
}: SideChatSlotProps) {
  const tabs = useStore(s => s.sideChatTabs)
  const activeId = useStore(s => s.activeSideChatTabId)
  const active = tabs.find(tab => tab.id === activeId) ?? tabs.at(-1)
  const childId = active?.sessionId ?? null
  const cwd = useSessions(s => childId === null ? undefined : s.byId[childId]?.cwd)
  const seedLength = useSessions(s => childId === null ? undefined : s.byId[childId]?.seedLength)
  const childKnown = useSessions(s => childId !== null && s.byId[childId] !== undefined)
  const [windowState, setWindowState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  useEffect(() => {
    if (active === undefined || (childId !== null && childKnown)) return
    actions.closeSideChatTab(active.id)
    if (tabs.length === 1) closeSideChat()
  }, [actions, active, childId, childKnown, closeSideChat, tabs.length])

  useEffect(() => {
    if (childId === null || !childKnown) {
      setWindowState('idle')
      return
    }
    let current = true
    setWindowState('loading')
    void openConversationWindow(childId).then(() => {
      if (current) setWindowState('ready')
    }, (reason: unknown) => {
      if (!current) return
      console.warn('side chat window load rejected:', reason)
      setWindowState('error')
    })
    return () => { current = false }
  }, [childId, childKnown, openConversationWindow])

  const closeTab = async (id: string): Promise<void> => {
    const tab = tabs.find(item => item.id === id)
    if (tab === undefined) return
    try {
      await discardSideChat(tab.sessionId)
    } catch (reason: unknown) {
      console.warn('side chat discard rejected:', reason)
      return
    }
    actions.closeSideChatTab(id)
    if (tabs.length === 1) closeSideChat()
  }

  const closePanel = async (): Promise<void> => {
    const outcomes = await Promise.allSettled(tabs.map(tab => discardSideChat(tab.sessionId)))
    let failed = false
    for (const [index, outcome] of outcomes.entries()) {
      const tab = tabs[index]
      if (tab === undefined) continue
      if (outcome.status === 'fulfilled') {
        actions.closeSideChatTab(tab.id)
      } else {
        failed = true
        console.warn('side chat discard rejected:', outcome.reason)
      }
    }
    if (!failed) closeSideChat()
  }

  return (
    <aside className={css.root} aria-label={t('sideChat.title')}>
      <header className={css.header}>
        <div className={css.tabs}>
          {tabs.map((tab, index) => (
            <button type="button" key={tab.id} className={tab.id === active?.id ? css.activeTab : css.tab}
              onClick={() => { actions.activateSideChat(tab.id) }}>
              <span>{tabs.length === 1 ? t('sideChat.title') : `${t('sideChat.title')} ${index + 1}`}</span>
              <span className={css.tabClose} role="button" tabIndex={0} aria-label={t('sideChat.close')}
                onClick={(event) => { event.stopPropagation(); void closeTab(tab.id) }}
                onKeyDown={(event) => { if (event.key === 'Enter') void closeTab(tab.id) }}>×</span>
            </button>
          ))}
          <button type="button" className={css.newTab} aria-label={t('sideChat.new')}
            onClick={createSideChat}>＋</button>
        </div>
        <div className={css.headerActions}>
          {cwd !== undefined && childId !== null && (
            <button type="button" onClick={() => { openLocation(childId) }}>{t('details.openLocation')}</button>
          )}
          <button type="button" aria-label={t('sideChat.close')} onClick={() => { void closePanel() }}>×</button>
        </div>
      </header>
      {childId !== null && childKnown && (
        <SessionProvider sessionId={childId}>
          {() => (
            <>
              <div className={css.body}>
                {windowState === 'loading' && <div className={css.loadState}>{t('sideChat.loading')}</div>}
                {windowState === 'error' && <div className={css.loadState}>{t('sideChat.loadError')}</div>}
                {windowState === 'ready' && (
                  <>
                    <div className={css.emptyState}>
                      <div className={css.emptyIcon}>⊕</div>
                      <strong>{t('sideChat.title')}</strong>
                      <p>{t('sideChat.empty')}</p>
                    </div>
                    {renderSlot('conversation.view', {
                      inspect: null,
                      onInspectDone: () => {},
                      ...(seedLength === undefined ? {} : { visibleFromSeq: seedLength }),
                    }, { only: 'chat' })}
                  </>
                )}
              </div>
              {windowState === 'ready' && (
                <div className={css.composerWrap}>
                  {renderSlot('conversation.session.composer', {})}
                </div>
              )}
            </>
          )}
        </SessionProvider>
      )}
    </aside>
  )
}
