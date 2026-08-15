# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

Shell plugin: AppFrame with a left sidebar, center conversation, optional right `sidechat` column, and optional bottom `details` row, plus the `ctx.layout` panel-geometry service. It registers into the runtime-owned `root` slot and declares `sidebar`, `conversation`, `sidechat`, `details`, and `shell.overlay`. The sidebar and side-chat resize boundaries are drag hit strips; side chat has a usable minimum but no arbitrary maximum, and the frame limits its rendered width only by the available viewport and center-column concession. A closed sidebar retains a 56px control rail; side chat and details close to zero size. The package also seats the theme presenter: it consumes resolved `ctx.theme` snapshots and projects them onto the document (`html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background). Measuring after palette and token application keeps the rendered background as the single color authority; disposing the presenter removes its metadata node with its other global writes.

`ctx.layout.openSideChat()` opens contextual chat without changing the current Session view. `openDetails()` opens Tool details along the bottom, and `toggleBottomPanel()` controls that row directly. Both regions remain mounted at zero size while closed so their local viewing state survives a toggle.

AppFrame always mounts the conversation, side-chat, and details regions; a connected Session renders through `SessionProvider`. The transient layout store starts the sidebar at its default width with side chat and details closed, and it never reads or writes `localStorage`. Selecting a different Session closes both contextual regions before paint. The conversation owner share is empty, while the sidebar owner share contains only `collapsed` and `width`; registrants obtain business data from standard hooks and actions from their own inject faces.

The `/client` exports are the plugin body (`apply`/`inject`), `LayoutController`, and the four owner-share interfaces. AppFrame, the panel store, and the concession solver remain package-internal.

## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Panel geometry is transient** — reload restores the sidebar default and details closed; switching between distinct Session ids also closes details and forgets its dragged width, while unselected surfaces render details at zero width without modifying geometry.
- **Concession-chain auto-close derives a zero width without touching the preferred width** — the panel restores itself when the window widens; consumers must not read the stored details width as the rendered truth.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.
