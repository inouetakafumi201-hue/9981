'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Crosshair, Flag, MapPin, MousePointer2, RotateCcw, Shield, Sparkles, Target } from 'lucide-react'

export function MapScene({ playing }: { playing: boolean }) {
  const [selected, setSelected] = useState('safehouse')
  const nodes = [
    { id: 'safehouse', label: 'SAFE HOUSE', x: 22, y: 64, status: 'ANCHOR' },
    { id: 'signal', label: 'SIGNAL WELL', x: 51, y: 28, status: 'UNSTABLE' },
    { id: 'archive', label: 'ARCHIVE 07', x: 78, y: 58, status: 'LOCKED' },
  ]
  return <section className={`standalone-scene map-scene ${playing ? 'is-playing' : ''}`} aria-label="Sector 07 map demo">
    <div className="standalone-heading"><div><span className="kicker">SECTOR 07 / ROUTE MEMORY</span><h1>Every route leaves a trace.</h1></div><span className="standalone-live"><span />{playing ? 'ROUTE SCAN' : 'MAP READY'}</span></div>
    <div className="map-canvas">
      <div className="map-grid" aria-hidden="true" />
      <svg className="map-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M22 64 C31 55 39 42 51 28 S68 45 78 58" /><path className="map-route-pulse" d="M22 64 C31 55 39 42 51 28 S68 45 78 58" /></svg>
      {nodes.map((node) => <button key={node.id} className={`map-node ${selected === node.id ? 'is-selected' : ''}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} onClick={() => setSelected(node.id)} aria-label={`Select ${node.label}`}><span className="map-node-dot"><MapPin size={13} /></span><b>{node.label}</b><small>{node.status}</small></button>)}
      <div className="map-crosshair" aria-hidden="true"><Crosshair size={22} /></div>
    </div>
    <div className="standalone-footer"><span>SELECTED // {nodes.find((node) => node.id === selected)?.label}</span><button onClick={() => setSelected('safehouse')}><RotateCcw size={12} /> RESET ROUTE</button></div>
  </section>
}

export function ClickPlayScene({ playing, onPlayingChange }: { playing: boolean; onPlayingChange: (value: boolean) => void }) {
  const [count, setCount] = useState(0)
  const [pulse, setPulse] = useState(false)
  useEffect(() => { if (!playing) return; setPulse(true); const timer = window.setTimeout(() => setPulse(false), 420); return () => window.clearTimeout(timer) }, [playing])
  const reset = () => { setCount(0); onPlayingChange(false); setPulse(false) }
  return <section className={`standalone-scene click-scene ${pulse ? 'is-pulsing' : ''}`} aria-label="Click play feedback demo">
    <div className="standalone-heading"><div><span className="kicker">INPUT RESPONSE / SINGLE ACTION</span><h1>Every action has a pulse.</h1></div><span className="standalone-live"><span />{count ? `${count} INPUTS` : 'INPUT READY'}</span></div>
    <button className="click-target" onClick={() => { setCount((value) => value + 1); onPlayingChange(true) }} aria-label="Trigger tactile input pulse"><span className="click-rings" aria-hidden="true" /><MousePointer2 size={25} /><b>CLICK / PLAY</b><small>TRIGGER INPUT PULSE</small></button>
    <div className="standalone-footer"><span>FEEDBACK // {pulse ? 'ACTIVE' : 'IDLE'}</span><button onClick={reset}><RotateCcw size={12} /> RESET INPUT</button></div>
  </section>
}

export function CombatFeedbackScene({ playing, onPlayingChange }: { playing: boolean; onPlayingChange: (value: boolean) => void }) {
  const [hits, setHits] = useState(0)
  const [impact, setImpact] = useState(false)
  useEffect(() => { if (!playing) return; setImpact(true); const timer = window.setTimeout(() => setImpact(false), 520); return () => window.clearTimeout(timer) }, [playing])
  const strike = () => { setHits((value) => value + 1); onPlayingChange(true) }
  return <section className={`standalone-scene combat-scene ${impact ? 'is-impact' : ''}`} aria-label="Combat feedback demo">
    <div className="standalone-heading"><div><span className="kicker">CONTACT / HIT CONFIRMATION</span><h1>Impact is information.</h1></div><span className="standalone-live"><span />{hits ? `${hits} CONFIRMED` : 'TARGET LOCKED'}</span></div>
    <div className="combat-stage"><div className="combat-target"><Shield size={42} strokeWidth={1} /><span>HOSTILE SIGNAL</span></div>{impact && <motion.div className="impact-burst" initial={{ scale: .45, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}><Target size={26} /><b>IMPACT</b><strong>+148</strong></motion.div>}<div className="combat-crosshair" aria-hidden="true"><Crosshair size={30} /></div></div>
    <div className="standalone-footer"><span>DAMAGE // {hits ? '148' : '—'}</span><button onClick={strike}><Sparkles size={12} /> {impact ? 'CONFIRMED' : 'TRIGGER HIT'}</button></div>
  </section>
}

export function VictoryScene({ playing, onPlayingChange }: { playing: boolean; onPlayingChange: (value: boolean) => void }) {
  const [revealed, setRevealed] = useState(playing)
  useEffect(() => { if (playing) setRevealed(true) }, [playing])
  const reset = () => { setRevealed(false); onPlayingChange(false) }
  return <section className={`standalone-scene victory-scene ${revealed ? 'is-revealed' : ''}`} aria-label="Victory feedback demo">
    <div className="standalone-heading"><div><span className="kicker">OBJECTIVE COMPLETE / RESULT</span><h1>You made it through.</h1></div><span className="standalone-live"><span />{revealed ? 'SEALED' : 'AWAITING RESULT'}</span></div>
    <div className="victory-stage"><AnimatePresence>{revealed && <motion.div className="victory-emblem" initial={{ scale: .5, opacity: 0, rotate: -12 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 180, damping: 16 }}><Flag size={30} /><b>SECTOR CLEARED</b><small>RETURN WITH WHAT YOU FOUND</small></motion.div>}</AnimatePresence>{!revealed && <button className="victory-trigger" onClick={() => { setRevealed(true); onPlayingChange(true) }}>REVEAL RESULT</button>}</div>
    <div className="standalone-footer"><span>RESULT // {revealed ? 'COMPLETE' : 'PENDING'}</span><button onClick={reset}><RotateCcw size={12} /> RESET RESULT</button></div>
  </section>
}
