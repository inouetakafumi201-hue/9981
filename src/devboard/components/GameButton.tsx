import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * 独立游戏风格按钮组件
 * 
 * 特性：
 * - Framer Motion 动效（hover/press 弹性反馈）
 * - 三种变体：primary（主操作）/ ghost（次要）/ icon（图标）
 * - 渐变背景 + 内阴影高光 + 外发光
 * - 完全自定义，不依赖原生 button 样式
 */

export type GameButtonVariant = 'primary' | 'ghost' | 'icon';

export interface GameButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  /** 按钮变体 */
  variant?: GameButtonVariant;
  /** 是否激活态（工具栏/图层选中） */
  active?: boolean;
  /** 子元素 */
  children: ReactNode;
}

export function GameButton({
  variant = 'ghost',
  active = false,
  children,
  className = '',
  ...props
}: GameButtonProps) {
  // 基础样式（所有变体共享）
  const baseStyles = `
    relative inline-flex items-center justify-center
    rounded-md font-medium
    transition-colors duration-200
    cursor-pointer
    border border-solid
    outline-none focus-visible:outline-none
  `;

  // 变体样式
  const variantStyles: Record<GameButtonVariant, string> = {
    primary: `
      px-4 py-2 text-sm
      bg-gradient-to-br from-[#06b6d4] to-[#0891b2]
      text-white
      border-transparent
      shadow-[0_0_16px_rgba(6,182,212,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]
      hover:shadow-[0_0_20px_rgba(6,182,212,0.7),inset_0_1px_0_rgba(255,255,255,0.15)]
    `,
    ghost: `
      px-3 py-1.5 text-xs
      bg-[#191d28]
      text-[#d1d9e0]
      border-[rgba(207,218,226,0.1)]
      hover:bg-[#1f2430]
      hover:border-[rgba(6,182,212,0.3)]
      ${active ? 'bg-[rgba(6,182,212,0.15)] border-[#06b6d4] shadow-[0_0_12px_rgba(6,182,212,0.4)]' : ''}
    `,
    icon: `
      w-8 h-8 p-0
      bg-transparent
      text-[#d1d9e0]
      border-transparent
      hover:bg-[rgba(6,182,212,0.1)]
      hover:text-[#06b6d4]
    `,
  };

  // Framer Motion 动画变体
  const motionVariants = {
    hover: {
      scale: 1.02,
      y: -1,
      transition: { type: 'spring', stiffness: 400, damping: 20 },
    },
    tap: {
      scale: 0.98,
      transition: { duration: 0.1 },
    },
  };

  return (
    <motion.button
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
      variants={motionVariants}
      whileHover="hover"
      whileTap="tap"
      {...props}
    >
      {children}
    </motion.button>
  );
}
