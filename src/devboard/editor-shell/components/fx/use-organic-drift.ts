'use client'

import { useMotionValue, useAnimationFrame } from 'framer-motion'

/**
 * 有机漂移：用几组互质频率的正弦波叠加驱动 x/y/rotate 三个 MotionValue，
 * 而不是一段「固定关键帧 + repeat: Infinity」的循环动画。
 *
 * 固定循环的问题是——只要盯着看几秒就会发现「啊这是在重复」，非常网页感；
 * 几组不同频率/相位的正弦波叠加后，其合成周期极长（不同频率的最小公倍数），
 * 肉眼在几十秒内几乎察觉不到重复，看起来像悬浮在流体/能量场中的重物在
 * 自然漂移——这正是「厚重感」的关键来源之一（真实物体的自由振荡从不是
 * 完美循环的）。
 *
 * @param amp 位移幅度（px），越大越「飘」；重物应用小幅度（3–8px）
 * @param speed 时间缩放，越小越「重」（更慢、更迟滞）
 */
export function useOrganicDrift(amp = 6, speed = 1) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotate = useMotionValue(0)

  useAnimationFrame((t) => {
    const s = (t / 1000) * speed
    x.set(amp * 0.6 * Math.sin(s * 0.31) + amp * 0.3 * Math.sin(s * 0.77 + 1.3))
    y.set(amp * 0.5 * Math.cos(s * 0.24) + amp * 0.35 * Math.sin(s * 0.53 + 0.4))
    rotate.set(amp * 0.12 * Math.sin(s * 0.19 + 0.9))
  })

  return { x, y, rotate }
}
