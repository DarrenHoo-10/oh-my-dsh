# Agent Note：桌面客户端 bundle 改为安装锚点优先解析

Status: implemented

[English](2026-08-16-desktop-client-bundle-profile-shadowing.md) | 中文

## 问题

`ClientModuleRegistry` 之前对每个 `dsh.client` 行包都先从 profile 目录锚点（`createRequire(ctx.baseUrl)`）解析。当机器上 `$DSH_HOME/profiles/node_modules` 曾由另一套 dsh 安装（旧检出或移动过的工作树）heal 过时，这些 junction 会让打包版桌面应用把客户端插件图——工作区选择器、模型配置 UI 以及所有其他浏览器 bundle——都从外部安装的包里组合出来。打包版 Host 因 `composeProfile` 传入了 `bareModuleBaseUrl` 而跳过 `healProfilesModuleFallback`，陈旧 junction 永远不会被校正；被提供的 bundle 于是与应用自身前端不匹配，相关 UI 加载失败。`app.asar` 内的兜底锚点只在 profile 锚点落空后才生效，而这些外部 junction 恰好挡住了这条路径。

## 决策

`resolvePkgJson` 先解析 modules 包自身的锚点（`createRequire(import.meta.url)`；打包后位于同一个 `app.asar` 内），再以 profile 锚点兜底，解析安装中缺失的部分——即声明在 profile 自身 `node_modules` 里的 out-of-tree 插件。这使客户端行包与 [profile-plugin-bundles 决策](2026-08-05-profile-plugin-bundles.md) 已有的 bundle 契约保持一致：in-box 包永远来自运行中的同一套 dsh 安装，绝不来自 profile 本地副本。

## 备选方案

**profile 清单白名单。** 只为 profile 的 `package.json` 声明过的名字解析 profile 锚点。为此需要解析 profile 清单，而保护效果相同；直接交换顺序已经会让 profile 锚点为安装无法解析的一切兜底。

**打包模式下 heal fallback。** 打包版 Host 跳过 heal，因为 CommonJS 解析无法穿越指向 `app.asar` 的 junction；把 junction 重新指向那里也不会让它们可解析。

## 影响

开发与 Web 面解析行为不变：启动时会把 fallback heal 到正在运行的仓库，安装锚点也解析到同一批包。打包版桌面应用会忽略陈旧 junction，改用自己的载荷。已被遮蔽的机器只需删除陈旧 fallback——下次 dev 模式启动会自动重建，打包版应用在没有它时也能从 `app.asar` 解析。回归测试固定了顺序：profile 本地的 in-box 包假副本会被丢弃而不是被组合进图。
