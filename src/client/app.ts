/**
 * Client 半侧实现（factory 模式）。
 *
 * DSH 客户端模块加载器要求 client 产物是「普通副作用脚本」：加载时调用
 * window.__ModuleLoader__.load({ id, factory })，factory 签名 (require) => module，
 * 返回 { apply, inject, name }。react 通过 factory 的 require('react') 取得
 * （参考 dsh-pet 的 src/client/app.ts 与 index.ts）。
 *
 * 纯逻辑模块（lib/*、at-source、definitions）不依赖 react，可安全地
 * 被 tsdown 内联到 bundle 顶层；组件在 factory 内以注入的 React 构造。
 */
import { createAtSource } from './at-source'
import { createFileCardsComponent } from './components/file-cards'
import { createOverlayComponent, ReactLike } from './components/overlay'
import { createPickButtonComponent } from './components/pick-button'
import { CSS } from './css'
import { boundaryDef, fileRefsDef } from './definitions'
import { createDropBus } from './lib/bus'
import { createDropHandlers } from './lib/drop'
import { createInsertPipeline } from './lib/insert'
import { dropsHome, runUploadJobs } from './lib/transfer'
import type { UploadJob } from './types'

/** 工厂返回的 Cordis 客户端插件 */
export interface ClientPlugin {
  apply(ctx: Record<string, unknown>): void
  /** 硬依赖：Cordis 会等这些服务就绪后再 apply（缺失即无限等待，不会静默跳过） */
  inject: string[]
  name?: string
}

export function makeFactory() {
  return function workbuddyClientFactory(require: (m: string) => unknown): ClientPlugin {
    const React = require('react') as ReactLike

    return {
      name: 'workbuddy-files',
      // 0.2.0：slots / conversation / uiConversation（会话定义注册）/ inputTriggers
      inject: ['slots', 'conversation', 'uiConversation', 'inputTriggers'],
      apply(ctx) {
        try {
          applyClient(ctx, React)
        } catch (err) {
          console.error('[workbuddy-files] client apply 异常:', err)
        }
      },
    }
  }
}

function applyClient(ctx: Record<string, unknown>, React: ReactLike): void {
  console.log('[workbuddy-files] client apply 开始')
  const get = (name: string) => (ctx.get as (n: string) => unknown)(name)

        // ---- 能力探测（缺失则优雅退出）----
        const slots = get('slots') as {
          inject(key: string, callback: () => unknown): () => void
          register(options: Record<string, unknown>, component: unknown): unknown
        } | undefined
        const conversation = get('conversation') as never
        const inputTriggers = get('inputTriggers') as {
          registerSource(source: unknown): () => void
        } | undefined
        // 0.2.0：conversationEvents 服务改名为 uiConversation（定义注册在 .events 上）
        const uiConversation = get('uiConversation') as {
          events?: { register(definition: unknown): (() => void) | undefined }
        } | undefined
        const styles = get('styles') as { insert(css: string): () => void } | undefined
        if (slots === undefined) return

        // ---- 当前会话 id ----
        // 0.2.0 的 sessions 服务不再暴露 list；会话 id 由 session 作用域的插槽标准属性提供
        let currentSessionId: string | undefined
        const setSessionId = (id: string | undefined): void => { currentSessionId = id }
        const getSessionId = (): string | undefined => currentSessionId

        // ---- 包内样式 ----
        // 正式插件包没有动态版的 styles 内置服务：回退到 document.head style 注入（dsh-pet 同款）
        const injectCssViaHead = (css: string): void => {
          if (typeof document === 'undefined') return
          const tagId = 'dsh-workbuddy-files/styles'
          if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-workbuddy-files'
          tag.dataset.pluginCss = tagId
          tag.textContent = css
          document.head.appendChild(tag)
        }
        const insertStyles = () => {
          if (styles !== undefined) return styles.insert(CSS)
          injectCssViaHead(CSS)
          return () => {}
        }
        const effect = (ctx.effect as (fn: () => (() => void) | undefined, label?: string) => void).bind(ctx)
        effect(insertStyles, 'workbuddy: styles')
        console.log('[workbuddy-files] client apply 开始：services slots=' + (slots !== undefined) + ' conversation=' + (conversation !== undefined) + ' inputTriggers=' + (inputTriggers !== undefined) + ' uiConversation=' + (uiConversation !== undefined) + ' styles=' + (styles !== undefined))

        // ---- 共享实例 ----
        const bus = createDropBus()

        // ---- 缓存根目录（启动预取；拖入时兜底拉取）----
        let rootCache: string | null = null
        void dropsHome().then((r) => { rootCache = r })
        const ensureRoot = async (): Promise<string | null> => {
          if (rootCache !== null) return rootCache
          const r = await dropsHome()
          rootCache = r
          return r
        }

        // ---- 后台上传队列（完成/失败 toast）----
        const enqueueUpload = (jobs: UploadJob[], batch: string): void => {
          void runUploadJobs(jobs, batch).then(({ ok, failed }) => {
            if (failed.length > 0) {
              bus.toast('缓存失败 ' + failed.length + ' 项：' + failed.slice(0, 2).join('；') + (failed.length > 2 ? '…' : ''), 'error')
            } else if (ok > 0) {
              bus.toast('后台缓存完成：' + ok + ' 个文件已就绪')
            }
          }).catch((err) => {
            bus.toast('后台缓存失败：' + String((err as Error)?.message ?? err), 'error')
          })
        }

        // ---- 气泡注入管线 ----
        const insert = createInsertPipeline({ conversation, currentSessionId: getSessionId, toast: bus.toast })

        // ---- 拖拽 / 粘贴处理 + 窗口级监听 ----
        const handlers = createDropHandlers({ bus, insert, ensureRoot, enqueueUpload })
        effect(() => {
          const off = handlers.installListeners()
          console.log('[workbuddy-files] 窗口拖拽/粘贴监听已注册')
          return off
        }, 'workbuddy: window listeners')

        // ---- @ 触发源（文件缓存分组）----
        if (inputTriggers !== undefined) {
          const source = createAtSource()
          effect(() => inputTriggers.registerSource(source), 'workbuddy: @ source')
        }

        // ---- 会话事件定义（0.2.0：注册在 uiConversation.events 上）----
        const events = uiConversation !== undefined ? uiConversation.events : undefined
        if (events !== undefined) {
          effect(() => {
            const d1 = events.register(boundaryDef)
            const d2 = events.register(fileRefsDef)
            return () => {
              if (typeof d1 === 'function') d1()
              if (typeof d2 === 'function') d2()
            }
          }, 'workbuddy: conversation definitions')
        }

        // ---- Slot 注册 ----
        slots.inject('shell.overlay', () => slots.register(
          { name: 'shell.overlay', id: 'workbuddy-drop', order: 300, label: 'WorkBuddy 拖拽遮罩' },
          createOverlayComponent(React, bus),
        ))
        // conversation.input.left：session 作用域，标准属性含 sessionId —— 在此捕获当前会话
        slots.inject('conversation.input.left', () => slots.register(
          { name: 'conversation.input.left', id: 'workbuddy-pick', order: 0, label: '引用文件/文件夹' },
          createPickButtonComponent(React, bus, handlers, setSessionId),
        ))
        // 0.2.0：turnTail 从 chain 变为 list —— 用 id 注册，组件直接拿到 { turn, seq, openFile }
        slots.inject('conversation.chat.turnTail', () => slots.register(
          { name: 'conversation.chat.turnTail', id: 'dsh-workbuddy-files', order: 20, label: '文件引用卡片' },
          createFileCardsComponent(React),
        ))

        console.log('[workbuddy-files] client 就绪：拖入即插气泡 + 后台缓存 / 统一遮罩 / 文件卡片')
}
