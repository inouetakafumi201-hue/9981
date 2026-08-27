'use client'

import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * 「有质量」的按钮手感：悬停时先做一次轻微下沉再回抬（模拟机械按键的预压），
 * 按下时真正下沉+压扁+提亮内部光泽，松开时用弹簧回弹（overshoot），而不是
 * CSS transition 的匀速插值——这是网页感和游戏手感最大的分歧点。
 *
 * 使用方式与原生 <button> 完全一致，可直接替换现有 onClick/disabled/className。
 */
// framer-motion 的 motion.button 把 onDrag*/onAnimation*/onTransitionEnd 系列 props
// 重新定义为「手势/动画」回调，与原生 HTML 同名 DOM 事件签名冲突。WeightedButton
// 本身不需要这些原生拖拽或 CSS 动画事件，故显式排除；调用方若确实需要，请直接用
// 普通 <button>（本文件其余组件的做法）。
type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | 'onDrag'
  | 'onDragStart'
  | 'onDragEnd'
  | 'onDragEnter'
  | 'onDragExit'
  | 'onDragLeave'
  | 'onDragOver'
  | 'onDrop'
  | 'onAnimationStart'
  | 'onAnimationEnd'
  | 'onAnimationIteration'
  | 'onTransitionEnd'
>

export function WeightedButton({
  children,
  className = '',
  disabled,
  onClick,
  style,
  ...rest
}: NativeButtonProps & { children: ReactNode }) {
  const press = useMotionValue(0) // 0 = 松开, 1 = 按下
  const spring = useSpring(press, { stiffness: 520, damping: 28, mass: 0.6 })
  const y = useTransform(spring, [0, 1], [0, 2])
  const scale = useTransform(spring, [0, 1], [1, 0.965])
  const sheen = useTransform(spring, [0, 1], [0.14, 0.04])
  const shadowY = useTransform(spring, [0, 1], [3, 1])

  return (
    <motion.button
      {...rest}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={() => !disabled && press.set(1)}
      onPointerUp={() => press.set(0)}
      onPointerLeave={() => press.set(0)}
      whileHover={disabled ? undefined : { y: -1.5 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24 }}
      style={{ ...style, y, scale }}
      className={`relative overflow-hidden ${disabled ? 'opacity-50' : ''} ${className}`}
    >
      {/* 顶部高光——按下时收暗，模拟受压材质反射变化。显式负 z-index（而非 auto）
          让它们落入 CSS 绘制顺序中「负层」这一档，保证始终画在文字/图标内容之下。 */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-1/2 rounded-[inherit]"
        style={{
          opacity: sheen,
          background: 'linear-gradient(to bottom, rgba(255,255,255,0.9), transparent)',
        }}
      />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
        style={{ boxShadow: useTransform(shadowY, (v) => `0 ${v}px 0 0 rgba(0,0,0,0.35) inset`) }}
      />
      {children}
    </motion.button>
  )
}
