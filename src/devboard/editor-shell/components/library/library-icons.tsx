import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = (props: IconProps) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
})

export function IconStar({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(props)} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z" />
    </svg>
  )
}

export function IconBack(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M11 5l-7 7 7 7M4 12h16" />
    </svg>
  )
}

export function IconChevronUp(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 15 6-6 6 6" />
    </svg>
  )
}

export function IconChevronLeft(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m14 6-6 6 6 6" />
    </svg>
  )
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m10 6 6 6-6 6" />
    </svg>
  )
}

export function IconFilter(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 5h18l-7 8v5l-4 2v-7z" />
    </svg>
  )
}

export function IconHammer(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4l6 6-2.5 2.5-6-6z" />
      <path d="M11.5 6.5 4 14v3h3l7.5-7.5" />
    </svg>
  )
}

/** 画笔——像素绘制器入口按钮（仅合成物详情展示，见 library-detail.tsx） */
export function IconPaint(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M18.5 3.5a2.1 2.1 0 0 1 3 3L11 17l-4.5 1.5L8 14z" />
      <path d="M6.5 18.5c-1.2 0-2 .8-2 2s-.8 2-2 2c1.5 0 3.5-.6 4-2" />
    </svg>
  )
}

/* --- 详情面板五维图标 --- */
export function StatAttr(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  )
}
export function StatSkill(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8" />
      <path d="m12 6 1.6 3.3 3.6.5-2.6 2.5.6 3.6L12 14.7 8.8 16.4l.6-3.6L6.8 10l3.6-.5z" />
    </svg>
  )
}
export function StatState(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12l4-2M12 12v4" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}
export function StatDefense(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l7 3v5c0 5-3 7.5-7 9-4-1.5-7-4-7-9V6z" />
    </svg>
  )
}
export function StatMobility(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 14c5-1 8-4 15-11-2 7-5 11-11 14z" />
      <path d="M4 14c2 0 4 1 5 3" />
    </svg>
  )
}
