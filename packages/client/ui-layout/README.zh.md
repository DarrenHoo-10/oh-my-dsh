# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

外壳插件：AppFrame 包含左侧边栏、中央会话区、可选的右侧 `sidechat` 栏和可选的底部 `details` 行，并提供 `ctx.layout` 面板几何服务。它注册到运行时拥有的 `root` slot，并声明 `sidebar`、`conversation`、`sidechat`、`details` 和 `shell.overlay`。侧边栏和侧边聊天的缩放边界是可拖动的命中条带；侧边聊天仅保留可用的最小宽度，不设任意的最大宽度，实际渲染宽度只受可用视口与中央栏让步规则限制。关闭的侧边栏保留 56px 控制栏；侧边聊天和详情面板关闭到零尺寸。该包还提供主题呈现器：它消费解析后的 `ctx.theme` 快照，并将其投影到 document（用 `html { color-scheme }` 驱动原生 UA 控件，依据当前配色方案设置 `body[data-ds-dark-theme]`，并将主题的别名 token 设为 body 上的内联变量，同时拥有一个 `<meta name="theme-color">`，其内容随计算后的 body 背景色更新）。在应用调色板和 token 后进行测量，可确保渲染后的背景成为唯一的颜色依据；呈现器在 dispose（资源释放）时会移除其自有的元数据节点，并一并清除其写入的其他全局状态。

`ctx.layout.openSideChat()` 在不切换当前会话视图的情况下打开上下文聊天。`openDetails()` 在底部打开工具详情，`toggleBottomPanel()` 直接切换该区域。两个区域关闭时都以零尺寸保持挂载，因此切换显示不会丢失本地查看状态。

AppFrame 始终挂载会话、侧边聊天和详情区域；已连接 Session 通过 `SessionProvider` 渲染。布局 store 是瞬时状态，侧边栏以默认宽度启动，侧边聊天和详情面板保持关闭，且该 store 从不读写 `localStorage`。选择不同会话时，两个上下文区域都会在绘制前关闭。会话 owner share 为空，侧边栏 owner share 只包含 `collapsed` 和 `width`；注册方通过标准钩子获取业务数据，并从各自的 inject 接口获取操作。

`/client` 导出表层包含插件主体（`apply`／`inject`）、`LayoutController` 和四个 owner-share 接口。AppFrame、面板 store 与让步求解器仍属于包内部。

## 模型体验

无。布局外壳管理浏览器查看状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **面板几何信息是瞬时状态**：重新加载会恢复侧边栏默认值，并使详情栏保持关闭；在不同会话 id 之间切换同样会关闭详情栏，并忘记拖动后的宽度，而未选中表面会以零宽度渲染详情栏，但不会修改几何信息。
- **让步链自动关闭通过推导零宽度实现，不会改动宽度偏好**：窗口变宽时面板会自行恢复；消费方禁止把 store 中的详情宽度当作实际渲染状态。
- **挤压重排期间不提供滚动锚定**：布局变化可能移动读者的 viewport。
