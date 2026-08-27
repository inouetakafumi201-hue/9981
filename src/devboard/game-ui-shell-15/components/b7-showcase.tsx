'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Play, ImageOff, Layers } from 'lucide-react'
import {
  CEREMONY_GROUP_LABEL,
  CEREMONY_SPECS,
  ceremonyDurationFor,
  type CeremonyGroup,
  type CeremonySpec,
} from '@/lib/b7-ceremony'
import {
  PARTICLE_GROUP_LABEL,
  PARTICLE_SPECS,
  type ParticleGroup,
  type ParticleSpec,
} from '@/lib/b7-particles'
import { CeremonyOverlay } from '@/components/ceremony-overlay'
import { ParticleField } from '@/components/particle-field'

type Profile = 'standard' | 'reduced' | 'low'

// B7-04 §9/§10 验收台。
// 存在的理由很直接：这两组东西之前一个都没有可播的入口，所以「有没有实现」根本无法验收，
// 才会出现「看着像做了、实际上是三处 CSS 伪元素」的状态。这里让 35 个粒子令牌和 14 个
// 全屏仪式**每一条都能单独点开播放**，并把规格数值（色号、数量、寿命、运动律、触发点、
// 结果等价物）与播放画面并列，能一眼比对实现是否 1:1。

const GROUP_ORDER: readonly CeremonyGroup[] = ['combat', 'world', 'result']
const P_GROUP_ORDER: readonly ParticleGroup[] = ['damage', 'combat', 'status', 'environment']

// ---------------------------------------------------------------------------
// §10 全屏仪式验收台
// ---------------------------------------------------------------------------
export function B7CeremonyPanel({ profile }: { profile: Profile }) {
  const [selected, setSelected] = useState<CeremonySpec>(CEREMONY_SPECS[0])
  const [missing, setMissing] = useState(false)
  const [playToken, setPlayToken] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [log, setLog] = useState<{ id: string; text: string }[]>([
    { id: 'cer-ready', text: '等待仪式触发 · 仪式只可视化已确认事实' },
  ])
  const returnRef = useRef<HTMLElement | null>(null)

  const grouped = useMemo(
    () => GROUP_ORDER.map((g) => ({ group: g, items: CEREMONY_SPECS.filter((s) => s.group === g) })),
    [],
  )

  const play = (spec: CeremonySpec, origin?: HTMLElement | null) => {
    returnRef.current = origin ?? (document.activeElement as HTMLElement | null)
    setSelected(spec)
    setPlayToken((n) => n + 1)
    setPlaying(true)
    setLog((items) =>
      [{ id: `${spec.id}-${Date.now()}`, text: `${spec.id} 播放 · 事实已在播放前写入` }, ...items].slice(0, 4),
    )
  }

  const handleDone = useCallback(
    (outcome: 'played' | 'skipped') => {
      setPlaying(false)
      setLog((items) =>
        [
          {
            id: `done-${Date.now()}`,
            text: outcome === 'skipped' ? '已跳过 → 直接落到不变量状态，事实不变' : '播放完成 → 不变量成立，无新事实',
          },
          ...items,
        ].slice(0, 4),
      )
      const target = returnRef.current
      if (target && document.contains(target)) window.setTimeout(() => target.focus(), 0)
    },
    [],
  )

  return (
    <div className="b7s-shell">
      <aside className="b7s-rail" aria-label="全屏仪式清单">
        {grouped.map(({ group, items }) => (
          <section key={group}>
            <h4>{CEREMONY_GROUP_LABEL[group]}</h4>
            {items.map((spec) => (
              <button
                key={spec.id}
                type="button"
                className={selected.id === spec.id ? 'is-on' : ''}
                aria-pressed={selected.id === spec.id}
                onClick={(e) => play(spec, e.currentTarget)}
              >
                <b>{spec.label}</b>
                <span>{spec.id}</span>
                <em>{spec.durationMs === 'loop' ? 'LOOP' : `${ceremonyDurationFor(spec, profile)}ms`}</em>
              </button>
            ))}
          </section>
        ))}
      </aside>

      <div className="b7s-main">
        <div className="b7s-stage">
          {playing ? (
            <CeremonyOverlay
              key={playToken}
              spec={selected}
              profile={profile}
              missing={missing}
              onDone={handleDone}
            />
          ) : (
            <div className="b7s-stage-idle">
              <small>{selected.id}</small>
              <strong>{selected.label}</strong>
              <p>{selected.keyArtDesc}</p>
              <button type="button" className="b7s-play" onClick={(e) => play(selected, e.currentTarget)}>
                <Play size={12} /> 播放仪式
              </button>
            </div>
          )}
        </div>

        <div className="b7s-meta">
          <div className="b7s-meta-row">
            <span>进场</span>
            <p>{selected.enterDesc}</p>
          </div>
          <div className="b7s-meta-row">
            <span>出场</span>
            <p>{selected.exitDesc}</p>
          </div>
          <div className="b7s-meta-row">
            <span>语义色</span>
            <p className="b7s-swatches">
              {selected.colors.map((c) => (
                <i key={c} style={{ background: c }} title={c} />
              ))}
              {selected.colorDesc}
            </p>
          </div>
          <div className="b7s-meta-row">
            <span>粒子</span>
            <p>{selected.particleDesc}</p>
          </div>
          <div className="b7s-meta-row">
            <span>音频/触觉</span>
            <p>{selected.audioDesc}</p>
          </div>
          <div className="b7s-meta-row">
            <span>不变量</span>
            <p>{selected.resultInvariant}</p>
          </div>
          <div className="b7s-meta-row">
            <span>素材缺失</span>
            <p>{selected.fallbackContour}</p>
          </div>

          <div className="b7s-controls">
            <button
              type="button"
              className={missing ? 'is-on' : ''}
              aria-pressed={missing}
              onClick={() => setMissing((v) => !v)}
            >
              <ImageOff size={12} /> 模拟素材缺失
            </button>
            <span className="b7s-skip-hint">{selected.skippable ? 'ESC / SKIP 可跳过' : '循环态 · 由匹配结束'}</span>
          </div>

          <ul className="b7s-log">
            {log.map((l) => (
              <li key={l.id}>{l.text}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// §9 粒子令牌验收台
// ---------------------------------------------------------------------------
export function B7ParticlePanel({ profile }: { profile: Profile }) {
  const [selected, setSelected] = useState<ParticleSpec>(PARTICLE_SPECS[0])
  const [playToken, setPlayToken] = useState(0)

  const grouped = useMemo(
    () => P_GROUP_ORDER.map((g) => ({ group: g, items: PARTICLE_SPECS.filter((s) => s.group === g) })),
    [],
  )

  const play = (spec: ParticleSpec) => {
    setSelected(spec)
    setPlayToken((n) => n + 1)
  }

  // stream-to / bounce-to 要有真实的界面锚点，否则「流向清醒条 / 飞入货币栏」无从验收
  const anchored = selected.motion === 'stream-to' || selected.motion === 'bounce-to'

  return (
    <div className="b7s-shell">
      <aside className="b7s-rail" aria-label="粒子令牌清单">
        {grouped.map(({ group, items }) => (
          <section key={group}>
            <h4>{PARTICLE_GROUP_LABEL[group]}</h4>
            {items.map((spec) => (
              <button
                key={spec.id}
                type="button"
                className={selected.id === spec.id ? 'is-on' : ''}
                aria-pressed={selected.id === spec.id}
                onClick={() => play(spec)}
              >
                <b>{spec.label}</b>
                <span>{spec.id}</span>
                <i className="b7s-dot" style={{ background: spec.colors[0] }} />
              </button>
            ))}
          </section>
        ))}
      </aside>

      <div className="b7s-main">
        <div className="b7s-stage b7s-stage-particle">
          {/* 锚点：清醒条与货币栏，stream-to / bounce-to 的目标 */}
          {anchored && (
            <div className="b7s-anchor" aria-hidden="true">
              <small>{selected.id === 'P-STAMINA' ? 'AWAKE' : 'VAULT'}</small>
              <i style={{ background: selected.colors[0] }} />
            </div>
          )}
          <span className="b7s-origin" aria-hidden="true" />
          <ParticleField
            specIds={[selected.id]}
            playToken={playToken}
            profile={profile}
            anchor={{ xPct: 84, yPct: 14 }}
            origin={{ xPct: selected.motion === 'float-up' ? 50 : 46, yPct: selected.motion === 'float-up' ? 96 : 56 }}
            loop={selected.motion === 'hold-jitter'}
          />
          <button type="button" className="b7s-play b7s-play-float" onClick={() => play(selected)}>
            <Play size={12} /> 重播
          </button>
          {profile !== 'standard' && (
            <p className="b7s-degraded">
              <Layers size={12} /> {profile === 'reduced' ? 'reduced-motion' : '低性能档'}：粒子整体关闭，结果由「
              {selected.resultEquivalent}」承担
            </p>
          )}
        </div>

        <div className="b7s-meta">
          <div className="b7s-meta-row">
            <span>语义色</span>
            <p className="b7s-swatches">
              {selected.colors.map((c) => (
                <i key={c} style={{ background: c }} title={c} />
              ))}
              {selected.colors.join(' → ')}
            </p>
          </div>
          <div className="b7s-meta-row">
            <span>形状/运动</span>
            <p>
              {selected.shape} · {selected.motion}
              {selected.coneDeg ? ` · ${selected.coneDeg}°` : ''}
            </p>
          </div>
          <div className="b7s-meta-row">
            <span>数量/寿命</span>
            <p>
              {selected.count[0]}–{selected.count[1]} 粒 · {selected.lifeMs[0]}–{selected.lifeMs[1]}ms ·{' '}
              {selected.sizePx[0]}–{selected.sizePx[1]}px
            </p>
          </div>
          <div className="b7s-meta-row">
            <span>触发点</span>
            <p>{selected.trigger}</p>
          </div>
          <div className="b7s-meta-row">
            <span>结果等价物</span>
            <p>{selected.resultEquivalent}</p>
          </div>
          {selected.composedWith && (
            <div className="b7s-meta-row">
              <span>组合令牌</span>
              <p>{selected.composedWith.join(' + ')}</p>
            </div>
          )}
          {selected.visibility === 'related-only' && (
            <div className="b7s-meta-row">
              <span>可见性</span>
              <p>仅相关者可见（克制解除不公开广播）</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
