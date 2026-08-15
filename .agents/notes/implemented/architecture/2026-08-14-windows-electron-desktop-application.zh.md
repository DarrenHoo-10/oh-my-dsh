# Agent Note: Windows Electron 桌面应用

Status: implemented

[English](2026-08-14-windows-electron-desktop-application.md) | 中文

## 问题

Harness GUI 原先只能通过 `dsh web` 提供，缺少可安装的 Windows 应用路径。复用浏览器 WebServer 会把 TCP 监听器和浏览器专用传输一起带入桌面产品，而把 Host 放进 Electron Main 又会让应用窗口生命周期与 Host 故障耦合。

## 决策

第一版桌面链路采用 Electron Main、受信任的 preload bridge、`file://` Renderer 和独立 Host 进程。`@deepseek-ai/dsh-app-boot` 负责可复用的 profile 启动与有界关闭；`@deepseek-ai/dsh-desktop-app` 通过 `desktop` profile 关闭浏览器启动、WebServer、Web runtime 和 Client HMR；`apps/desktop` 负责 Electron 生命周期与进程协议。

源码启动是桌面端的日常开发路径。开发态 Host 在 Electron Node 模式下使用仓库的 `tsx` 解析器和根 TypeScript 路径映射；打包后的 Host 不使用 `tsx`，只运行已生成的 `lib` 文件。两条路径都会向 Cordis Loader 开放 Node 内部模块。打包后的 Host 把 `app.asar` 内的应用 manifest 作为安装模块基准：随应用交付的裸插件优先从这里解析，发布图中不存在的包才回退到 profile 目录。profile runner 还会把该基准注入 `agent-presets`，使新会话或恢复会话的嵌套 preset 树从同一归档解析，而非外部 profile 目录。由于打包解析不依赖 profile junction，桌面 runner 会跳过模块回退修复。开发者针对改动行为运行聚焦检查，只有改动进入 Renderer 资源图时才重新构建 Renderer 资源。NSIS 组装属于阶段验收和发布操作，不是每次源码改动后的隐式验证步骤；只有明确要求安装器，或者工作进入验收或发布边界时才执行。

安装后的应用把运行时 JavaScript、manifest、依赖和 Renderer 资源放入单个 `app.asar`，preset YAML 则保留为可枚举资源。打包时排除 source map、TypeScript 源码、TypeScript 构建元数据和 Markdown。NSIS 载荷使用 normal 压缩：ASAR 已消除安装时大量小文件这一主要成本，因此保留压缩安装器可以减少传输和扫描体积，同时不会重新产生数千个文件系统条目。当前应用没有自动更新消费方，因此关闭差分打包。NSIS 会先运行已注册的旧版卸载程序，再删除所选安装目录中可识别的应用运行时残留，然后解压替换载荷；Harness home 和用户数据不在清理范围内。

Renderer 通过类型化 IPC 获取 Host 生成的 Client 模块图和按图选择的 bundle。单次 API 请求复用现有 Fetch 形式的 API Proxy 适配器，Host 事件流使用带 generation 的 IPC 通道并支持取消。没有桌面 preload bridge 时，Web carrier 和 fixture carrier 仍保持原有选择逻辑。

桌面 Renderer 通过受信任的 preload bridge 调用 Electron Main 的原生目录对话框。浏览器 carrier 继续使用 Host 提供的原生选择器。这样可避免打包后的 Electron 进程树再经过一层 Host worker。Host 不打开 TCP 监听，现有 Harness home 继续作为 profiles、设置、凭据和会话的共享来源。

Electron 进入 ready 状态前，Main 会把 Chromium session data 和磁盘缓存指定到 Windows LocalAppData 下按运行渠道区分的目录，因此开发版与打包版不会共享 Chromium 缓存文件。打包版还会获取 Electron 单实例锁；后续启动只会聚焦现有窗口并退出，不会再启动 Renderer 或 Host。关闭应用时会先销毁 Renderer，再停止终端和 Host，确保新的受信任 IPC 请求不会与预期的 Host SIGTERM 形成竞态。

## 考虑过的替代方案

**把 `dsh web` 包进 Electron 窗口。** 放弃这一方案，因为桌面 carrier 不需要 TCP 监听器、WebServer 生命周期或浏览器传输。

**把 Host 放进 Electron Main。** 放弃这一方案，因为它会让 Host 故障影响窗口进程，并使面向普通 Node 的运行时依赖 Electron 模块 ABI。

**为 profile junction 保留未压入 ASAR 的依赖树。** 放弃这一方案，因为生成的安装器需要创建超过一万一千个运行时文件。打包后的 Host 改为从 ASAR 安装基准解析随应用交付的插件，仅对发布图中不存在的包回退到 profile。

**保留 Electron 默认的 Chromium 数据目录。** 放弃这一方案，因为 Electron 会根据带 scope 的包名把它放到 Roaming AppData，而并发的安装版或开发版会争用同一组磁盘缓存文件。Harness 会话与设置不依赖该位置，因此 Chromium 派生数据应放入相互隔离的 LocalAppData 目录。

## 范围

仓库包含桌面外壳、自定义 Windows 标题栏、profile overlay、共享启动器、桌面协议校验、客户端传输选择、Host 组合测试、协议测试、构建脚本和 Windows NSIS 打包入口。打包后的 Host 使用 Electron 可执行文件的 Node 模式，直接从 `app.asar` 运行。桌面应用清单会直接声明仅用于解析的 preset 依赖，同时 Electron Builder 会把 preset YAML 安装为单独资源，因为 preset 发现过程需要枚举名单目录。

打包版启动为单实例，开发版启动则不受已安装应用的锁与缓存影响。Main 会拒绝其他 renderer 的 IPC，阻止导航离开应用文件，把校验过的 HTTP(S) 链接交给系统打开，负责从自定义标题栏打开固定的原生菜单，并在固定的目录选择通道中只返回所选路径或取消结果。

## 结果

`dsh web` 保持原有 HTTP、WebSocket、静态文件和浏览器信任行为。桌面路径共享现有数据模型，不需要数据迁移，并以本地进程桥接替代网络 carrier。应用必须继续把 Host 作为独立受监督进程处理，不能暴露通用 Renderer IPC 通道。

普通桌面迭代不会承担 Electron Builder 收集工作区文件和组装 NSIS 的成本。安装器专属故障仍会在明确的验收构建和发布阶段暴露，而不会拖慢每轮源码验证。安装器仍是单个可执行文件，安装后的应用则使用多个资源文件。Host 启动失败会保留到第一次 IPC 请求，Renderer 会用失败报告替换挂载点，而不是留下空白窗口。

ASAR 把安装资源图从数千个依赖文件缩减为单个归档，使 Windows 文件系统和安全扫描不再主导安装耗时。Normal NSIS 压缩使分发文件显著小于未压缩应用。打包启动会从归档解析随应用交付的插件，不再创建或校验 profile 回退链接。LocalAppData 隔离可防止开发版继承安装版的 Chromium 缓存锁，打包版单实例启动可防止安装版进程再次产生同类争用。关闭顺序会在 Host 收到 SIGTERM 前先关闭可见 Renderer。

## 验证

桌面 profile 组合测试会通过 Electron IPC 使用的同一 shared Fetch handler 创建 Workspace 和 standard Session。Chromium 存储测试会钉住运行渠道隔离、目录创建和两项 Electron 设置。preset 挂载测试会钉住裸包配置项的已安装运行时基准，打包验收则会在发布交接前恢复一个现有 standard 会话。Electron 目录桥接、Host 提供的 Windows 原生选择器回退、桌面协议、桌面传输、Client 模块、Connection、app-boot 和 CLI 聚焦测试均通过。打包后的 Electron 能从 ASAR 启动相对资源 Renderer、加载 Host 生成的 Client 模块图、保持两条事件流且不产生控制台错误，并生成 NSIS 安装包。ASAR 验收目录包含 199 个物理文件，而之前为 11,318 个；应用 JavaScript 与依赖集中在一个 75.22 MiB 归档中，Electron 只携带英文和简体中文语言包。
