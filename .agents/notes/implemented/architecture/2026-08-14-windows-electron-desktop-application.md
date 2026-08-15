# Agent Note: Windows Electron desktop application

Status: implemented

English | [中文](2026-08-14-windows-electron-desktop-application.zh.md)

## Problem

The Harness GUI was available through `dsh web`, but it did not have an installed Windows application path. Reusing the browser WebServer would keep a TCP listener and browser-only transport in the desktop product, while running the Host in Electron Main would couple the application window to Host failures.

## Decision

The first desktop slice uses an Electron Main process, a trusted preload bridge, a `file://` Renderer, and a separate Host process. `@deepseek-ai/dsh-app-boot` owns reusable profile startup and bounded shutdown; `@deepseek-ai/dsh-desktop-app` composes the `desktop` profile by disabling browser startup, WebServer, Web runtime, and Client HMR; `apps/desktop` owns Electron lifecycle and the process protocol.

Source launch is the ordinary desktop development path. The development Host runs under Electron's Node mode with the repository `tsx` resolver and root TypeScript path map; the packaged Host runs emitted `lib` files without `tsx`. Both expose Node internals to Cordis Loader. The packaged Host passes the application manifest inside `app.asar` as the installation module base: shipped bare plugins resolve there first, while a package absent from the shipped graph falls back to the profile directory. The profile runner also injects this base into `agent-presets`, so a new or resumed session's nested preset tree resolves from the same archive instead of the external profile directory. Because packaged resolution does not depend on profile junctions, the desktop runner skips module-fallback healing. Developers run focused checks for changed behavior and rebuild Renderer assets only when the change reaches that asset graph. NSIS assembly is a stage-acceptance and release operation, not an implicit validation step after each source change; it runs only when an installer is explicitly requested or the work reaches an acceptance or release boundary.

The installed application places runtime JavaScript, manifests, dependencies, and Renderer assets in one `app.asar`, while preset YAML remains an enumerable resource. Source maps, TypeScript sources, TypeScript build metadata, and Markdown are excluded. The NSIS payload uses normal compression: ASAR already removes the dominant small-file installation cost, so retaining a compressed installer reduces transfer and scan volume without recreating thousands of filesystem entries. Differential packaging is disabled because this application has no automatic-update consumer. NSIS runs a registered previous uninstaller, then removes only recognized application runtime payloads left in the selected installation directory before extracting the replacement; Harness home and user data remain outside that cleanup.

The Renderer obtains the Host-authored Client graph and selected bundle bytes through typed IPC. Unary API requests use the existing Fetch-shaped API Proxy adapter, and Host event streams use generation-scoped IPC channels with cancellation. The Web carrier and fixture carrier remain the default when the desktop preload bridge is absent.

Workspace selection in the desktop Renderer calls Electron Main's native directory dialog through the trusted preload bridge. Browser carriers retain the Host-backed native picker. This avoids an extra Host worker hop in the packaged Electron process tree. The Host opens no TCP listener, and the existing Harness home remains the shared source for profiles, settings, credentials, and sessions.

Before Electron becomes ready, Main assigns Chromium session data and disk cache to channel-specific directories under Windows LocalAppData. Development and packaged launches therefore do not share Chromium cache files. Packaged launches also acquire Electron's single-instance lock; a later launch focuses the existing window and exits without starting another Renderer or Host. Shutdown destroys the Renderer before stopping terminals and the Host, so no new trusted IPC request can race the expected Host SIGTERM.

## Alternatives considered

**Wrap `dsh web` in an Electron window.** Rejected for the desktop carrier because it would retain a TCP listener, WebServer lifecycle, and browser transport even though the local application has a direct Host process path.

**Run the Host in Electron Main.** Rejected because it would couple Host failures to the window process and make the existing Node-oriented runtime depend on Electron's module ABI.

**Keep the dependency tree unpacked for profile junctions.** Rejected because the resulting installer created more than eleven thousand runtime files. The packaged Host instead resolves shipped plugins from its ASAR installation base and falls back to the profile only for packages absent from the shipped graph.

**Keep Electron's default Chromium data directory.** Rejected because Electron derives it from the scoped package name under Roaming AppData, and concurrent installed or development launches can contend for the same disk-cache files. Harness sessions and settings do not depend on that location, so Chromium's derived data belongs in isolated LocalAppData directories.

## Scope

The repository contains the desktop shell, custom Windows title bar, profile overlay, shared boot runner, desktop protocol validation, client transport selection, Host composition test, protocol tests, build scripts, and Windows NSIS packaging entry. The packaged Host runs through the Electron executable's Node mode directly from `app.asar`. The desktop application manifest names resolver-only preset dependencies directly, while Electron Builder installs preset YAML as a separate resource because preset discovery enumerates the roster directory.

Packaged startup is single-instance, while development startup remains independent of the installed application's lock and cache. Main rejects IPC from another renderer, blocks navigation away from the packaged file, delegates validated HTTP(S) links to the operating system, owns the fixed native menus opened from the custom title bar, and returns only the selected directory path or cancellation from its fixed picker channel.

## Consequences

`dsh web` keeps its HTTP, WebSocket, static-file, and browser trust behavior. The desktop path shares the existing data model without a migration and replaces the network carrier with a local process bridge. The application must continue to treat the Host as a separately supervised process and must not expose a generic renderer IPC channel.

Ordinary desktop iterations avoid Electron Builder's workspace collection and NSIS assembly cost. Installer-only failures remain visible at explicit acceptance builds and releases rather than slowing every source-level verification cycle. The installer remains one executable, while the installed application uses multiple resource files. A Host startup rejection remains available to the first IPC request and the Renderer replaces its mount point with a failure report instead of leaving a blank window.

ASAR reduces the installed resource graph from thousands of dependency files to one archive, so Windows filesystem and security scanning no longer dominate installation. Normal NSIS compression keeps the distributable substantially smaller than the unpacked application. Packaged startup resolves shipped plugins from the archive and does not create or validate profile fallback links. LocalAppData isolation prevents development runs from inheriting installed Chromium cache locks; single-instance packaged startup prevents installed processes from recreating that contention. The shutdown order closes the visible Renderer before the Host receives SIGTERM.

## Verification

The desktop profile composition test creates a Workspace and a standard Session through the same shared Fetch handler used by Electron IPC. The Chromium storage test pins channel isolation, directory creation, and both Electron assignments. The preset mount tests pin the installed-runtime base for bare package rows, and packaged acceptance resumes an existing standard session before release handoff. The Electron directory bridge, Host-backed Windows picker fallback, desktop protocol, desktop transport, client module, connection, app-boot, and CLI focused tests pass. Packaged Electron launches the relative-asset Renderer from ASAR, loads the Host-authored client graph, maintains both event streams without console errors, and produces the NSIS installer. The ASAR acceptance directory contains 199 physical files instead of the previous 11,318; application JavaScript and dependencies occupy one 75.22 MiB archive, and Electron carries only the English and Simplified Chinese locale packs.
