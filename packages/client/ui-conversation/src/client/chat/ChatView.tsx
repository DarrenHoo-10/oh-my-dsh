// ChatView: the default conversation view — one stable keyed parent list over
// final business Nodes, plus paging, pending steering and bottom-follow.
// Each row dispatches through 'conversation.chat.node'; ui-tool owns the
// tool-call renderer and its recursive root/subcall composition.
//
// Scroll: when nested under `[data-conversation-scroll]` (active conversation
// column), that host is the scrollport and this view is flow content; when
// mounted alone (unit tests), `.scroll` owns overflow. Bottom-follow and
// prepend anchoring always target the resolved scrollport.
//
// Render economics: order changes only when rows enter, leave or move. Each
// ChatNodeSeat subscribes to one Node key, so Assistant deltas and Tool
// lifecycle updates replace only their own row without remounting it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, SyntheticEvent } from 'react'
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { PendingSteeringBubble } from './MessageItem.tsx'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { formatRunDuration } from './message-chrome.ts'
import css from './ChatView.module.css'

const FOLLOW_THRESHOLD = 24

/** Active column host when present; otherwise the view-local scroller. */
function scrollerOf(from: HTMLElement): HTMLElement {
  return (from.closest('[data-conversation-scroll]')) ?? from
}

interface PagingAnchor {
  /** Stable node/call identity, independent of boundary-spanning group keys. */
  key: string
  /** Row top relative to the scrollport after the latest user scroll. */
  top: number
}

interface SelectedExcerpt {
  readonly text: string
  readonly anchorKey: string
  readonly start: number
  readonly end: number
  readonly left: number
  readonly top: number
}

interface AnnotationEditor extends SelectedExcerpt {
  readonly id: string
}

interface HighlightRegistry {
  set(name: string, highlight: Highlight): void
  delete(name: string): boolean
}

function highlightRegistry(): HighlightRegistry | undefined {
  return (globalThis.CSS as typeof CSS & { highlights?: HighlightRegistry } | undefined)?.highlights
}

/** Convert a row-relative character range back into a DOM Range. */
function excerptRange(row: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  let offset = 0
  let startNode: Text | null = null
  let endNode: Text | null = null
  let startOffset = 0
  let endOffset = 0
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text
    const next = offset + text.data.length
    if (startNode === null && start >= offset && start <= next) {
      startNode = text
      startOffset = start - offset
    }
    if (end >= offset && end <= next) {
      endNode = text
      endOffset = end - offset
      break
    }
    offset = next
  }
  if (startNode === null || endNode === null) return null
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

/** Find an already-rendered settled row without interpolating a selector. */
function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** Select a visible stable node/call identity, falling back only when layout
 * has not exposed a visible box yet. */
function pagingAnchor(list: HTMLElement, scrollport: HTMLElement): HTMLElement | null {
  const viewport = scrollport.getBoundingClientRect()
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom
  // Scroll events are hot: hit-test a few points through the stretched flow
  // rows before considering the full mounted set. The fallback keeps jsdom
  // and pre-layout states deterministic; a virtualizer naturally bounds it.
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    const content = list.getBoundingClientRect()
    const left = Math.max(viewport.left, content.left)
    const right = Math.min(viewport.right, content.right)
    const x = left + Math.max(0, right - left) / 2
    const height = visibleBottom - viewport.top
    const points = [1, Math.min(32, height / 3), height / 2, Math.max(1, height - 1)]
    for (const offset of points) {
      for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
        const row = element instanceof HTMLElement
          ? element.closest<HTMLElement>('[data-chat-anchor-key]')
          : null
        if (row !== null && list.contains(row)) return row
      }
    }
  }
  const rows = [...list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')]
  const visibleRows = rows.filter((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < visibleBottom
  })
  return visibleRows[0] ?? rows[0] ?? null
}

type ChatScrollPosition = NonNullable<ReturnType<ChatViewSlotProps['chatScroll']['read']>>

/** Capture a reflow-resistant reader position from the current rendered window. */
function scrollPosition(list: HTMLElement, scrollport: HTMLElement): ChatScrollPosition | null {
  const row = pagingAnchor(list, scrollport)
  const anchorKey = row?.dataset.chatAnchorKey
  if (row === null || anchorKey === undefined) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop,
  }
}

function runningTurnStartTime(timeline: ConversationTimelineSnapshot): number | null {
  let latest: number | null = null
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open' && turn.start !== undefined) latest = turn.start.time
  }
  return latest
}

/** Turn-level model activity label retained across first-token, tool, and streaming phases. */
function TurnStatus({ startTime, t }: {
  /** The running turn's logged `turn/start` time; null falls back to mount
   *  time when that boundary is outside the window. */
  startTime: number | null
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}) {
  const [mountedAt] = useState(() => Date.now())
  // Anchored to turn/start so a mid-turn reload keeps the real
  // elapsed time and the final footer's Ran-for label matches this clock.
  const anchor = startTime ?? mountedAt
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - anchor))
  useEffect(() => {
    const tick = (): void => {
      setElapsedMs(Math.max(0, Date.now() - anchor))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { clearInterval(id) }
  }, [anchor])
  // Short turns keep the plain label; the clock only appears once the turn
  // has clearly been running for a while.
  const showClock = elapsedMs >= 15_000
  return (
    <div className={css.turnStatus} role="status" aria-live="polite">
      Deep diving...
      {showClock && (
        <span className={css.turnStatusClock} aria-hidden>
          {formatRunDuration(elapsedMs, t)}
        </span>
      )}
    </div>
  )
}

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView({
  useSession, useSessions, useStore, useInput, renderSlot, sessionId, openFile, loadOlder, loadImage, inspectCall, chatScroll, forkAt,
  returnToParent, fileMentions, addToConversation, removeFromConversation, askInSideChat, visibleFromSeq, t,
}: ChatViewSlotProps) {
  const order = useSession(s => s.chat.order)
  const nodeStore = useSession(s => s.chat.nodes)
  const visibleOrder = useMemo(() => visibleFromSeq === undefined
    ? order
    : order.filter(key => (nodeStore.get(key)?.anchorSeq ?? -1) >= visibleFromSeq),
  [nodeStore, order, visibleFromSeq])
  const timeline = useSession(s => s.chat.timeline)
  const inbox = useSession(s => s.queue)
  // Workspace root off the session list row: path summaries display relative to it.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const running = useSession(s => s.running)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
  const selectedCallId = useStore(s => s.selection?.callId)
  const annotations = useInput(s => s.annotations ?? [])

  const pendingSteering = useMemo(
    () => inbox.filter(item => item.placement === 'steering'),
    [inbox],
  )
  const runningTurnStart = useMemo(() => runningTurnStartTime(timeline), [timeline])

  const listRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [selectionMenu, setSelectionMenu] = useState<SelectedExcerpt | null>(null)
  const [annotationEditor, setAnnotationEditor] = useState<AnnotationEditor | null>(null)
  const [annotationComment, setAnnotationComment] = useState('')
  const [annotationPins, setAnnotationPins] = useState<readonly {
    id: string
    left: number
    top: number
    index: number
    quote: string
    comment: string
  }[]>([])

  const dismissSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setSelectionMenu(null)
  }, [])

  const captureSelection = useCallback((event: SyntheticEvent<HTMLElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('[data-selection-actions]') !== null) return
    const selection = window.getSelection()
    const raw = selection?.toString() ?? ''
    if (selection === null || selection.rangeCount === 0 || raw.trim() === '') {
      setSelectionMenu(null)
      return
    }
    const range = selection.getRangeAt(0)
    const root = listRef.current
    if (root === null || !root.contains(range.commonAncestorContainer)) {
      setSelectionMenu(null)
      return
    }
    const startElement = range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
    const endElement = range.endContainer instanceof Element
      ? range.endContainer
      : range.endContainer.parentElement
    const row = startElement?.closest<HTMLElement>('[data-chat-anchor-key]') ?? null
    if (row === null || endElement?.closest('[data-chat-anchor-key]') !== row) {
      setSelectionMenu(null)
      return
    }
    const prefix = document.createRange()
    prefix.selectNodeContents(row)
    prefix.setEnd(range.startContainer, range.startOffset)
    const leading = raw.length - raw.trimStart().length
    const text = raw.trim()
    const start = prefix.toString().length + leading
    const rect = range.getBoundingClientRect()
    setSelectionMenu({
      text,
      anchorKey: row.dataset.chatAnchorKey ?? '',
      start,
      end: start + text.length,
      left: Math.max(12, Math.min(window.innerWidth - 420, rect.left + rect.width / 2)),
      top: Math.max(8, rect.top - 48),
    })
  }, [])

  useLayoutEffect(() => {
    const root = listRef.current
    if (root === null) return
    const update = (): void => {
      const pins = annotations.flatMap((annotation, index) => {
        const row = anchorElement(root, annotation.anchorKey)
        const range = row === null ? null : excerptRange(row, annotation.start, annotation.end)
        if (range === null) return []
        const rect = range.getBoundingClientRect()
        return [{
          id: annotation.id,
          left: rect.right + 7,
          top: rect.top - 7,
          index: index + 1,
          quote: annotation.quote,
          comment: annotation.comment,
        }]
      })
      setAnnotationPins(pins)
    }
    update()
    const scrollport = scrollerOf(root)
    const resizeObserver = annotations.length === 0 || typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(update)
    resizeObserver?.observe(root)
    const column = columnRef.current
    if (column !== null) resizeObserver?.observe(column)
    scrollport.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      resizeObserver?.disconnect()
      scrollport.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [annotations])

  useLayoutEffect(() => {
    const registry = highlightRegistry()
    const root = listRef.current
    if (registry === undefined || root === null || typeof Highlight === 'undefined') return
    const ranges = annotations.flatMap((annotation) => {
      const row = anchorElement(root, annotation.anchorKey)
      const range = row === null ? null : excerptRange(row, annotation.start, annotation.end)
      return range === null ? [] : [range]
    })
    registry.set('dsh-composer-annotations', new Highlight(...ranges))
    return () => { registry.delete('dsh-composer-annotations') }
  }, [annotations, visibleOrder])

  const saveAnnotation = (event: FormEvent): void => {
    event.preventDefault()
    if (annotationEditor === null) return
    addToConversation({
      id: annotationEditor.id,
      anchorKey: annotationEditor.anchorKey,
      start: annotationEditor.start,
      end: annotationEditor.end,
      quote: annotationEditor.text,
      comment: annotationComment.trim(),
    })
    setAnnotationEditor(null)
    setAnnotationComment('')
    dismissSelection()
    focusComposer()
  }

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('[data-composer-seat] textarea')?.focus()
    })
  }, [])
  /** Last position delivered or written on the main thread. */
  const observedTopRef = useRef(0)
  /** Paging anchor: semantic row/position at click, updated by reader scrolls
   * while the request is pending and restored after the prepend lands. */
  const anchorRef = useRef<PagingAnchor | null>(null)
  const firstSeqRef = useRef<number | null>(null)
  const openedRef = useRef(false)
  const lastKeyRef = useRef<string | null>(null)
  const lastSteeringIdRef = useRef<string | null>(null)
  /** Flow tip signature — follow-scroll only when this moves, never on a
   *  scroll-driven at-bottom chrome re-render (which would snap inertial
   *  scrolls the rest of the way to the floor). */
  const followSigRef = useRef<string | null>(null)

  const firstKey = visibleOrder[0]
  const firstSeq = firstKey === undefined ? null : nodeStore.get(firstKey)?.anchorSeq ?? null
  const lastKey = visibleOrder.at(-1) ?? null
  const lastNode = lastKey === null ? undefined : nodeStore.get(lastKey)
  const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null
  const followSig = `${openState}:${firstSeq}:${lastKey}:${visibleOrder.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}`

  const toBottom = (el: HTMLElement): void => {
    anchorRef.current = null
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    atBottomRef.current = true
    setAtBottom(true)
    chatScroll.save(null)
  }

  useLayoutEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    const el = scrollerOf(local)
    // Open completed: jump to the bottom once — unless a scroll position
    // survives from a previous mount (view-tab switch away and back), which
    // is restored instead of snapping the reader back to the floor.
    if (openState === 'open' && !openedRef.current) {
      openedRef.current = true
      const saved = chatScroll.read()
      if (saved === null) {
        toBottom(el)
      } else {
        el.scrollTop = saved.scrollTop
        const row = anchorElement(local, saved.anchorKey)
        if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop
        observedTopRef.current = el.scrollTop
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
        atBottomRef.current = isAtBottom
        setAtBottom(isAtBottom)
        const normalized = isAtBottom ? null : scrollPosition(local, el)
        if (isAtBottom) chatScroll.save(null)
        else if (normalized !== null) chatScroll.save(normalized)
      }
      firstSeqRef.current = firstSeq
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    // Prepend (head seq decreased): preserve the same settled row at the
    // position established by the reader's latest scroll. This excludes
    // unrelated tail/composer growth while the request was in flight.
    if (anchorRef.current !== null && firstSeq !== null && firstSeqRef.current !== null && firstSeq < firstSeqRef.current) {
      const anchor = anchorRef.current
      anchorRef.current = null
      const row = anchorElement(local, anchor.key)
      if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top
      observedTopRef.current = el.scrollTop
      firstSeqRef.current = firstSeq
      /* v8 ignore next -- ?? arm: a prepend adds nodes, so the flow list here is never empty. */
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    firstSeqRef.current = firstSeq
    // Own words must be visible: a new trailing user node force-scrolls
    // (send lives in the composer, so arrival is detected here, not armed there).
    const appendedUser = lastKey !== lastKeyRef.current && lastNode?.kind === 'user'
    const appendedSteering = lastSteeringId !== null && lastSteeringId !== lastSteeringIdRef.current
    const tipMoved = followSigRef.current !== followSig
    lastKeyRef.current = lastKey
    lastSteeringIdRef.current = lastSteeringId
    followSigRef.current = followSig
    // Follow new flow content while pinned; do NOT re-pin on every render
    // merely because atBottomRef is true (scroll threshold → setState → snap).
    if (appendedUser || appendedSteering || (tipMoved && atBottomRef.current)) toBottom(el)
  })

  const onScrollRef = useRef(() => {})
  onScrollRef.current = () => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    // Only reader input may make raw scroll geometry change follow ownership:
    // a delivered position that deviates from the observed-top ledger (every
    // programmatic write records itself there synchronously). This covers
    // wheel, touch, scrollbar, and keyboard alike without naming devices.
    // Browser shrink-clamps land exactly on the floor min and delayed
    // programmatic deliveries land on the ledger itself, so both preserve
    // the current ownership state.
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const movedByReader = Math.abs(el.scrollTop - Math.min(observedTopRef.current, floor)) > 0.5
    const isAtBottom = movedByReader
      ? floor - el.scrollTop <= FOLLOW_THRESHOLD + 1
      : atBottomRef.current
    if (!movedByReader && isAtBottom) {
      toBottom(el)
      return
    }
    atBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
    const position = isAtBottom ? null : scrollPosition(local, el)
    if (isAtBottom) {
      anchorRef.current = null
    } else if (anchorRef.current !== null && position !== null) {
      anchorRef.current = { key: position.anchorKey, top: position.anchorTop }
    }
    // Continuous save (unmount happens after ref detach, so saving there is
    // too late); pinned-to-bottom clears so a remount keeps following.
    if (isAtBottom) chatScroll.save(null)
    else if (position !== null) chatScroll.save(position)
    observedTopRef.current = el.scrollTop
  }

  // Bind the scroll listener on the resolved scrollport once per mount;
  // reader-input attribution rides the observed-top ledger, not per-device
  // input listeners.
  useEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
    if (local === null) return
    const el = scrollerOf(local)
    const onScroll = (): void => { onScrollRef.current() }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  // The ref starts null and is assigned every render, so the placeholder
  // initializer a function initial value would need never exists.
  const followRef = useRef<(() => void) | null>(null)
  followRef.current = () => {
    const local = listRef.current
    if (local === null) return
    const el = scrollerOf(local)
    if (!atBottomRef.current) return
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    chatScroll.save(null)
  }
  // Streaming, tool disclosures, and other flow changes resize the column;
  // the sticky composer resizes outside it. This observer owns ChatView's
  // dynamic-height follow decisions and writes only while the reader is pinned.
  useEffect(() => {
    const column = columnRef.current
    const local = listRef.current
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    const scrollport = scrollerOf(local)
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    const observer = new ResizeObserver(() => { followRef.current?.() })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => { observer.disconnect() }
  }, [])

  // A failed/empty page leaves the head unchanged. Once the request leaves
  // its busy state there is no future prepend for the saved anchor to own.
  useEffect(() => {
    if (!loadingOlder) anchorRef.current = null
  }, [loadingOlder])

  const loadOlderAnchored = (): void => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the paging button renders inside the list tree. */
    if (local !== null) {
      const el = scrollerOf(local)
      const row = pagingAnchor(local, el)
      if (row !== null && row.dataset.chatAnchorKey !== undefined) {
        anchorRef.current = {
          key: row.dataset.chatAnchorKey,
          top: flowTop(row, el),
        }
      }
    }
    loadOlder()
  }

  return (
    <div className={css.root}
      data-side-chat={visibleFromSeq === undefined ? undefined : ''}
      data-running={running ? '' : undefined}
      onPointerUp={captureSelection} onKeyUp={captureSelection}>
      {selectionMenu !== null && (
        <div
          className={css.selectionActions}
          data-selection-actions=""
          style={{ left: selectionMenu.left, top: selectionMenu.top }}
          role="toolbar"
          aria-label={t('selection.add')}
          onPointerDown={(event) => { event.preventDefault() }}
        >
          <button type="button" onClick={() => {
            const id = crypto.randomUUID()
            addToConversation({
              id,
              anchorKey: selectionMenu.anchorKey,
              start: selectionMenu.start,
              end: selectionMenu.end,
              quote: selectionMenu.text,
              comment: '',
            })
            setAnnotationEditor({ ...selectionMenu, id })
            setAnnotationComment('')
            setSelectionMenu(null)
          }}>{t('selection.add')}</button>
          <button type="button" onClick={() => {
            askInSideChat({
              id: crypto.randomUUID(),
              anchorKey: selectionMenu.anchorKey,
              start: selectionMenu.start,
              end: selectionMenu.end,
              quote: selectionMenu.text,
              comment: '',
            })
            dismissSelection()
          }}>{t('selection.sideChat')}</button>
        </div>
      )}
      {annotationEditor !== null && (
        <form
          className={css.annotationEditor}
          data-selection-actions=""
          style={{ left: annotationEditor.left, top: annotationEditor.top }}
          onSubmit={saveAnnotation}
        >
          <textarea
            autoFocus
            value={annotationComment}
            placeholder={t('selection.commentPlaceholder')}
            onChange={(event) => { setAnnotationComment(event.currentTarget.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setAnnotationEditor(null)
              if (event.key === 'Enter' && !event.shiftKey) saveAnnotation(event)
            }}
          />
          <div className={css.annotationButtons}>
            <button type="button" className={css.annotationDelete} aria-label={t('selection.delete')} onClick={() => {
              removeFromConversation(annotationEditor.id)
              setAnnotationEditor(null)
            }}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <path d="M3 4h10M6 4V2.5h4V4m2 0-.5 9h-7L4 4m3 2v5m2-5v5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
            <button type="button" onClick={() => { setAnnotationEditor(null) }}>{t('selection.cancel')}</button>
            <button type="submit">{t('selection.save')}</button>
          </div>
        </form>
      )}
      {annotationPins.map(pin => (
        <button key={pin.id} type="button" className={css.annotationPin} style={{ left: pin.left, top: pin.top }}
          aria-label={t('selection.edit', { index: pin.index })}
          onClick={() => {
            const annotation = annotations.find(item => item.id === pin.id)
            if (annotation === undefined) return
            setAnnotationEditor({
              id: annotation.id,
              text: annotation.quote,
              anchorKey: annotation.anchorKey,
              start: annotation.start,
              end: annotation.end,
              left: pin.left + 12,
              top: pin.top + 32,
            })
            setAnnotationComment(annotation.comment)
          }}>
          {pin.index}
          <span className={css.annotationPreview} role="tooltip">
            <strong>{pin.index}. {t('selection.selectedText')}</strong>
            <span>{pin.quote}</span>
            {pin.comment !== '' && <span>{pin.comment}</span>}
          </span>
        </button>
      ))}
      <div ref={listRef} className={css.scroll}>
        <div ref={columnRef} className={css.column} data-chat-flow="">
          {openState === 'loading' && <div className={css.hint}>{t('chat.loadingHistory')}</div>}
          {openState === 'error' && openError !== null && (
            <div className={css.openError}>
              {t('chat.loadError', { message: openError.message, code: openError.code })}
            </div>
          )}
          {visibleFromSeq === undefined && hasMore && (
            <div className={css.older}>
              <button type="button" disabled={loadingOlder} onClick={loadOlderAnchored}>
                {loadingOlder ? t('loading') : t('chat.loadOlder')}
              </button>
            </div>
          )}
          {visibleOrder.map(nodeKey => (
            <ChatNodeSeat
              key={nodeKey}
              nodeKey={nodeKey}
              useSession={useSession}
              selectedCallId={selectedCallId}
              cwd={cwd}
              openFile={openFile}
              inspectCall={inspectCall}
              forkAt={forkAt}
              returnToParent={returnToParent}
              loadImage={loadImage}
              fileMentions={fileMentions}
              renderSlot={renderSlot}
              t={t}
            />
          ))}
          {/* No pending placeholders: questions (ui-user-questions) and approvals
              (ApprovalPanel) both take over the composer, so a flow card would
              double-render the same wait. */}
          {/* Turn-level loading signal: rides the whole running turn (first-token
              wait, tool execution, streaming) so it never flickers per step. */}
          {running && <TurnStatus startTime={runningTurnStart} t={t} />}
          {pendingSteering.map(item => (
            <PendingSteeringBubble key={item.id} content={item.content} loadImage={loadImage} t={t} />
          ))}
        </div>
        {!atBottom && (
          <div className={css.toBottomSlot}>
            <button
              type="button"
              className={css.toBottom}
              aria-label={t('chat.toBottom')}
              onClick={() => {
                const local = listRef.current
                /* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
                if (local !== null) toBottom(scrollerOf(local))
              }}
            >
              <IconChevronDownOutline14 />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
