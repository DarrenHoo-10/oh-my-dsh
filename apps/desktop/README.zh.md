# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

DeepSeek Harness 的 Windows 桌面外壳。Electron 负责窗口和受信任的 preload bridge；独立 Host 进程负责启动 `desktop` profile、提供 Host 生成的客户端模块图，并在不监听 TCP 端口的情况下处理 API 请求。

## 开发

日常修改和验证默认在仓库根目录使用源码启动：

```sh
pnpm --filter @deepseek-ai/dsh-desktop run dev
```

`dev` 会重新构建桌面库并启动 Electron。开发态 Host 使用仓库的 TypeScript 解析器，打包版本只运行已生成的 `lib` 文件；两条路径都不会打开 TCP 监听。只有改动影响 Renderer 或共享 Client 资源时，才需要在重启前重新构建渲染器：

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build:renderer
```

开发期间应针对改动行为运行聚焦测试。不得把 `package:win` 作为默认验证步骤；只有明确要求安装器、进入阶段验收或正式发布时才组装安装器。渲染器复用 `@deepseek-ai/dsh-client-web` 外壳和现有客户端 bundle，与 `dsh web` 使用同一套 UI；桌面构建使用相对路径的 Vite 资源，并通过类型化 preload bridge 获取启动模块图、插件 bundle、单次 API 请求和事件流。

## Windows 打包

```sh
pnpm --filter @deepseek-ai/dsh-desktop run package:win
```

打包入口目标是按用户安装的 x64 NSIS 安装包，并会把 `deepseek harness.exe` 写入仓库主目录。安装器会在解压新载荷前运行已注册的旧版卸载程序，并清理所选安装目录中可识别的应用运行时残留；Harness home、设置、凭据、workspace 和 Session 不会被删除。安装包包含 workspace 依赖闭包，以及随附 standard agent preset 创建会话时所需的解析入口。Preset YAML 会作为未封入 ASAR 的资源安装，因为发现过程需要枚举其目录。安装器使用 `apps/web/public/favicon.svg` 中的 DeepSeek 标志作为 Windows 图标；开发模式使用本机 Node/Electron 工具链。

## 运行时职责

- Main 负责 BrowserWindow、原生标题栏菜单、IPC 请求关联、Host 监管、以工作区为根目录的 shell 进程、原生保存对话框和有界关闭。
- Preload 通过 `contextBridge` 暴露启动信息、bundle、fetch、流、原生目录选择、原生文件保存、终端字节流和固定应用菜单操作。
- Renderer 使用 `nodeIntegration: false`，从 `file://` 加载资源。
- Host 负责 Cordis、ApiProxy、文件系统能力和 desktop profile。

Desktop profile 会关闭浏览器启动、WebServer、Web runtime 和 Client HMR。桌面端通过受信任的 preload bridge 使用 Electron Main 的原生目录对话框；浏览器 carrier 继续使用 Host 提供的原生选择器。

Electron 进入 ready 状态前，Main 会把 Chromium session data 和磁盘缓存放到 LocalAppData。安装版与开发版使用不同目录，且打包应用只允许一个实例，避免两个安装版进程争用同一组 Chromium 文件。关闭应用时，Main 会先销毁 Renderer，再停止终端和 Host 进程，防止较晚到达的 IPC 请求把预期的 Host 终止误报成操作失败。

## 模型体验

无；此包只改变应用承载方式，不增加模型可见的提示词或工具行为。

#### KV Cache 影响

无；不会改变模型请求前缀。

## 已知限制与后续工作

- **单实例激活尚未实现**——当前切片优先打通本地 renderer/Host 路径；外部导航已限制为应用文件，HTTP(S) 链接交由系统打开。
- **底部终端使用持续运行的标准输入 shell，而不是伪终端**——普通 PowerShell 命令会在当前会话目录下执行，shell 会在每条命令后回传实际当前目录，因此 `cd` 会更新显示的提示符；暂不支持全屏终端程序和完整的终端模拟转义行为。
