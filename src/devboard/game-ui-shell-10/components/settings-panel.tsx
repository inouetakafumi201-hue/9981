'use client'

import { useRef, useState } from 'react'
import { Tabs } from '@base-ui/react/tabs'
import { Slider } from '@base-ui/react/slider'
import { AnimatePresence, motion } from 'framer-motion'
import { Accessibility, AlertTriangle, Check, Gamepad2, Languages, Loader2, Monitor, RotateCcw, Save, Sparkles, Volume2, X } from 'lucide-react'
import { createIntent, submitIntent, B1_SETTINGS, type B1SettingId } from '@/lib/b1-contract'
import { useFocusScope } from '@/lib/use-focus-scope'

const LABELS: Record<B1SettingId, string> = { display: '显示', sound: '声音', input: '输入', accessibility: '无障碍', language: '语言', graphics: '图形' }
const ICONS = { display: Monitor, sound: Volume2, input: Gamepad2, accessibility: Accessibility, language: Languages, graphics: Sparkles }

type SettingsValues = {
  displayScale: number
  fullscreen: boolean
  masterVolume: number
  musicVolume: number
  effectsVolume: number
  voiceVolume: number
  uiVolume: number
  reducedMotion: boolean
  subtitles: boolean
  highContrast: boolean
  language: string
  quality: string
}

const DEFAULTS: SettingsValues = {
  displayScale: 100,
  fullscreen: true,
  masterVolume: 80,
  musicVolume: 70,
  effectsVolume: 80,
  voiceVolume: 90,
  uiVolume: 60,
  reducedMotion: false,
  subtitles: true,
  highContrast: false,
  language: '简体中文',
  quality: 'Balanced',
}

const KEYBINDS = [
  { action: '确认', key: 'Enter' },
  { action: '取消', key: 'Esc' },
  { action: '移动', key: 'WASD' },
  { action: '交互', key: 'F' },
]

type SaveState = 'idle' | 'saving' | 'accepted' | 'rejected' | 'timeout'
type RestoreState = 'idle' | 'confirm' | 'pending' | 'rejected'

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [section, setSection] = useState<B1SettingId>('display')
  const [draft, setDraft] = useState<SettingsValues>({ ...DEFAULTS })
  const [saved, setSaved] = useState<SettingsValues>({ ...DEFAULTS })
  const [previewField, setPreviewField] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveReason, setSaveReason] = useState<string | undefined>()
  const [restore, setRestore] = useState<RestoreState>('idle')
  const [liveMessage, setLiveMessage] = useState('设置投影已就绪（mock）')

  useFocusScope(panelRef, onClose)

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  // Every field edit is its own preview intent — the visual value updates
  // optimistically, but a rejected preview reverts just that one field.
  async function previewField_<K extends keyof SettingsValues>(key: K, value: SettingsValues[K], demoFailure?: 'rejected' | 'timeout') {
    const prev = draft[key]
    setDraft((d) => ({ ...d, [key]: value }))
    setPreviewField(key)
    const result = await submitIntent(createIntent('settings.preview', { section, field: key, demoFailure: demoFailure ?? '' }))
    setPreviewField(null)
    if (result.status !== 'accepted') {
      setDraft((d) => ({ ...d, [key]: prev }))
      setLiveMessage(`预览被拒绝：${result.reason ?? 'MOCK_REJECTED'}，已还原该项`)
    }
  }

  async function save(demoFailure?: 'rejected' | 'timeout') {
    setSaveState('saving')
    setSaveReason(undefined)
    const result = await submitIntent(createIntent('settings.save', { section, demoFailure: demoFailure ?? '' }, 'menu-title'))
    if (result.status === 'accepted') {
      setSaved(draft)
      setSaveState('accepted')
      setLiveMessage('设置已保存（mock projection · accepted）')
      window.setTimeout(() => setSaveState('idle'), 1600)
      return
    }
    // 保存失败绝不丢弃当前编辑值，只呈现原因与重试/取消。
    setSaveState(result.status === 'timeout' ? 'timeout' : 'rejected')
    setSaveReason(result.reason)
    setLiveMessage(`保存失败：${result.reason ?? result.status}`)
  }

  function cancelDraft() {
    setDraft(saved)
    setSaveState('idle')
    setSaveReason(undefined)
    setLiveMessage('已取消草稿，返回已保存快照')
  }

  async function confirmRestore() {
    setRestore('pending')
    const result = await submitIntent(createIntent('settings.restore-defaults', {}))
    if (result.status === 'accepted') {
      setDraft({ ...DEFAULTS })
      setRestore('idle')
      setLiveMessage('默认值已写入草稿，保存后才会确认')
      return
    }
    setRestore('rejected')
    setLiveMessage(`恢复默认失败：${result.reason ?? result.status}`)
  }

  const Icon = ICONS[section]

  return (
    <div className="sp-scrim" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div ref={panelRef} tabIndex={-1} className="sp-panel b1-settings">
        <div className="sp-header">
          <div>
            <span className="sp-kicker">CONFIGURATION <span className="mock-tag">MOCK / UI-ONLY</span></span>
            <h2 id="settings-title">系统设置</h2>
          </div>
          <button className="sp-close" aria-label="关闭设置" onClick={onClose}><X size={16} /></button>
        </div>

        <Tabs.Root value={section} onValueChange={(v) => setSection(v as B1SettingId)} className="b1-settings-layout">
          <Tabs.List className="b1-settings-nav" aria-label="设置分类">
            {B1_SETTINGS.map((id) => {
              const TabIcon = ICONS[id]
              return (
                <Tabs.Tab key={id} value={id} className={section === id ? 'is-active' : ''}>
                  <TabIcon size={14} />{LABELS[id]}
                </Tabs.Tab>
              )
            })}
            <Tabs.Indicator className="b1-settings-tab-indicator" />
          </Tabs.List>

          {B1_SETTINGS.map((id) => (
            <Tabs.Panel key={id} value={id} className="b1-settings-body" keepMounted={false}>
              <div className="b1-section-heading">
                <Icon size={18} />
                <div><strong>{LABELS[id]}</strong><span>categoryId: settings-{id}</span></div>
              </div>
              <p className="sp-field-desc">当前值只存在于本地 draft；没有真实持久化。</p>

              {id === 'display' && (
                <>
                  <RangeField label="界面缩放" unit="%" value={draft.displayScale} min={80} max={140} step={5} busy={previewField === 'displayScale'} onCommit={(v) => previewField_('displayScale', v)} />
                  <ToggleField label="全屏模式" checked={draft.fullscreen} busy={previewField === 'fullscreen'} onChange={(v) => previewField_('fullscreen', v)} />
                </>
              )}

              {id === 'sound' && (
                <>
                  <RangeField label="主音量" unit="%" value={draft.masterVolume} min={0} max={100} step={5} busy={previewField === 'masterVolume'} onCommit={(v) => previewField_('masterVolume', v)} />
                  <RangeField label="音乐音量" unit="%" value={draft.musicVolume} min={0} max={100} step={5} busy={previewField === 'musicVolume'} onCommit={(v) => previewField_('musicVolume', v)} />
                  <RangeField label="音效音量" unit="%" value={draft.effectsVolume} min={0} max={100} step={5} busy={previewField === 'effectsVolume'} onCommit={(v) => previewField_('effectsVolume', v)} />
                  <RangeField label="语音音量" unit="%" value={draft.voiceVolume} min={0} max={100} step={5} busy={previewField === 'voiceVolume'} onCommit={(v) => previewField_('voiceVolume', v)} />
                  <RangeField label="界面音效" unit="%" value={draft.uiVolume} min={0} max={100} step={5} busy={previewField === 'uiVolume'} onCommit={(v) => previewField_('uiVolume', v)} />
                </>
              )}

              {id === 'input' && (
                <div className="sp-keybind-list">
                  {KEYBINDS.map((row) => (
                    <div key={row.action} className="sp-keybind-row">
                      <span>{row.action}</span>
                      <kbd>{row.key}</kbd>
                    </div>
                  ))}
                  <p className="sp-field-desc">键位重绑定为 mock 占位，未接入真实输入映射。</p>
                </div>
              )}

              {id === 'accessibility' && (
                <>
                  <ToggleField label="减少动画（reduced motion）" checked={draft.reducedMotion} busy={previewField === 'reducedMotion'} onChange={(v) => previewField_('reducedMotion', v)} />
                  <ToggleField label="字幕" checked={draft.subtitles} busy={previewField === 'subtitles'} onChange={(v) => previewField_('subtitles', v)} />
                  <ToggleField label="高对比度" checked={draft.highContrast} busy={previewField === 'highContrast'} onChange={(v) => previewField_('highContrast', v)} />
                </>
              )}

              {id === 'graphics' && (
                <SettingSelect label="质量预设" value={draft.quality} options={['Low', 'Balanced', 'High']} onChange={(v) => previewField_('quality', v)} />
              )}

              {id === 'language' && (
                <SettingSelect label="界面语言" value={draft.language} options={['简体中文', 'English', '日本語']} onChange={(v) => previewField_('language', v)} />
              )}
            </Tabs.Panel>
          ))}
        </Tabs.Root>

        <div className="b1-settings-feedback" role="status" aria-live="polite">{liveMessage}</div>

        <AnimatePresence>
          {restore !== 'idle' && (
            <motion.div className="sp-restore-confirm" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              {restore === 'confirm' && (
                <>
                  <span><AlertTriangle size={13} /> 确认将全部分类恢复默认？当前草稿会被覆盖。</span>
                  <div className="sp-restore-actions">
                    <button className="is-danger" onClick={() => void confirmRestore()}><Check size={13} /> 确认恢复</button>
                    <button onClick={() => setRestore('idle')}><X size={13} /> 取消</button>
                  </div>
                </>
              )}
              {restore === 'pending' && <span><Loader2 size={13} className="sp-spin" /> 正在提交恢复默认 intent…</span>}
              {restore === 'rejected' && (
                <>
                  <span className="is-error"><AlertTriangle size={13} /> 恢复默认失败</span>
                  <div className="sp-restore-actions">
                    <button onClick={() => void confirmRestore()}><RotateCcw size={13} /> 重试</button>
                    <button onClick={() => setRestore('idle')}><X size={13} /> 关闭</button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {(saveState === 'rejected' || saveState === 'timeout') && (
          <div className="sp-save-error" role="alert">
            <AlertTriangle size={13} />
            <span>{saveState === 'timeout' ? `请求超时：${saveReason ?? 'MOCK_TIMEOUT'}` : `保存被拒绝：${saveReason ?? 'MOCK_REJECTED'}`} —— 编辑值已保留。</span>
            <button onClick={() => void save()}>重试</button>
          </div>
        )}

        <div className="b1-settings-footer">
          <button onClick={() => setRestore('confirm')} disabled={saveState === 'saving'}><RotateCcw size={14} />恢复默认</button>
          <button onClick={cancelDraft} disabled={saveState === 'saving' || !dirty}>取消草稿</button>
          <button
            className={`is-primary ${saveState === 'accepted' ? 'is-success' : ''}`}
            onClick={() => void save()}
            disabled={saveState === 'saving' || !dirty}
          >
            {saveState === 'saving' ? <Loader2 size={14} className="sp-spin" /> : saveState === 'accepted' ? <Check size={14} /> : <Save size={14} />}
            {saveState === 'saving' ? '保存中…' : saveState === 'accepted' ? '已保存' : `保存${dirty ? '' : '（无修改）'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function RangeField({ label, value, min, max, step, unit, busy, onCommit }: { label: string; value: number; min: number; max: number; step: number; unit: string; busy: boolean; onCommit: (value: number) => void }) {
  return (
    <Slider.Root className="sp-slider-field" value={[value]} min={min} max={max} step={step} onValueCommitted={(v) => onCommit(Array.isArray(v) ? v[0] : v)}>
      <div className="sp-slider-head">
        <span className="sp-field-label">{label}</span>
        <span className="sp-slider-value">{value}{unit}{busy && <Loader2 size={11} className="sp-spin" />}</span>
      </div>
      <Slider.Control className="sp-slider-control">
        <Slider.Track className="sp-slider-track">
          <Slider.Indicator className="sp-slider-indicator" />
          <Slider.Thumb className="sp-slider-thumb" />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  )
}

function ToggleField({ label, checked, busy, onChange }: { label: string; checked: boolean; busy: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`sp-toggle-field ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="sp-field-label">{label}</span>
      <span className="sp-toggle-track"><span className="sp-toggle-thumb" /></span>
      <span className="sp-toggle-state">{busy ? <Loader2 size={11} className="sp-spin" /> : checked ? '开启' : '关闭'}</span>
    </button>
  )
}

function SettingSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="sp-field sp-select-field">
      <span className="sp-field-label">{label}</span>
      <select className="sp-select-trigger" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  )
}
