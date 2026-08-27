'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Accessibility, Check, Gamepad2, Languages, Monitor, SlidersHorizontal, Volume2, X } from 'lucide-react'
import type { PortScenario } from '@/lib/b6-journey'

const CATEGORIES = [
  { id: 'display', label: '显示', icon: Monitor }, { id: 'audio', label: '声音', icon: Volume2 },
  { id: 'input', label: '输入', icon: Gamepad2 }, { id: 'accessibility', label: '无障碍', icon: Accessibility },
  { id: 'system', label: '语言 / 图形', icon: Languages },
] as const

type Category = typeof CATEGORIES[number]['id']

export function B6Settings({ source, scenario, onClose, onSave }: { source: string; scenario: PortScenario; onClose: () => void; onSave: () => Promise<void> }) {
  const [category, setCategory] = useState<Category>('display')
  const [brightness, setBrightness] = useState(78)
  const [master, setMaster] = useState(72)
  const [reduced, setReduced] = useState(false)
  const [subtitles, setSubtitles] = useState(true)
  const [saving, setSaving] = useState(false)
  return <motion.section className="b6-settings" role="dialog" aria-modal="true" aria-labelledby="b6-settings-title" initial={{ opacity: 0, x: 42 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 42 }}>
    <header><div><span>SYS://GLOBAL.CONFIG</span><h2 id="b6-settings-title">全局设置</h2><small>来源 {source.toUpperCase()} · MOCK PROJECTION</small></div><button onClick={onClose} aria-label="关闭设置"><X /></button></header>
    <div className="b6-settings-body"><nav aria-label="设置分类">{CATEGORIES.map(({id,label,icon:Icon}) => <button key={id} onClick={() => setCategory(id)} className={category===id?'is-active':''}><Icon size={15}/><span>{label}</span></button>)}</nav>
      <motion.div key={category} className="b6-setting-fields" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}>
        {category==='display' && <><SettingRange label="场景亮度" value={brightness} onChange={setBrightness}/><SettingRange label="界面比例" value={92} onChange={()=>{}}/><SettingToggle label="扫描线材质" value onChange={()=>{}}/></>}
        {category==='audio' && <><SettingRange label="主音量" value={master} onChange={setMaster}/><SettingRange label="语音" value={84} onChange={()=>{}}/><SettingToggle label="字幕" value={subtitles} onChange={setSubtitles}/></>}
        {category==='input' && <><SettingKey label="确认 / 交互" value="ENTER / A"/><SettingKey label="取消 / 返回" value="ESC / B"/><SettingToggle label="启用手柄" value onChange={()=>{}}/></>}
        {category==='accessibility' && <><SettingToggle label="减少动态效果" value={reduced} onChange={setReduced}/><SettingToggle label="详细字幕" value={subtitles} onChange={setSubtitles}/><SettingRange label="文字比例" value={100} onChange={()=>{}}/></>}
        {category==='system' && <><SettingKey label="语言" value="简体中文"/><SettingKey label="图形质量" value="高"/><SettingToggle label="粒子效果" value={!reduced} onChange={()=>{}}/></>}
        <p className="b6-preview-note"><SlidersHorizontal size={13}/> 所有变更仅为预览，保存经 ActionPort 确认后生效。</p>
      </motion.div>
    </div>
    <footer><button onClick={onClose}>取消</button><button className="is-primary" disabled={saving} onClick={async()=>{setSaving(true);await onSave();setSaving(false)}}>{saving?<span className="b6-spinner"/>:<Check size={14}/>} {saving?'等待端口确认…':`保存设置 · ${scenario}`}</button></footer>
  </motion.section>
}
function SettingRange({label,value,onChange}:{label:string;value:number;onChange:(n:number)=>void}) { return <label className="b6-setting-row"><span>{label}<b>{value}%</b></span><input type="range" min="0" max="100" value={value} onChange={e=>onChange(Number(e.target.value))}/></label> }
function SettingToggle({label,value,onChange}:{label:string;value:boolean;onChange:(v:boolean)=>void}) { return <button className="b6-setting-row b6-toggle" onClick={()=>onChange(!value)} aria-pressed={value}><span>{label}</span><i className={value?'is-on':''}><u/></i><b>{value?'开启':'关闭'}</b></button> }
function SettingKey({label,value}:{label:string;value:string}) { return <div className="b6-setting-row b6-key"><span>{label}</span><kbd>{value}</kbd></div> }
