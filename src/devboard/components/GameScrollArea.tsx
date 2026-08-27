import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import type { ReactNode } from 'react';

/**
 * 独立游戏风格滚动容器
 * 
 * 特性：
 * - Radix ScrollArea headless 组件
 * - 自定义深色半透明滑块
 * - hover 时加深，拖拽时青色高亮
 * - 宽 8px 圆角 4px
 */

export interface GameScrollAreaProps {
  /** 子元素 */
  children: ReactNode;
  /** 容器类名 */
  className?: string;
  /** 最大高度（CSS 值） */
  maxHeight?: string;
}

export function GameScrollArea({
  children,
  className = '',
  maxHeight = '100%',
}: GameScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      className={`relative overflow-hidden ${className}`}
      style={{ maxHeight }}
    >
      <ScrollAreaPrimitive.Viewport className="w-full h-full">
        {children}
      </ScrollAreaPrimitive.Viewport>

      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="
          flex touch-none select-none
          w-2 p-0.5
          transition-colors duration-200
          hover:bg-[rgba(0,0,0,0.1)]
        "
      >
        <ScrollAreaPrimitive.Thumb
          className="
            flex-1 relative
            bg-[rgba(107,117,128,0.3)]
            rounded
            transition-all duration-200
            hover:bg-[rgba(107,117,128,0.5)]
            active:bg-[rgba(6,182,212,0.4)]
            before:content-['']
            before:absolute
            before:top-1/2 before:left-1/2
            before:-translate-x-1/2 before:-translate-y-1/2
            before:w-full before:h-full
            before:min-w-[44px] before:min-h-[44px]
          "
        />
      </ScrollAreaPrimitive.Scrollbar>

      <ScrollAreaPrimitive.Scrollbar
        orientation="horizontal"
        className="
          flex touch-none select-none flex-col
          h-2 p-0.5
          transition-colors duration-200
          hover:bg-[rgba(0,0,0,0.1)]
        "
      >
        <ScrollAreaPrimitive.Thumb
          className="
            flex-1 relative
            bg-[rgba(107,117,128,0.3)]
            rounded
            transition-all duration-200
            hover:bg-[rgba(107,117,128,0.5)]
            active:bg-[rgba(6,182,212,0.4)]
          "
        />
      </ScrollAreaPrimitive.Scrollbar>

      <ScrollAreaPrimitive.Corner className="bg-transparent" />
    </ScrollAreaPrimitive.Root>
  );
}
