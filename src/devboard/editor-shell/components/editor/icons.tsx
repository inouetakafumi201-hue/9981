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

export function IconUndo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </svg>
  )
}

export function IconRedo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0 0 10h3" />
    </svg>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconBlueprint(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 9h18M8 4v5M8 14h5M8 17h8" />
    </svg>
  )
}

export function IconExport(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 5h9M5 5v14M5 19h9" />
      <path d="m14 8 5 4-5 4z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconFolder(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

export function IconBucket(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8h16l-1.5 11a1.5 1.5 0 0 1-1.5 1.3H7a1.5 1.5 0 0 1-1.5-1.3z" />
      <path d="M8 8a4 4 0 0 1 8 0" />
    </svg>
  )
}

export function IconEye(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  )
}

export function IconEyeOff(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10.7 6.2A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 4M6.3 6.4A16.6 16.6 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
    </svg>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  )
}

export function IconWarn(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3.1L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4.5M12 17h.01" />
    </svg>
  )
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function IconChevronLeft(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  )
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/* ---- toolbar tool icons ---- */
export function IconSelect(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4h5M4 4v5M20 4h-5M20 4v5M4 20h5M4 20v-5M20 20h-5M20 20v-5" />
    </svg>
  )
}

export function IconPlace(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 3 8v8l9 5 9-5V8z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </svg>
  )
}

export function IconEdge(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="18" cy="6" r="2.4" />
      <path d="M8 16 16 8" />
    </svg>
  )
}

export function IconSample(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m14 4 6 6M18 8 8.5 17.5a2 2 0 0 1-1 .5l-3.5.7.7-3.5a2 2 0 0 1 .5-1L14 5" />
    </svg>
  )
}

export function IconAnchor(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="5" r="2.4" />
      <path d="M12 7.4V21M6 12H4a8 8 0 0 0 16 0h-2M12 21c-3 0-5-1.8-6-4M12 21c3 0 5-1.8 6-4" />
    </svg>
  )
}

export function IconSoundOn(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 10v4h3.5L13 18V6L7.5 10z" fill="currentColor" stroke="none" />
      <path d="M16.5 9a4 4 0 0 1 0 6M19 7a7.5 7.5 0 0 1 0 10" />
    </svg>
  )
}

export function IconSoundOff(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 10v4h3.5L13 18V6L7.5 10z" fill="currentColor" stroke="none" />
      <path d="M17 9.5 21.5 14M21.5 9.5 17 14" />
    </svg>
  )
}

export function IconCrosshair(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="7.2" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  )
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  )
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="12" height="12" rx="1.5" />
      <path d="M5 15V4.5A1.5 1.5 0 0 1 6.5 3H15" />
    </svg>
  )
}

export function IconLink(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 14.5l5-5M8 16H6a4 4 0 0 1 0-8h2M16 8h2a4 4 0 0 1 0 8h-2" />
    </svg>
  )
}

export function IconLayers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  )
}

export function IconInfo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v5h1" />
    </svg>
  )
}

export function IconImport(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v12M8 11l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  )
}

export function IconImage(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  )
}
