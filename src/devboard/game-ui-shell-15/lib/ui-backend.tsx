/**
 * V0 真后端 React 上下文（双轨制端到端接线 · step 5）
 *
 * 把 `bootUiBackend()` 的结果通过 React Context 暴露给 V0 树。ProductShell 在
 * 挂载时调一次 boot；之后 HudMain 等子组件用 `useUiBackend()` 拿 UiSystem。
 *
 * 设计：
 * - 失败状态（boot 返回 null）也通过 context 透出，HUD 显示 "unimplemented"
 *   /"unloaded" 占位，不让 V0 渲染 mock 视图。
 * - boot 是同步的，所以初始 state 就是 ready，无 loading 占位需求。
 * - 不订阅事件总线；V0 自身用 useEffect 触发轮询，刷新频率由 HUD 控制。
 */

'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { UiSystem } from '../../../ui/model/view'
import { bootUiBackend } from './match-boot'

interface UiBackendContextValue {
  readonly ui: UiSystem | null
  readonly error: string | null
}

const UiBackendContext = createContext<UiBackendContextValue>({ ui: null, error: null })

export function UiBackendProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<UiBackendContextValue>({ ui: null, error: null })

  useEffect(() => {
    try {
      const ui = bootUiBackend()
      if (ui === null) {
        setValue({ ui: null, error: 'createLoadedMatch 拒绝（详见 console）' })
      } else {
        setValue({ ui, error: null })
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setValue({ ui: null, error: message })
    }
  }, [])

  return <UiBackendContext.Provider value={value}>{children}</UiBackendContext.Provider>
}

export function useUiBackend(): UiBackendContextValue {
  return useContext(UiBackendContext)
}
