import * as SelectPrimitive from '@radix-ui/react-select';
import { motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * 独立游戏风格下拉选择组件
 * 
 * 特性：
 * - Radix Select headless 组件
 * - 完全自定义弹出层样式
 * - 选项 hover 青色高亮
 * - Framer Motion 进入/退出动画
 */

export interface GameSelectProps {
  /** 当前值 */
  value: string;
  /** 值变化回调（优先使用） */
  onValueChange?: (value: string) => void;
  /** 值变化回调（别名，兼容 onChange） */
  onChange?: (value: string) => void;
  /** 占位符 */
  placeholder?: string;
  /** 选项列表 */
  options: { value: string; label: ReactNode }[];
  /** 是否禁用 */
  disabled?: boolean;
}

export function GameSelect({
  value,
  onValueChange,
  onChange,
  placeholder = '选择...',
  options,
  disabled = false,
}: GameSelectProps) {
  const handleChange = onValueChange || onChange || (() => {});
  
  return (
    <SelectPrimitive.Root value={value} onValueChange={handleChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        className="
          inline-flex items-center justify-between
          w-full px-3 py-1.5
          text-xs text-[#d1d9e0]
          bg-[#1a1e29]
          border border-solid border-[rgba(207,218,226,0.1)]
          rounded
          outline-none
          hover:border-[rgba(6,182,212,0.3)]
          focus:border-[rgba(6,182,212,0.4)]
          focus:shadow-[0_0_0_2px_rgba(6,182,212,0.3)]
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-all duration-200
        "
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown size={14} className="text-[#6b7580]" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="
            overflow-hidden
            bg-[#191d28]
            border border-solid border-[rgba(207,218,226,0.15)]
            rounded-md
            shadow-[0_8px_24px_rgba(0,0,0,0.5)]
            z-50
          "
          asChild
        >
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="
                    relative flex items-center
                    px-3 py-2 pl-8
                    text-xs text-[#d1d9e0]
                    rounded
                    outline-none
                    cursor-pointer
                    select-none
                    transition-colors duration-150
                    hover:bg-[rgba(6,182,212,0.15)]
                    focus:bg-[rgba(6,182,212,0.15)]
                    data-[state=checked]:text-[#06b6d4]
                  "
                >
                  <SelectPrimitive.ItemIndicator className="absolute left-2">
                    <Check size={12} className="text-[#06b6d4]" />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </motion.div>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
