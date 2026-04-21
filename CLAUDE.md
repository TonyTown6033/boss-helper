# Boss Helper — 项目指南

## 项目概述

Boss直聘 (zhipin.com) 的 Chrome/Firefox/Edge 浏览器插件，用于自动化简历投递流程。核心功能包括：批量自动投递、关键词过滤、薪资筛选、AI 智能招呼语、高德地图通勤距离过滤。

## 技术栈

| 层级     | 技术         | 版本                  |
| -------- | ------------ | --------------------- |
| 语言     | TypeScript   | 5.x                   |
| 框架     | Vue 3        | 3.5.x                 |
| UI 库    | Element Plus | 2.x（命名空间 `ehp`） |
| 状态管理 | Pinia        | 3.x                   |
| 扩展框架 | WXT          | 0.20.x                |
| 构建工具 | Vite + Bun   | -                     |
| AI 集成  | OpenAI SDK   | 4.x                   |
| 地图     | 高德地图 API | -                     |

## 构建与运行

```bash
# 开发模式 (Chrome)
bun run dev

# 开发模式 (Firefox / Edge)
bun run dev:firefox
bun run dev:edge

# 构建全平台
bun run build

# 打包 zip（提交商店用）
bun run zip

# 类型检查
bun run check

# 格式化代码
bun run fmt

# Lint
bun run lint
bun run lint:fix
```

## 功能开发文档流程

新增功能、功能扩展或较大的行为变更，需要先完成文档登记，再进入产品代码修改：

1. 在 `TODO.md` 新增任务条目。
2. 在 `docs/<domain>/` 下创建或更新功能设计文档；没有合适领域时，新建短且稳定的领域目录。
3. 在 TODO 任务行链接对应设计文档。
4. 小范围功能至少包含 `<feature>-design.md`；涉及 API 或 payload 变化时补充 `<feature>-api-contract.md`；涉及数据迁移、破坏性清理或 schema 变化时补充 `<feature>-migration.md`；大范围或高风险流程补充 `<feature>-test-plan.md`。
5. 首个设计文档至少包含：目标、当前缺口、锁定决策、非目标、数据或状态变化、API 或页面影响、验收标准。
6. 产品代码变更前运行 TODO 链接检查，确认任务和文档已建立可追踪关系。

## 关键入口点

- **扩展入口**: `src/entrypoints/`
  - `main-world.ts` — 主脚本，注入页面 main world，根据路由加载对应模块
  - `content.ts` — Content Script，匹配 `*.zhipin.com/*`，注入 main-world.js
  - `background.ts` — Background Service Worker
- **页面模块**: `src/pages/zhipin/` — 职位列表页的 UI 和投递逻辑
- **配置面板**: `src/App.vue` + `src/components/` — 悬浮配置面板

## 目录结构

```
src/
  entrypoints/      # WXT 入口点（background、content、main-world）
  pages/zhipin/     # 职位列表页逻辑（挂载 UI、投递流程）
  components/       # 共享 Vue 组件（chat、conf、form、icon、llms）
  composables/      # 可复用逻辑
    useApplying/    # 核心投递 Pipeline（过滤链）
    useModel/       # LLM 模型封装（OpenAI 兼容 API）
    useWebSocket/   # WebSocket / MQTT / Protobuf 处理
  stores/           # Pinia 状态
    conf/           # 用户配置（FormData，含版本迁移）
    jobs.ts         # 职位列表状态
    log.tsx         # 投递日志
    signedKey.ts    # VIP 签名密钥
    user.ts         # 用户信息
  message/          # 跨上下文消息通信（comctx）
    background.ts   # Background 提供者
    contentScript.ts # Content Script 提供者
    index.ts        # Main World 注入适配器
  types/            # TypeScript 类型定义
  utils/            # 工具函数（logger、amap、parse 等）
public/
  _locales/         # i18n（zh_CN / en）
  icons/            # 插件图标
```

## 跨上下文通信架构

扩展有三个独立 JS 上下文，通过 `comctx` 库连接：

```
main-world (页面 JS)
  ↕ window.postMessage
content-script
  ↕ browser.runtime.sendMessage
background (service worker)  ← 持有 storage / cookie 权限
```

- `src/message/index.ts` — main-world 侧注入适配器，`counter` 对象代理所有操作
- `src/message/contentScript.ts` — content 侧，`ContentCounter` 包装 background 的能力
- `src/message/background.ts` — background 侧，实际执行 storage/cookie/notify 操作

## 投递 Pipeline

核心流程在 `src/composables/useApplying/index.ts`，使用嵌套数组定义过滤链（Guard 模式）：

```
communicated → sameCompany → sameHr → jobTitle → company
→ salaryRange → companySizeRange → goldHunter
→ [获取 Card 信息]
  → activityFilter → hrPosition → jobAddress → friendStatus
  → jobContent
  → [高德地图测距]
    → amap
  → aiFiltering → greeting (发送打招呼)
```

每个 handler 可以是 `fn`（前置）和 `after`（后置），嵌套数组第一项是 guard（只有后续 handler 存在时才执行）。

## 配置系统

`FormData`（`src/types/formData.ts`）是核心配置结构，存储在浏览器 `local:` storage。`useConf` store（`src/stores/conf/index.ts`）负责：

- 版本迁移（`FROM_VERSION` 数组，从旧版数据格式升级）
- 多账号切换（按 userId 分隔配置）
- 导入/导出 JSON

## 代码风格

- 文件命名：Vue 组件 PascalCase，composables/utils camelCase
- 使用 `oxfmt` 格式化，`oxlint` lint
- commit 风格：`feat: 描述` / `fix: 描述` / `style: 描述`（中文描述）
- 无测试框架（浏览器扩展特性决定，难以单元测试）

## 注意事项

- Element Plus 命名空间为 `ehp`（非默认 `el`），CSS 变量都以 `--ehp-` 开头
- `wxt.config.ts` 中 `imports: false`，所有导入必须显式写明，不能依赖自动导入
- 构建目标为 `chrome-mv3`、`firefox-mv2`、`edge-mv3`
- `openapi.d.ts` 由 `bun run openapi` 从本地 `http://localhost:8002/openapi.json` 生成
