# dsh-workbuddy-files

WorkBuddy 风格的 DeepSeek Harness (DSH) Web 插件：**拖拽 / 粘贴文件与文件夹 → 全屏接收遮罩 → 输入框原生引用气泡（File Pill）→ 发送后对话区文件卡片**，Agent 通过 `read_document` 工具或任意读取工具直接消费引用。

> 本插件同时存在两个形态：
> - **本目录**：可发布/可安装的正式插件包（TypeScript，Cordis，Host + Client 双半侧）；
> - **动态演示版**：会话内动态 Cordis 插件（pluginId `wbdrop-1`），当前版本 pkg-5，与正式包行为一致，拖拽/粘贴/`@`/卡片立即可体验。

---

## 功能对照（与 WorkBuddy 对齐）

| 需求 | 实现 |
| --- | --- |
| 拖拽任意文件到输入框（PDF/Word/Excel/图片/代码…） | ✅ 统一接管：**所有**文件拖入都显示本插件全屏「松开以接收文件」遮罩并走气泡管线 |
| 截图/文件粘贴（Ctrl+V） | ✅ 统一接管：图片与文件粘贴都走气泡管线（拖入即缓存 + 引用绝对路径） |
| `@` 弹出菜单搜索并引用文件/文件夹 | ✅ 工作区文件由 DSH 官方 `@` 源提供；本插件追加「文件缓存」分组 |
| 光标位置原生引用气泡 | ✅ 输入机 `insertReference` 铸造原生 occurrence 气泡（文件名 + 类型图标） |
| 气泡整体 Backspace/Delete 一次删除 | ✅ 原生 occurrence 语义（整段删除、撤销/重做一体） |
| 发送后对话区文件卡片 | ✅ `conversation.chat.turnTail` 链式槽按轮次渲染「📎 消息引用的文件」卡片，点击经 `openFile` 打开 |
| 引用附带绝对路径 | ✅ **拖入瞬间**按预分配路径（`~/.dsh-drops/<批次>/<相对路径>`）在光标处插入气泡，文件**后台异步缓存**，引用即 `@"C:\...\file.pdf"` |
| 文件夹拖拽保留目录树 | ✅ `webkitGetAsEntry` 递归遍历；顶层文件夹一个 `📁` 气泡，内部树结构原样落盘 |
| Agent 可读性 | ✅ Host 注册 `read_document` 工具：文本返回内容、目录返回树、图片/二进制/大文件返回元数据与建议 |

> 设计取舍：v1 曾实现 Chromium「FS Access API 零上传直引」（拖入时零字节、发送时才落地）。实测中发送时物化偶发「直引落地失败」会阻断发送，且浏览器安全模型拿不到拖入文件的绝对路径。为保证**拖入必可用、发送必成功**，现统一为「拖入即缓存 + 真实绝对路径」——localhost 场景下缓存即本地拷贝，无网络开销；零上传直引作为后续可选增强（见「后续方向」）。

## 架构

```
浏览器（Client 半侧）                          DSH Host（Node 进程）
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ window 拖拽/粘贴监听（capture）│        │ 私有 RPC / webServer 路由      │
│   任何文件拖拽 → stopPropagation│        │   save  → 二进制落盘          │
│   （原生图片遮罩不再激活）      │ ─────► │   list/stat/home               │
│   全屏遮罩「松开以接收文件」    │        │                               │
│                              │        │ ~/.dsh-drops/<批次>/<相对路径>│
│ 目录树解析（webkitGetAsEntry） │        │ （目录树结构保留，绝对路径）     │
│   → 立即上传（拖入即缓存）      │        │                               │
│                              │        │ read_document 工具             │
│ 气泡注入管线                    │        │   解析引用 → 内容/树/元数据     │
│   conversation.input.shell(id)│        └──────────────────────────────┘
│   shell.state.getSnapshot()   │
│   shell.insertReference(      │
│     {source:'workbuddy',      │
│      ref, label, appearance}, │
│     {start,end,draftRev})  ←  │ 草稿修订号 CAS + 重试（8 次）
│                              │
│ @ 触发源「workbuddy」          │
│   candidates: drops.list →    │
│   onPick → insert             │
│   codec.serialize: 恒等        │
│   （拖入时已落地，发送必成功）  │
│                              │
│ conversationEvents 定义        │
│   workbuddy-file-refs         │
│   （按轮次聚合用户消息引用）     │
│                              │
│ Slot 注册                      │
│   shell.overlay（遮罩+toast）  │
│   conversation.input.left     │
│     （📎 选择文件/文件夹）      │
│   conversation.chat.turnTail  │
│     （文件卡片，select 精确匹配）│
└──────────────────────────────┘
```

### 为什么气泡是「原生」的

DSH 的输入状态机（`dsh-client-ui-input-trigger` + `InputMachine`）内置**引用气泡（occurrence）**机制：官方 `@` 文件引用、`/` 命令都以气泡呈现，气泡在草稿中占用原子区间 —— Backspace 一次删除、撤销/重做、提交时序列化都走同一套机器。插件通过 `conversation.input.shell(sessionId).insertReference(reference, span)` 铸造气泡（id 寻址服务面，不经过 scoped context），`span` 携带 `draftRev` 做 CAS：插入期间用户继续输入导致修订号变化时自动重读状态重试；非 plain 阶段（提交中）被拒则 toast 提示。

### 与原生图片轨道的互斥共存

DSH 原生的图片拖放轨道在 document 上监听 dragenter 并无条件显示全屏遮罩。本插件在 **window capture 阶段（传播第一站）** 从 dragenter 起 `stopPropagation()`，原生轨道感知不到被接管的拖拽，其遮罩不会激活，也不会因收不到收尾事件而卡住页面；本插件的遮罩自身在 dragleave/dragend/drop 时必然归零，页面随时可恢复。

### 可靠性设计

- **拖入即插气泡**：最终缓存路径在拖入时即可确定（`<dropsRoot>/<批次>/<文件名或目录树>`），气泡**立即**插入光标处，不等上传；文件落盘在后台异步进行（本地写盘，用户无感），完成/失败以 toast 告知；
- 发送时 `codec.serialize` 恒等，**发送消息不可能因文件未落地而失败**；极端情况下（超大文件拖入后立即发送）Agent 读取时文件可能仍在写入，`read_document` 对不存在路径返回明确错误，稍候重试即可；
- 气泡插入失败（输入区忙/无会话）自动降级：直接写草稿文本（`setDraft`）/ 聚焦 textarea 时 `execCommand`，保证输入框有内容；
- Host 写盘加固：fs 服务写 base64 临时文本 + PowerShell 从文件解码写盘（不依赖 stdin 管道），目录自动创建、临时文件自动清理；
- 单文件上限（动态版 ~31MB / 正式包 256MB 可配）超出时跳过并提示，其余文件正常接收。

## 项目结构

```
dsh-workbuddy-files/
├── package.json            # dsh.client 声明 + dsh.bundle.patch 声明
├── cordis.patch.yml        # bundle patch：把 host 半侧挂进配置树
├── tsconfig.json
├── tsdown.config.ts        # 构建 lib/index.js（host）+ lib/client.js（client）
├── README.md
└── src/
    ├── host/
    │   └── index.ts        # /workbuddy-drops 路由 + read_document 工具
    └── client/
        ├── index.ts        # 副作用外壳：__ModuleLoader__.load
        ├── app.ts          # factory：require('react') + 组装插件
        ├── at-source.ts    # @ 触发源（文件缓存分组）
        ├── definitions.ts  # 会话事件定义 + turnTail selector
        ├── css.ts
        ├── types.ts
        ├── components/
        │   ├── overlay.tsx      # 全屏拖拽遮罩 + toast
        │   ├── pick-button.tsx  # 📎 选择文件/文件夹
        │   └── file-cards.tsx   # 对话区文件卡片
        └── lib/
            ├── bus.ts       # 拖拽/提示总线
            ├── insert.ts    # 气泡注入管线（核心）
            ├── drop.ts      # 拖拽/粘贴处理
            ├── transfer.ts  # 目录树遍历 + 上传 + 引用格式
            └── icons.ts     # 类型图标
```

## 安装

前置：Node 18+、pnpm（`dsh plugin` 内部转发给 pnpm）。

### 方式一：本地项目安装（开发/验证，推荐先走这条）

```powershell
cd F:\dsh工作空间\dsh-workbuddy-files
npm install          # 安装 tsdown（0.22+）/ typescript 等构建依赖
npm run bundle       # 产出 lib/index.js 与 lib/client.js
npm run typecheck    # 可选：类型检查（已通过）

# link 安装：符号链接（改完代码重新 bundle + 重启 dsh 即生效）
dsh plugin --profile web add link:..\dsh-workbuddy-files
# 或拷贝安装（发布前验证打包产物用）：
dsh plugin --profile web add file:..\dsh-workbuddy-files

dsh web              # 重启 web 界面
```

`dsh plugin add` 会：在 `$DSH_HOME/profiles/web` 里 `pnpm add` 该包，并因为本包声明了 `dsh.bundle.patch`，自动把 `dsh-workbuddy-files` 追加进 profile 的 `dsh.profile.bundles` 层栈（可在 `~/.dsh/profiles/web/package.json` 中核对）。卸载：`dsh plugin --profile web remove dsh-workbuddy-files`。

### 方式二：npm 发布后安装

```powershell
dsh plugin --profile web add dsh-workbuddy-files
```

### 配置（可选）

`cordis.patch.yml` 中 host 半侧的 `config`（浏览器半侧目前收不到配置，走代码默认值）：

```yaml
config:
  dropsDir: '~/.dsh-drops'   # 缓存根目录
  maxFileBytes: 268435456    # 单文件上限（默认 256MB）
```

### 依赖说明

- Host 半侧硬依赖 `webServer` 服务（`inject: ['webServer']`），写文件用 `node:fs`（真实插件非沙箱环境，与 dsh-pet 同款写法）；
- Client 半侧在运行时探测 `sessions` / `conversation` / `inputTriggers` / `conversationEvents` / `slots` 服务，缺失时优雅降级（例如无 `conversation` 时气泡退化为纯文本插入）。

### 沙箱模式说明

- **正式插件包**：Host 半侧用 `node:fs` 直写，不经过 DSH 的沙箱化 shell/fs 服务（沙箱只约束模型工具的执行，不约束插件自身的 Node 代码）——因此 `read-only` / `workspace-write` / `danger-full-access` 任何会话模式下，拖入即缓存都能正常工作；
- **动态演示版**：动态插件环境没有 Node 文件系统，二进制写盘需借用沙箱化 shell 服务；当部署的沙箱 runner 不可用（如 Windows ACL runner 配置异常）或缓存目录位于会话 workspace 之外时，写盘命令需要 `danger-full-access` 策略（演示版已显式携带，与当前会话文件策略一致）；
- **折中方案**：将 `dropsDir` 配置到 workspace 内（如 `<workspace>/.dsh-drops`），workspace-write 沙箱即可放行；或让插件先继承会话模式、被沙箱拒绝时再升级重试并提示。

## 测试步骤（逐条验收）

1. **拖拽文件**：从资源管理器把 `report.pdf` 拖入页面 → 全屏虚线遮罩「松开以接收文件」（不是原生的图片遮罩）→ 松手 → 输入框光标处出现 `📕 report.pdf` 气泡；`~/.dsh-drops/drop-*` 下文件已落地。
2. **拖拽图片**：拖入一张 PNG → 同一个遮罩 → `🖼️` 气泡（引用 `~/.dsh-drops` 下的真实路径）；Agent 可用 `read_image` 查看。
3. **光标位置**：输入「请分析 」后把光标停在句号前拖入文件 → 气泡插在光标处，而非末尾。
4. **气泡整体删除**：气泡前/后按 Backspace / Delete → 整个气泡一次删除；Ctrl+Z 完整还原。
5. **粘贴**：资源管理器复制一个 `.py` 文件 → 输入框 Ctrl+V → `💻` 代码气泡；微信/QQ 截图 Ctrl+V → `🖼️` 图片气泡（统一体验）。
6. **文件夹**：拖入一个含子目录的文件夹 → 一个 `📁` 文件夹气泡；`~/.dsh-drops/<批次>/<文件夹>/` 树结构完整。
7. **取消拖拽**：拖入后把文件拖出窗口 / 按 Esc → 遮罩消失，页面完全恢复，无残留覆盖。
8. **@ 菜单**：输入 `@` → 官方「文件与文件夹」组可搜工作区文件；「文件缓存 · ~/.dsh-drops」组列出拖入过的文件，可搜索、可选中插入。
9. **文件卡片**：发送带引用的消息，等本轮结束 → 轮次尾部出现「📎 消息引用的文件」卡片（图标+名称+大小），点击卡片打开文件。
10. **read_document**：对 Agent 说「用 read_document 读取我刚引用的文件并总结」→ Agent 调用 `read_document` 拿到文本内容（或目录树/元数据/建议）。
11. **超大文件**：拖入一个 >31MB（动态版）的文件 → toast 明确提示「超过 31MB 上限」，其余文件正常接收。
12. **卸载清理**：`dsh plugin --profile web remove dsh-workbuddy-files` 后重启，遮罩/按钮/卡片全部消失；`~/.dsh-drops` 按需手动清理。

## 已知限制与后续方向

- 动态演示版上传走 `host.call` + base64（单文件 ≤ ~31MB），正式包走 fetch 二进制流（≤ 256MB 可配）；
- turnTail 为链式槽（先匹配者胜出）：当同一轮次既有用户引用又有 Agent 产出文件时，与官方「产出文件」行按注册顺序互斥 —— 扩展：合并渲染或注册到更早优先级；
- 二进制/超大文件的内容读取依赖宿主侧转换（read_document 返回元数据与建议）；
- 未做多语言字典注册（当前界面文案为中文），扩展点：`locale.register('workbuddy', { zh, en })`；
- 零上传直引（FS Access API 句柄 + 发送时物化 + 持久化句柄到 IndexedDB）可作为可选增强回补：默认仍走「拖入即缓存」的可靠路径，直引仅用于超大目录/远程部署场景。
