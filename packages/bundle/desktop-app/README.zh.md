# `@deepseek-ai/dsh-desktop-app`

[English](README.md) | 中文

dsh 桌面 profile 覆盖层。它叠加在 [`dsh-base`](../base/README.md) 与 [`dsh-web-app`](../web-app/README.md) 之上，保留同一套 Client bundle 图和 UI，禁用仅适用于浏览器的 Web 启动器、运行时与服务器，并把 API 与事件协议交给 Electron preload 桥。独立的 Node Host 持有 Cordis 树；renderer 通过 `file://` 加载已构建的 shell，再向 Host 请求图中选定的 bundle 和 fetch 形状的 API 响应。

该覆盖层有意不包含业务 Service。[`apps/desktop`](../../../apps/desktop) 负责 Electron 生命周期和类型化 IPC 进程循环；本包只负责选择让共享 Web 组合脱离浏览器服务器载体运行的 profile。

## 模型体验

### 桌面承载覆盖层

#### 模型看到的内容

无；该覆盖层只改变 `file://` 应用承载方式，不增加模型可见的提示词或工具行为。

#### Token 影响

无；该覆盖层不向模型请求增加 token。

#### KV Cache 影响

无；该覆盖层不增加请求前缀内容。

## 已知限制与暂缓工作

- **Windows 打包由应用负责**——完成桌面 Host 与 renderer 构建后即可在工作区使用；安装包组装与内置 Node 运行时仍由 `apps/desktop` 负责。
