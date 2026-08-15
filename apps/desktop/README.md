# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Windows desktop shell for DeepSeek Harness. Electron owns the window and the trusted preload bridge; a separate Host process boots the `desktop` profile, serves the Host-authored Client graph, and handles API requests without opening a TCP listener.

## Development

Use the source launcher as the default edit-and-verify loop from the repository root:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run dev
```

`dev` rebuilds the desktop libraries and starts Electron. Its Host uses the repository TypeScript resolver, while packaged builds run only emitted `lib` files; neither path opens a TCP listener. Rebuild the renderer before restarting only when a change affects Renderer or shared Client assets:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build:renderer
```

Run focused tests for the changed behavior during development. Do not run `package:win` as the default validation step: installer assembly is reserved for an explicit installer request, a stage acceptance build, or a release. The renderer uses the same `@deepseek-ai/dsh-client-web` shell and Client bundles as `dsh web`; the desktop build selects relative Vite assets and obtains the boot manifest, plugin bundles, unary API calls, and event streams through the typed preload bridge.

## Windows packaging

```sh
pnpm --filter @deepseek-ai/dsh-desktop run package:win
```

The packaging entry targets a per-user x64 NSIS installer and writes `deepseek harness.exe` to the repository root. Before extracting a new payload, the installer runs the registered previous uninstaller and removes recognized application runtime files left in the selected install directory; it does not remove Harness home, settings, credentials, workspaces, or Sessions. The packaged app includes its workspace dependency closure, including resolver entries required when the shipped standard agent preset creates a session. Preset YAML is installed as an unpacked resource because discovery enumerates its directory. The installer uses the DeepSeek mark from `apps/web/public/favicon.svg` as its Windows icon; development mode uses the local Node/Electron toolchain.

## Runtime ownership

- Main owns the BrowserWindow, native title-bar menus, IPC request correlation, Host supervision, workspace-rooted shell processes, native save dialogs, and bounded shutdown.
- Preload exposes boot, bundle, fetch, stream, native directory selection, native file saving, terminal byte streams, and fixed application-menu operations through `contextBridge`.
- Renderer runs with `nodeIntegration: false` and uses `file://` assets.
- Host owns Cordis, ApiProxy, filesystem capabilities, and the desktop profile.

The desktop profile disables browser startup, WebServer, Web runtime, and Client HMR. Workspace selection uses Electron Main's native directory dialog through the trusted preload bridge; browser carriers retain the Host-backed native picker.

Before Electron becomes ready, Main places Chromium session data and disk cache under LocalAppData. Installed and development launches use separate directories, and the packaged application admits one instance so two installed processes cannot contend for the same Chromium files. During shutdown, Main destroys the Renderer before stopping terminal and Host processes, preventing late IPC requests from observing the expected Host termination as an operation failure.

## Model Experience

None; this package changes the application carrier and does not add model-visible prompt text or tool behavior.

#### KV Cache effect

None; no model request prefix is changed.

## Known Limitations and Deferred Work

- **Single-instance activation is not yet implemented** — the first slice focuses on the local renderer/Host path; external navigation is already constrained to the application file and OS-opened HTTP(S) links.
- **The bottom terminal uses a persistent standard-input shell, not a pseudo-terminal** — ordinary PowerShell commands run in the current Session directory, and the shell reports its current directory after each command so `cd` updates the displayed prompt. Full-screen terminal applications and terminal-emulator escape behavior are not supported yet.
