'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Captions,
  CaptionsOff,
  ChevronRight,
  Footprints,
  RotateCcw,
  Volume2,
  VolumeX,
  Waves,
  AlertOctagon,
} from 'lucide-react'
import { playSfx } from '@/lib/audio-slot'

/**
 * B4-04 — SubtitleOverlay + SoundVisualAlternative.
 *
 * Both are *overlay presenters* of an already visibility-filtered projection:
 * they never invent lines, never leak information the player cannot already
 * perceive, and never treat a played/failed sound as a rule event. The subtitle
 * sits in the bottom safe area with a speaker label + optional voice-state; the
 * sound visual alternative gives deaf / muted / audio-failed players the same
 * cue through an icon, a direction label and a readable description — never
 * colour or audio alone.
 */

type VoiceState = 'available' | 'muted' | 'missing' | 'failed'
type SpeakerTone = 'player' | 'npc' | 'narration'

interface SubtitleLine {
  speakerLabel: string
  tone: SpeakerTone
  text: string
  source: 'mock'
}

interface SoundCue {
  iconKind: 'steps' | 'ambient' | 'alarm'
  label: string
  directionLabel: string
  description: string
  severity: 'info' | 'warn'
  source: 'mock'
}

const LINES: SubtitleLine[] = [
  { speakerLabel: '你', tone: 'player', text: '这里的信号……比档案里记录的要稳定得多。', source: 'mock' },
  { speakerLabel: '灰隼', tone: 'npc', text: '别被表象骗了。稳定的信号，往往意味着有人在维持它。', source: 'mock' },
  { speakerLabel: '旁白', tone: 'narration', text: '远处的中继塔亮起一盏灯，随后是第二盏。', source: 'mock' },
  { speakerLabel: '灰隼', tone: 'npc', text: '走吧。趁它还愿意让我们过去。', source: 'mock' },
]

const CUES: SoundCue[] = [
  { iconKind: 'steps', label: '脚步声', directionLabel: '右后方', description: '有沉重的脚步正在靠近，节奏缓慢而规律。', severity: 'warn', source: 'mock' },
  { iconKind: 'ambient', label: '环境嗡鸣', directionLabel: '四周', description: '低频的电流嗡鸣充满整个空间。', severity: 'info', source: 'mock' },
  { iconKind: 'alarm', label: '警报', directionLabel: '前方远处', description: '短促的三连警报——某处的门被强行打开。', severity: 'warn', source: 'mock' },
]

const TONE_LABEL: Record<SpeakerTone, string> = { player: '玩家', npc: '角色', narration: '旁白' }
const VOICE_META: Record<VoiceState, { label: string; icon: typeof Volume2 }> = {
  available: { label: '语音可用', icon: Volume2 },
  muted: { label: '已静音', icon: VolumeX },
  missing: { label: '语音缺失', icon: VolumeX },
  failed: { label: '语音加载失败', icon: AlertOctagon },
}
const CUE_ICON = { steps: Footprints, ambient: Waves, alarm: AlertOctagon } as const

export function SubtitleOverlay() {
  const [lineIndex, setLineIndex] = useState(0)
  const [cueIndex, setCueIndex] = useState(0)
  const [subtitlesOn, setSubtitlesOn] = useState(true)
  const [voice, setVoice] = useState<VoiceState>('available')
  const [live, setLive] = useState('')
  const advanceRef = useRef<HTMLButtonElement | null>(null)

  const line = LINES[lineIndex]
  const cue = CUES[cueIndex]
  const audioUsable = voice === 'available'

  useEffect(() => {
    if (subtitlesOn) setLive(`${line.speakerLabel}：${line.text}`)
  }, [lineIndex, subtitlesOn, line])

  const advanceLine = () => {
    setLineIndex((i) => (i + 1) % LINES.length)
    playSfx('dialogue-advance')
  }
  const cycleCue = () => {
    setCueIndex((i) => (i + 1) % CUES.length)
    const next = CUES[(cueIndex + 1) % CUES.length]
    setLive(`声音提示：${next.label}，来自${next.directionLabel}。${next.description}`)
    playSfx('ui-toggle')
  }
  const toggleSubtitles = () => {
    setSubtitlesOn((v) => {
      const next = !v
      setLive(next ? '字幕已开启' : '字幕已关闭（仅本地偏好）')
      return next
    })
    playSfx('ui-toggle')
  }
  const cycleVoice = () => {
    const order: VoiceState[] = ['available', 'muted', 'missing', 'failed']
    setVoice((v) => {
      const next = order[(order.indexOf(v) + 1) % order.length]
      setLive(`语音状态：${VOICE_META[next].label}。字幕与视觉替代不受影响。`)
      return next
    })
    playSfx('ui-toggle')
  }

  const VoiceIcon = VOICE_META[voice].icon
  const CueIcon = CUE_ICON[cue.iconKind]

  return (
    <div className="so-stage">
      {/* mock world backdrop so the overlay reads as an in-world layer, not a form */}
      <div className="so-world" aria-hidden="true">
        <div className="so-world-horizon" />
        <div className="so-world-glow" />
        <span className="so-world-tag">世界层 · 占位背景</span>
      </div>

      <div className="so-controls" aria-label="字幕与声音替代演示控制">
        <button className="so-ctl" onClick={advanceLine}>
          <ChevronRight size={13} /> 下一句字幕
        </button>
        <button className={`so-ctl ${subtitlesOn ? '' : 'is-off'}`} onClick={toggleSubtitles} aria-pressed={subtitlesOn}>
          {subtitlesOn ? <Captions size={13} /> : <CaptionsOff size={13} />}
          字幕 {subtitlesOn ? '开' : '关'}
        </button>
        <button className="so-ctl" onClick={cycleVoice}>
          <VoiceIcon size={13} /> {VOICE_META[voice].label}
        </button>
        <button className="so-ctl" onClick={cycleCue}>
          <Waves size={13} /> 切换声音事件
        </button>
        <button className="so-ctl" onClick={() => { setLineIndex(0); setCueIndex(0); setVoice('available'); setSubtitlesOn(true); setLive('已重置'); }}>
          <RotateCcw size={12} /> 重置
        </button>
      </div>

      {/* Sound visual alternative — top-right, always available regardless of audio */}
      <div className={`so-sound so-sound-${cue.severity}`} role="status" aria-label={`声音提示 ${cue.label}`}>
        <span className="so-sound-icon">
          <CueIcon size={18} />
        </span>
        <div className="so-sound-body">
          <div className="so-sound-head">
            <span className="so-sound-label">{cue.label}</span>
            <span className="so-sound-dir">
              <ChevronRight size={11} /> {cue.directionLabel}
            </span>
          </div>
          <p className="so-sound-desc">{cue.description}</p>
          <span className={`so-audio-state so-audio-${voice}`}>
            <VoiceIcon size={11} /> {audioUsable ? '声音正在播放' : `${VOICE_META[voice].label} · 已用视觉替代`}
          </span>
        </div>
      </div>

      {/* Subtitle — bottom safe area */}
      <div className="so-subtitle-zone">
        <AnimatePresence mode="wait">
          {subtitlesOn ? (
            <motion.div
              key={lineIndex}
              className={`so-subtitle so-speaker-${line.tone}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="so-speaker">
                <span className="so-speaker-name">{line.speakerLabel}</span>
                <span className="so-speaker-role">{TONE_LABEL[line.tone]}</span>
              </span>
              <p className="so-line">{line.text}</p>
              <span className="so-voice-pill">
                <VoiceIcon size={11} /> {VOICE_META[voice].label}
                {voice !== 'available' && <em className="so-voice-note">已改用文字反馈（mock）</em>}
              </span>
              <button ref={advanceRef} className="so-advance" onClick={advanceLine} aria-label="推进到下一句">
                <ChevronRight size={14} />
              </button>
            </motion.div>
          ) : (
            <motion.p
              key="off"
              className="so-subtitle-off"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <CaptionsOff size={13} /> 字幕已关闭 · 声音视觉替代仍然保留
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="sr-only" aria-live="assertive">
        {live}
      </div>
    </div>
  )
}
