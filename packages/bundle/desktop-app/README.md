# `@deepseek-ai/dsh-desktop-app`

English | [中文](README.zh.md)

The dsh desktop profile overlay. It composes over [`dsh-base`](../base/README.md) and [`dsh-web-app`](../web-app/README.md), retains the same Client bundle graph and UI, disables the browser-only Web startup/runtime/server, and leaves the API and event protocol to the Electron preload bridge. The separate Node Host owns the Cordis tree; the renderer loads the built shell over `file://` and asks the Host for graph-selected bundles and fetch-shaped API responses.

The overlay deliberately contains no business service. [`apps/desktop`](../../../apps/desktop) owns the Electron lifecycle and typed IPC process loop; this package owns only the profile selection that makes the shared Web composition carrier-neutral.

## Model Experience

### Desktop carrier overlay

#### What the model sees

None; the overlay changes the `file://` application carrier and does not add model-facing prompt or tool rows.

#### Token effect

None; the overlay adds no tokens to a model request.

#### KV Cache effect

None; the overlay adds no request-prefix content.

## Known Limitations and Deferred Work

- **Windows packaging is application-owned** — the overlay is usable from a workspace after the desktop Host and renderer artifacts are built; installer assembly and bundled Node runtime ownership remain in `apps/desktop`.
