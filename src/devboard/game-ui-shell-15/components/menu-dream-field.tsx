'use client'

import { useMemo } from 'react'

const NODES = [
  { id: 'north', className: 'mdf-node north', label: 'N-04', detail: 'ORBIT TRACE' },
  { id: 'west', className: 'mdf-node west', label: 'W-17', detail: 'ARCHIVE ECHO' },
  { id: 'east', className: 'mdf-node east', label: 'E-09', detail: 'SIGNAL LOSS' },
  { id: 'south', className: 'mdf-node south', label: 'S-22', detail: 'DREAM RESIDUE' },
]

export function MenuDreamField() {
  const fragments = useMemo(() => [
    { className: 'mdf-fragment fragment-a', style: { objectPosition: '10% 12%' } },
    { className: 'mdf-fragment fragment-b', style: { objectPosition: '84% 18%' } },
    { className: 'mdf-fragment fragment-c', style: { objectPosition: '16% 82%' } },
    { className: 'mdf-fragment fragment-d', style: { objectPosition: '88% 78%' } },
  ], [])

  return (
    <div className="mdf-field" aria-hidden="true">
      <div className="mdf-rays" />
      <div className="mdf-scan" />
      <div className="mdf-crosshair mdf-crosshair-a" />
      <div className="mdf-crosshair mdf-crosshair-b" />
      {fragments.map((fragment) => (
        <img
          key={fragment.className}
          className={fragment.className}
          src="/games/menu/dream-investigation-fragments.png"
          alt=""
          style={fragment.style}
        />
      ))}
      {NODES.map((node) => (
        <div key={node.id} className={node.className}>
          <span className="mdf-node-dot" />
          <span className="mdf-node-label">{node.label}</span>
          <span className="mdf-node-detail">{node.detail}</span>
        </div>
      ))}
    </div>
  )
}
