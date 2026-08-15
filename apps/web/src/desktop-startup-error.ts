function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Replace the desktop application mount point with a self-contained startup failure report. */
export function renderDesktopStartupError(root: HTMLElement, error: unknown): void {
  const screen = document.createElement('main')
  screen.className = 'dsh-desktop-startup-error'

  const card = document.createElement('section')
  card.className = 'dsh-desktop-startup-error-card'

  const wordmark = document.createElement('div')
  wordmark.className = 'dsh-desktop-startup-error-wordmark'
  wordmark.textContent = 'HARNESS'

  const title = document.createElement('h1')
  title.textContent = 'Failed to load plugins'

  const details = document.createElement('pre')
  details.textContent = errorMessage(error)

  card.append(wordmark, title, details)
  screen.append(card)
  root.replaceChildren(screen)
}
