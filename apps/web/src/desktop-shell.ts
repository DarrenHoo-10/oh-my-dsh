/** Desktop-only title bar mounted before the plugin-composed application. */

interface DesktopShellBridge {
  showShellMenu(menu: 'file' | 'edit' | 'view' | 'help', x: number, y: number): void
}

function iconButton(label: string, path: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'dsh-desktop-titlebar-icon'
  button.ariaLabel = label
  button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${path}"/></svg>`
  return button
}

/** Install the Windows title bar around the existing Web application root. */
export function installDesktopShell(bridge: DesktopShellBridge): void {
  document.body.dataset.dshDesktopShell = ''
  const bar = document.createElement('header')
  bar.className = 'dsh-desktop-titlebar'

  const toggle = iconButton('切换侧边栏', 'M3.5 3.5h13v13h-13zM8 4v12')
  toggle.addEventListener('click', () => {
    window.dispatchEvent(new Event('dsh:desktop-toggle-sidebar'))
  })
  bar.append(toggle)

  const back = iconButton('后退', 'M11.5 4 5.5 10l6 6M6 10h9')
  back.disabled = true
  const forward = iconButton('前进', 'm8.5 4 6 6-6 6m5.5-6H5')
  forward.disabled = true
  bar.append(back, forward)

  const labels = [
    ['file', '文件'],
    ['edit', '编辑'],
    ['view', '视图'],
    ['help', '帮助'],
  ] as const
  for (const [menu, label] of labels) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dsh-desktop-titlebar-menu'
    button.textContent = label
    button.addEventListener('click', () => {
      const rect = button.getBoundingClientRect()
      bridge.showShellMenu(menu, rect.left, rect.bottom)
    })
    bar.append(button)
  }
  document.body.prepend(bar)
}
