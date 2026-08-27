'use client'

import { useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Info, Layers } from 'lucide-react'
import { useToastStack } from '@/hooks/use-toast-stack'
import { playSfx } from '@/lib/audio-slot'

const INFO_MESSAGES = ['连接已同步', '存档已更新', '匹配队列已加入']
const ERROR_MESSAGES = ['信号连接失败', '操作未生效——请重试']

/**
 * Gallery page for the toast stack: three trigger buttons plus the stacked
 * display area itself (top-right, layered offset + scale to simulate depth).
 */
export function NoticeToast() {
  const { toasts, push, dismiss } = useToastStack()
  const infoCounterRef = useRef(0)
  const errorCounterRef = useRef(0)

  const triggerInfo = () => {
    push('info', INFO_MESSAGES[infoCounterRef.current % INFO_MESSAGES.length])
    infoCounterRef.current += 1
    playSfx('toast-info')
  }

  const triggerError = () => {
    push('error', ERROR_MESSAGES[errorCounterRef.current % ERROR_MESSAGES.length])
    errorCounterRef.current += 1
    playSfx('toast-error')
  }

  const triggerBurst = () => {
    push('info', '批量任务已开始')
    setTimeout(() => push('info', '第一阶段完成'), 250)
    setTimeout(() => push('error', '第二阶段出现异常'), 500)
    setTimeout(() => push('info', '已自动重试'), 750)
    playSfx('toast-info')
  }

  return (
    <div className="nt-stage">
      <div className="nt-triggers">
        <button className="nt-trigger-btn" onClick={triggerInfo}>
          <Info size={14} /> 触发信息提示
        </button>
        <button className="nt-trigger-btn is-error" onClick={triggerError}>
          <AlertTriangle size={14} /> 触发错误反馈
        </button>
        <button className="nt-trigger-btn" onClick={triggerBurst}>
          <Layers size={14} /> 连续触发（验证堆叠）
        </button>
      </div>

      <div className="nt-toast-region" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t, i) => {
            const depth = toasts.length - 1 - i
            const Icon = t.kind === 'error' ? AlertTriangle : Info
            return (
              <motion.div
                key={t.id}
                className={`nt-toast nt-toast-${t.kind}`}
                layout
                initial={{ opacity: 0, x: 60 }}
                animate={{ opacity: 1, x: 0, scale: 1 - Math.min(depth, 3) * 0.03, y: Math.min(depth, 3) * -4 }}
                exit={{ opacity: 0, x: 60 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                style={{ zIndex: 100 - depth }}
                onClick={() => dismiss(t.id)}
                role="status"
              >
                <Icon size={14} className="nt-toast-icon" />
                <span>{t.message}</span>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
