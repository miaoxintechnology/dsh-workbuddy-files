/**
 * 宿主（DSH）运行时模块的最小环境声明。
 *
 * 这两个包由 Harness 在运行时提供（宿主模块解析），第三方插件不把它们装成
 * 依赖 —— 官方 0.2.0 插件同样只 peer 依赖 @deepseek-ai/cordis。这里声明本
 * 插件实际消费的接口形状，使本地 `npm run typecheck` 不依赖宿主包。
 */

declare module '@deepseek-ai/dsh-tools' {
  /** 模型工具定义（本插件只消费 defineTool 的宽松签名） */
  export interface ToolDefinition {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: {
      schema: unknown
      render: (args: unknown, value: unknown) => Array<{ type: string; text: string }>
      presentationMeta?: (args: unknown, value: unknown) => unknown
    }
    execute: (args: never, exec: unknown) => Promise<unknown>
    presentCall?: (args: never) => unknown
    presentResult?: (args: never, result: unknown) => unknown
  }
  /** 定义并校验一个模型工具 */
  export function defineTool<T extends Record<string, unknown>>(definition: T): T
}

declare module '@deepseek-ai/dsh-client-ui-input-trigger/client' {
  /** 一条 @ / 菜单候选 */
  export interface InputTriggerCandidate {
    name: string
    description?: string
    icon?: string
    hint?: string
    section?: string
    value?: string
  }
  /** 一次 @ / 菜单触发源的注册面 */
  export interface InputTriggerSource {
    trigger: '@' | '/'
    name: string
    order?: number
    showGroupTitle?: boolean
    candidates(
      session: { readonly sessionId: string },
      request: { query: string; quoted?: boolean; signal: AbortSignal },
    ): Promise<InputTriggerCandidate[]> | InputTriggerCandidate[]
    onPick(pick: { candidate: InputTriggerCandidate }): { insert?: unknown } | undefined
    codec?: {
      clipboardText(ref: string): string
      serialize(ref: string, signal: AbortSignal): Promise<string>
    }
  }
}
