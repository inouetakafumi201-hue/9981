'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronDown,
  Volume2,
  VolumeX,
  AudioLines,
  ImageOff,
  Layers,
  Check,
  Loader2,
  AlertTriangle,
  Ban,
  RotateCcw,
  Shield,
  X,
} from 'lucide-react'
import { useTypewriter } from './dialogue-shared'
import { useIntentChannel } from '@/lib/use-intent'
import { playSfx } from '@/lib/audio-slot'

/**
 * B5-01 — DialogAndPortraitSurface (portrait fallback focus).
 *
 * A staged narrative line that demonstrates the fixed portrait retrieval order
 * required by the brief:
 *   imageRef (explicit null → straight to no-portrait) → portraits[0] →
 *   sprites[0] / icon → no-portrait fallback.
 * Each step shows the *actual* source it landed on via a badge, the nameplate
 * always reads the projection `displayName` (never the internal speakerId),
 * voice is optional (subtitle stays visible even when voice is muted/failed),
 * and the world is never paused. Every advance / skip / close is an explicit
 * intent — a local click is never treated as a confirmed result.
 */

type PortraitSource = 'imageRef' | 'portrait' | 'sprite' | 'icon' | 'none'
type VoiceState = 'available' | 'muted' | 'failed' | 'none'

interface DialogProjection {
  dialogId: string
  revision: string
  speakerId: string
  displayName: string
  text: string
  subtitle: string
  // Ordered asset candidates. `imageRef: null` means "explicitly no key art".
  imageRef?: string | null
  portraits: readonly string[]
  sprites: readonly string[]
  icon?: string
  voiceClip?: string
  autoAdvance: boolean
  pausePolicy: 'not-paused' | 'host-requested'
  isMock: true
}

const DETECTIVE_PORTRAIT = '/games/menu/detective/portrait-detective.png'
const BROKEN_IMAGE_REF = '/games/menu/detective/__missing-keyart.png'

// Each scripted line is authored to force a different rung of the fallback
// ladder, so the whole chain is demonstrable in sequence.
const SCRIPT: DialogProjection[] = [
  {
    dialogId: 'd-01', revision: 'r1', speakerId: 'npc.detective', displayName: '侦探·墨',
    text: '这条信号能接通，说明你还没真正醒来。别急着相信眼前的东西。',
    subtitle: '这条信号能接通，说明你还没真正醒来。别急着相信眼前的东西。',
    imageRef: DETECTIVE_PORTRAIT, portraits: [DETECTIVE_PORTRAIT], sprites: [], icon: undefined,
    voiceClip: 'vo-d01', autoAdvance: false, pausePolicy: 'not-paused', isMock: true,
  },
  {
    dialogId: 'd-02', revision: 'r1', speakerId: 'npc.detective', displayName: '侦探·墨',
    text: '（模块未指定 imageRef，检索退回到实例的第一张 portrait。名字栏跟随 displayName，不暴露内部 id。）',
    subtitle: '模块未指定 imageRef，检索退回到实例第一张 portrait。',
    imageRef: undefined, portraits: [DETECTIVE_PORTRAIT], sprites: [], icon: undefined,
    voiceClip: undefined, autoAdvance: false, pausePolicy: 'not-paused', isMock: true,
  },
  {
    dialogId: 'd-03', revision: 'r1', speakerId: 'npc.detective', displayName: '侦探·墨',
    text: '（指定的 imageRef 加载失败——逐级降级到 sprite / icon，仍保留完整名字栏与字幕。语音此次标记为失败。）',
    subtitle: '指定 imageRef 加载失败，降级到 sprite / icon，语音失败但字幕不消失。',
    imageRef: BROKEN_IMAGE_REF, portraits: [], sprites: [], icon: 'detective-icon',
    voiceClip: 'vo-broken', autoAdvance: false, pausePolicy: 'not-paused', isMock: true,
  },
  {
    dialogId: 'd-04', revision: 'r1', speakerId: 'sys.narration', displayName: '旁白',
    text: '走廊尽头没有光，只有你自己的呼吸声在回荡。（imageRef 明确为 null——直接进入无立绘变体。）',
    subtitle: '走廊尽头没有光，只有你自己的呼吸声在回荡。',
    imageRef: null, portraits: [], sprites: [], icon: undefined,
    voiceClip: undefined, autoAdvance: false, pausePolicy: 'not-paused', isMock: true,
  },
]

const CONNECTED_SCRIPT: DialogProjection[] = [
  SCRIPT[0],
  {
    ...SCRIPT[0], dialogId: 'b5-d02',
    text: '第七区的中继站刚刚重新亮起。有人从里面发出了一段只对你开放的坐标。',
    subtitle: '第七区中继站恢复供能，并向你发送了私人坐标。',
  },
  {
    ...SCRIPT[0], dialogId: 'b5-d03',
    text: '信号里混着两层回声：一层像求救，另一层……像是在等你上钩。',
    subtitle: '信号包含求救与诱导两种重叠特征。',
  },
  {
    ...SCRIPT[0], dialogId: 'b5-d04',
    text: '我不会替你决定。相信、核验、观察，或者直接质问——你的判断会改变接下来的路线。',
    subtitle: '你的判断将决定任务路线与后续档案记录。',
  },
]

const SOURCE_LABEL: Record<PortraitSource, string> = {
  imageRef: '命中 imageRef',
  portrait: '命中 portraits[0]',
  sprite: '命中 sprites[0]',
  icon: '命中 icon',
  none: '无立绘降级',
}

// Resolve the first *candidate* source, honouring explicit-null. Actual load
// failure is handled at render time via onError, which nudges to the next rung.
function firstCandidate(line: DialogProjection, skip: PortraitSource[]): { source: PortraitSource; src?: string } {
  if (line.imageRef === null) return { source: 'none' }
  if (line.imageRef && !skip.includes('imageRef')) return { source: 'imageRef', src: line.imageRef }
  if (line.portraits[0] && !skip.includes('portrait')) return { source: 'portrait', src: line.portraits[0] }
  if (line.sprites[0] && !skip.includes('sprite')) return { source: 'sprite', src: line.sprites[0] }
  if (line.icon && !skip.includes('icon')) return { source: 'icon' }
  return { source: 'none' }
}

function initialsFor(name: string) {
  return name.replace(/[·・.\s]/g, '').slice(0, 2)
}

export function DialogPortrait({
  connected = false,
  onComplete,
}: {
  connected?: boolean
  onComplete?: () => void
}) {
  const [index, setIndex] = useState(0)
  const [skip, setSkipList] = useState<PortraitSource[]>([])
  const [exiting, setExiting] = useState(false)
  const [voiceState, setVoiceState] = useState<VoiceState>('available')
  const [live, setLive] = useState('')
  const { state: intent, dispatch, retry, cancel, reset } = useIntentChannel('dialog-portrait')
  const boxRef = useRef<HTMLDivElement | null>(null)

  const activeScript = connected ? CONNECTED_SCRIPT : SCRIPT
  const line = activeScript[index]
  const { shown, done, skip: skipType } = useTypewriter(line.text, 26)
  const resolved = useMemo(() => firstCandidate(line, skip), [line, skip])

  // Reset per-line derived state whenever the projected line changes.
  useEffect(() => {
    setSkipList([])
    if (line.voiceClip === undefined) setVoiceState('none')
    else if (line.voiceClip === 'vo-broken') setVoiceState('failed')
    else setVoiceState('available')
    setLive(`${line.displayName}：${line.subtitle}`)
    reset()
  }, [line, reset])

  const advance = useCallback(async () => {
    playSfx('dialogue-advance')
    const result = await dispatch('dialog.advance', { dialogId: line.dialogId })
    if (result.status !== 'accepted') return
    setExiting(true)
    setTimeout(() => {
      setExiting(false)
      if (connected && index === activeScript.length - 1) onComplete?.()
      else setIndex((i) => (i + 1) % SCRIPT.length)
    }, 200)
  }, [activeScript.length, connected, dispatch, index, line.dialogId, onComplete])

  const handleBoxClick = () => {
    if (!done) {
      skipType()
      void dispatch('dialog.reveal-complete', { dialogId: line.dialogId })
      return
    }
    void advance()
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        handleBoxClick()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, index])

  const toggleVoice = () => {
    if (voiceState === 'none' || voiceState === 'failed') return
    setVoiceState((v) => (v === 'muted' ? 'available' : 'muted'))
    void dispatch('dialog.skip-line', { dialogId: line.dialogId, voiceToggle: true })
  }

  const jumpTo = (i: number) => {
    setIndex(i)
    playSfx('option-select')
  }

  const safeReturn = useCallback(() => {
    reset()
    setSkipList([])
  }, [reset])

  const pendingLabel =
    intent.phase === 'pending' ? '意图处理中…'
    : intent.phase === 'rejected' ? `被拒绝：${intent.reason ?? ''}`
    : intent.phase === 'timeout' ? `超时：${intent.reason ?? ''}`
    : intent.phase === 'accepted' ? '宿主已确认'
    : ''

  return (
    <div className={`dp-stage ${connected ? 'dp-connected' : ''}`}>
      {/* Fallback selector only belongs to the visual-language demo, never the live chapter. */}
      {!connected && (
        <div className="dp-rungs" role="group" aria-label="演示：立绘降级级别">
          {SCRIPT.map((l, i) => (
            <button
              key={l.dialogId}
              className={`dp-rung ${index === i ? 'is-active' : ''}`}
              onClick={() => jumpTo(i)}
              aria-pressed={index === i}
            >
              {i === 0 ? 'imageRef' : i === 1 ? 'portrait' : i === 2 ? 'sprite/icon' : '无立绘'}
            </button>
          ))}
        </div>
      )}

      <div className="dp-scrim" aria-hidden="true" />

      <div className={`dp-layout ${resolved.source === 'none' ? 'dp-noportrait' : ''}`}>
        {/* Portrait stage — object-fit: contain, never cropped. */}
        <div className="dp-portrait-stage">
          <AnimatePresence mode="wait">
            <motion.div
              key={line.dialogId + resolved.source}
              className={`dp-portrait dp-portrait-${resolved.source}`}
              initial={{ opacity: 0, x: -30, rotate: -1.5 }}
              animate={{ opacity: 1, x: 0, rotate: 0 }}
              exit={{ opacity: 0, x: -22 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            >
              {resolved.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolved.src || '/placeholder.svg'}
                  alt={`${line.displayName} 立绘`}
                  className="dp-portrait-img"
                  draggable={false}
                  onError={() => {
                    // Asset error → advance to the next rung of the chain.
                    setSkipList((s) => [...s, resolved.source])
                    setLive(`立绘素材加载失败，降级：${SOURCE_LABEL[resolved.source]}`)
                    void dispatch('dialog.retry-asset', { dialogId: line.dialogId, failed: resolved.source })
                  }}
                />
              ) : resolved.source === 'icon' ? (
                <div className="dp-portrait-icon"><Layers size={40} strokeWidth={1.25} /></div>
              ) : (
                <div className="dp-portrait-empty">
                  <span className="dp-initials">{initialsFor(line.displayName)}</span>
                  <ImageOff size={16} />
                </div>
              )}
              <div className="dp-portrait-scan" aria-hidden="true" />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Dialogue body */}
        <motion.div
          animate={{ opacity: exiting ? 0 : 1, y: exiting ? -6 : 0 }}
          transition={{ duration: 0.2 }}
          className="dp-body-wrap"
        >
          <div className="dp-box">
            <div className="dp-nameplate">
              <span className="dp-nameplate-slash" aria-hidden="true" />
              {line.displayName}
              <span className="dp-speaker-id" title="内部 id，不作为玩家可见名字">{line.speakerId}</span>
            </div>

            <div
              ref={boxRef}
              className="dp-clickable"
              onClick={handleBoxClick}
              role="button"
              tabIndex={0}
              aria-label="对话正文，点击继续"
            >
              <p className="dp-text">
                {shown}
                {!done && <span className="dp-cursor" aria-hidden="true" />}
              </p>
              {done && (
                <span className="dp-advance-hint">
                  点击继续 <ChevronDown size={12} className="dp-advance-chevron" />
                </span>
              )}
            </div>

            {/* Voice + subtitle lane — subtitle is always present. */}
            <div className="dp-voice-lane">
              <button
                className={`dp-voice-btn dp-voice-${voiceState}`}
                onClick={toggleVoice}
                disabled={voiceState === 'none' || voiceState === 'failed'}
                aria-label={
                  voiceState === 'available' ? '语音播放中，点击静音'
                  : voiceState === 'muted' ? '语音已静音，点击恢复'
                  : voiceState === 'failed' ? '语音加载失败'
                  : '本行无语音'
                }
              >
                {voiceState === 'available' ? <AudioLines size={13} />
                  : voiceState === 'muted' ? <VolumeX size={13} />
                  : voiceState === 'failed' ? <AlertTriangle size={13} />
                  : <Volume2 size={13} />}
                <span>
                  {voiceState === 'available' ? '语音·播放中'
                    : voiceState === 'muted' ? '语音·静音'
                    : voiceState === 'failed' ? '语音·失败（字幕仍在）'
                    : '语音·无'}
                </span>
              </button>
              <p className="dp-subtitle" aria-live="polite">{line.subtitle}</p>
            </div>
          </div>

          <div className="dp-status-row">
            <span className="dp-pause-pill">世界状态：{line.pausePolicy === 'not-paused' ? '未暂停（默认）' : '宿主请求暂停'}</span>
            {pendingLabel && (
              <span className={`dp-intent-pill dp-intent-${intent.phase}`}>
                {intent.phase === 'pending' ? <Loader2 size={12} className="is-spin" /> : intent.phase === 'accepted' ? <Check size={12} /> : intent.phase === 'cancelled' ? <Ban size={12} /> : <AlertTriangle size={12} />}
                {pendingLabel}
              </span>
            )}
            {intent.phase !== 'idle' && intent.phase !== 'accepted' && (
              <span className="sh-intent-actions">
                {intent.phase === 'pending' && <button onClick={cancel}><X size={11} />取消</button>}
                {(intent.phase === 'rejected' || intent.phase === 'timeout' || intent.phase === 'stale') && <button onClick={retry}><RotateCcw size={11} />重试</button>}
                {(intent.phase === 'rejected' || intent.phase === 'timeout' || intent.phase === 'stale' || intent.phase === 'cancelled') && (
                  <button onClick={safeReturn}><Shield size={11} />安全返回</button>
                )}
              </span>
            )}
          </div>
        </motion.div>
      </div>

      <div className="sr-only" aria-live="polite">{live}</div>
    </div>
  )
}
