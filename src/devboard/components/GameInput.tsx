import { motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, type InputHTMLAttributes } from 'react';

/**
 * 独立游戏风格文本输入框
 * 
 * 特性：
 * - 深色背景 + 半透明边框
 * - focus 时青色发光动画
 * - Framer Motion 平滑过渡
 * - 支持 number/text 类型
 */

export interface GameInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 自定义类名（附加到 input 元素） */
  className?: string;
  /** 自定义类名（附加到容器） */
  containerClassName?: string;
}

export const GameInput = forwardRef<HTMLInputElement, GameInputProps>(
  ({ containerClassName = '', className = '', ...props }, ref) => {
    return (
      <motion.div
        className={`relative ${containerClassName}`}
        initial={false}
        whileFocus={{
          boxShadow: '0 0 0 2px rgba(6,182,212,0.5)',
        }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      >
        <input
          ref={ref}
          className={`
            w-full px-3 py-1.5
            text-xs text-[#d1d9e0]
            bg-[#1a1e29]
            border border-solid border-[rgba(207,218,226,0.1)]
            rounded
            outline-none
            transition-colors duration-200
            hover:border-[rgba(207,218,226,0.2)]
            focus:border-[rgba(6,182,212,0.4)]
            placeholder:text-[#6b7580]
            ${className}
          `}
          {...props}
        />
      </motion.div>
    );
  }
);

GameInput.displayName = 'GameInput';
