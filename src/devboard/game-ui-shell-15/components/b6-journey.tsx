'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Anchor, Bed, Bell, ChevronRight, CircleStop, Cog, Crosshair, Gamepad2, Loader2, Pause, Play, Radio, RotateCcw, Settings2, Shield, SkipForward, Sparkles, Swords, Users, Wifi, X } from 'lucide-react'
import { BattleHud } from './battle-hud'
import { MenuTitle } from './menu-title'
import { ResidenceMain } from './residence-main'
import { TransitionBattleIntro } from './transition-battle-intro'
import { TransitionDream } from './transition-dream'
import { TransitionResult } from './transition-result'
import { DialogPortrait } from './dialog-portrait'
import { B6Settings } from './b6-settings'
import { B7MotionLayer, type B7MotionEvent, type B7Recipe } from './b7-motion'
import { INITIAL_JOURNEY, JOURNEY_ROUTES, ROUTE_LABELS, nextRoute, submitJourneyIntent, type JourneyProjection, type JourneyRoute, type OverlayId, type PortScenario } from '@/lib/b6-journey'

export function B6Journey({ scenario='accepted', externalCommand, onProjection }: { scenario?: PortScenario; externalCommand?: {type:'next'|'prev'|'restart';token:number}|null; onProjection?: (p: JourneyProjection)=>void }) {
  const [p,setP] = useState<JourneyProjection>(INITIAL_JOURNEY)
  const [settingsSource,setSettingsSource] = useState('hud')
  const [travelDirection,setTravelDirection] = useState(1)
  const autoRef = useRef<ReturnType<typeof setTimeout>|null>(null)
  const stageRef = useRef<HTMLElement|null>(null)
  const commit = useCallback((patch:Partial<JourneyProjection>)=>setP(s=>({...s,...patch,revision:s.revision+1})),[])
  const setRoute = useCallback((route:JourneyRoute, patch:Partial<JourneyProjection>={})=>{
    setP(current=>{
      setTravelDirection(JOURNEY_ROUTES.indexOf(route) >= JOURNEY_ROUTES.indexOf(current.route) ? 1 : -1)
      return {...current,route,phase:'ready',pendingIntent:null,feedback:null,...patch,revision:current.revision+1}
    })
  },[])
  useEffect(()=>onProjection?.(p),[onProjection,p])
  useEffect(()=>{ if(autoRef.current) clearTimeout(autoRef.current); if(p.route==='cold-start') autoRef.current=setTimeout(()=>setRoute('loading',{phase:'loading'}),900); if(p.route==='loading') autoRef.current=setTimeout(()=>setRoute('title'),1500); return()=>{if(autoRef.current)clearTimeout(autoRef.current)} },[p.route,setRoute])
  useEffect(()=>{if(!externalCommand)return; const i=JOURNEY_ROUTES.indexOf(p.route); if(externalCommand.type==='restart') setP(INITIAL_JOURNEY); else if(externalCommand.type==='next') setRoute(JOURNEY_ROUTES[Math.min(i+1,JOURNEY_ROUTES.length-1)]); else setRoute(JOURNEY_ROUTES[Math.max(i-1,0)])},[externalCommand])

  const act = useCallback(async(kind:string,target:JourneyRoute,patch:Partial<JourneyProjection>={})=>{
    commit({phase:'pending',pendingIntent:kind,feedback:{status:'pending',message:`提交 ${kind}`}})
    const result=await submitJourneyIntent(kind,scenario)
    if(result.status==='accepted'){setRoute(target,patch);return}
    commit({phase:result.status==='timeout'?'timeout':result.status==='stale'?'stale':'error',pendingIntent:null,feedback:{status:result.status,message:result.reason??result.status},activeOverlay:'blocking-error'})
  },[commit,scenario,setRoute])
  const openOverlay=(id:OverlayId,source='hud')=>{setSettingsSource(source);commit({activeOverlay:id})}
  const closeOverlay=()=>commit({activeOverlay:null})
  const advance=()=>void act(`route.${p.route}.continue`,nextRoute(p.route),p.route==='anchor-device'?{match:'matching'}:p.route==='matching'?{match:'complete',bedA:'lit'}:p.route==='shadow-lobby'?{bedA:'ready'}:{})
  const moveCamera = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width - .5) * 2
    const y = ((event.clientY - rect.top) / rect.height - .5) * 2
    event.currentTarget.style.setProperty('--look-x', x.toFixed(3))
    event.currentTarget.style.setProperty('--look-y', y.toFixed(3))
  }
  const recipeByRoute: Partial<Record<JourneyRoute,B7Recipe>> = {
    loading:'contour-reveal', residence:'afterglow-fade', 'anchor-device':'semantic-highlight', matching:'list-reflow',
    'shadow-lobby':'contour-reveal', 'bed-front-ready':'semantic-highlight', 'battle-intro':'flash-white',
    'enter-dream':'slow-white-curtain', 'battle-hud':'grain-vanish', result:'flash-white', reward:'afterglow-fade',
    'return-home':'slow-white-curtain', 'residence-original-position':'afterglow-fade',
  }
  const routeMotion: B7MotionEvent = { id:`route-${p.route}-${p.revision}`, semanticId:`route.${p.route}.confirmed`, recipe:recipeByRoute[p.route]??'contour-reveal', trigger:'state-transition', revision:p.revision, fallbackLevel:0 }

  return <main ref={stageRef} className={`b6-journey route-${p.route}`} aria-label="B6 完整旅程" onPointerMove={moveCamera}>
    <div className="b6-route-chip"><span>JOURNEY://{p.route.toUpperCase()}</span><i>{String(p.revision).padStart(3,'0')}</i><b className={`is-${p.phase}`}>{p.phase}</b></div>
    <AnimatePresence mode="wait"><motion.div key={p.route} className="b6-route-surface" initial={{opacity:0,x:travelDirection*28,filter:'brightness(1.7) blur(3px)'}} animate={{opacity:1,x:0,filter:'brightness(1) blur(0px)'}} exit={{opacity:0,x:travelDirection*-20,filter:'brightness(.55) blur(2px)'}} transition={{duration:.42,ease:[.22,1,.36,1]}}>
      {p.route==='cold-start' && <BootSurface/>}
      {p.route==='loading' && <LoadingSurface/>}
      {p.route==='title' && <div className="b6-title-wrap"><MenuTitle hasMockSave onNewGame={()=>void act('route.new-game','residence')} onContinue={()=>void act('route.continue','residence')} onPlayFullRun={()=>void act('route.new-game','residence')}/><button className="b6-title-settings" onClick={()=>openOverlay('settings','title')}><Settings2/>全局设置</button></div>} 
      {(p.route==='residence'||p.route==='residence-original-position') && <div className="b6-residence-wrap"><ResidenceMain spawnAt={p.route==='residence-original-position'?{x:47,y:65}:null} onEnterDream={()=>{}}/><div className="b6-world-actions"><button onClick={()=>void act('anchor.open','anchor-device',{returnOrigin:'residence:anchor-west'})}><Anchor/>接入锚定导流仪</button><button onClick={()=>openOverlay('settings','residence')}><Settings2/>设置</button></div>{p.route==='residence-original-position'&&<div className="b6-return-marker"><Radio/>已恢复至出发位置 · RESIDENCE:ANCHOR-WEST</div>}</div>}
      {p.route==='anchor-device' && <AnchorSurface pending={p.phase==='pending'} onStart={()=>void act('match.start','matching',{returnOrigin:'residence:anchor-west',match:'matching'})} onBack={()=>setRoute('residence')}/>} 
      {(p.route==='matching'||p.route==='residence-roaming') && <MatchingSurface onRoam={()=>setRoute(p.route==='matching'?'residence-roaming':'matching')} onCancel={()=>void act('match.cancel','residence',{match:'none'})} onComplete={advance}/>} 
      {p.route==='shadow-lobby' && <ShadowSurface onContinue={advance}/>} 
      {p.route==='bed-front-ready' && <BedReadySurface pending={p.phase==='pending'} onReady={()=>void act('bed.ready','battle-intro')} onCancel={()=>setRoute('residence')}/>} 
      {p.route==='battle-intro' && <TransitionBattleIntro advanceLabel="确认进入造梦" onAdvance={()=>setRoute('enter-dream')}/>} 
      {p.route==='enter-dream' && <TransitionDream mode="enter-dream" advanceLabel="确认进入对局" onAdvance={()=>setRoute('battle-hud')}/>} 
      {p.route==='battle-hud' && <div className="b6-hud-wrap"><BattleHud variant="Default"/><div className="b6-hud-tools"><button onClick={()=>openOverlay('pause')}><Pause/>暂停</button><button onClick={()=>openOverlay('narrative')}><Radio/>叙事</button><button onClick={()=>openOverlay('notification')}><Bell/>通知</button><button onClick={()=>openOverlay('settings')}><Cog/>设置</button><button onClick={()=>openOverlay('blocking-error')}><AlertTriangle/>错误</button><button className="is-result" onClick={()=>void act('battle.result','result')}><Swords/>结���演示对局</button></div></div>}
      {p.route==='result' && <TransitionResult onReturn={()=>setRoute('reward')}/>} 
      {p.route==='reward' && <RewardSurface onContinue={()=>void act('result.continue','return-home')}/>} 
      {p.route==='return-home' && <TransitionDream mode="return-home" advanceLabel="确认返回驻地原位" onAdvance={()=>setRoute('residence-original-position')}/>} 
    </motion.div></AnimatePresence>
    <B7MotionLayer event={routeMotion} profile="standard" />
    <Feedback projection={p}/><OverlayHost projection={p} scenario={scenario} settingsSource={settingsSource} close={closeOverlay} open={openOverlay} retry={()=>{closeOverlay();void act(`route.retry.${p.route}`,p.route)}}/>
  </main>
}

function BootSurface(){return <div className="b6-boot"><Gamepad2/><span>PROJECT // ECHO</span><div/><small>INITIALIZING JOURNEY PROJECTION</small></div>}
function LoadingSurface(){return <div className="b6-loading"><div className="b6-load-orbit"><Loader2/><i/><i/></div><span>恢复旅程信号</span><strong>STATEPORT / MOCK / REVISION SYNC</strong><div className="b6-loadbar"><i/></div></div>}
function AnchorSurface({pending,onStart,onBack}:{pending:boolean;onStart:()=>void;onBack:()=>void}){return <div className="b6-world b6-anchor"><div className="b6-grid"/><div className="b6-device"><span/><Anchor/><i/><i/><i/></div><section><small>RESIDENCE NODE // A-07</small><h2>锚定导流仪</h2><p>建立稳定坐标后开始竞技匹配。匹配期间驻地保持开放，可自由漫游。</p><div className="b6-mode"><Crosshair/><div><b>竞技协议</b><span>3 vs 3 · 标准回合</span></div><em>AVAILABLE</em></div><div><button onClick={onBack}>返回驻地</button><button className="is-primary" onClick={onStart} disabled={pending}>{pending?<Loader2 className="b6-spin"/>:<Wifi/>}{pending?'等待端口确认…':'启动匹配'}</button></div></section></div>}
function MatchingSurface({onRoam,onCancel,onComplete}:{onRoam:()=>void;onCancel:()=>void;onComplete:()=>void}){return <div className="b6-world b6-matching"><div className="b6-pixel-room"/><div className="b6-match-edge"><div className="b6-radar"><i/><i/><i/><span/></div><section><small>ANCHOR LINK ACTIVE</small><h2>正在寻找同频信号</h2><p>02 / 06 · 驻地输入保持开放</p><div className="b6-match-pips">{Array.from({length:6}).map((_,i)=><i key={i} className={i<2?'on':''}/>)}</div></section><button onClick={onCancel}><X/>取消</button></div><div className="b6-roam-actions"><button onClick={onRoam}><Gamepad2/>切换漫游视角</button><button className="is-primary" onClick={onComplete}><SkipForward/>模拟匹配完成</button></div></div>}
function ShadowSurface({onContinue}:{onContinue:()=>void}){return <div className="b6-world b6-shadow"><div className="b6-pixel-room"/><div className="b6-shadow-party">{[0,1,2].map(i=><motion.div key={i} className="b6-shadow-unit" initial={{opacity:0,scale:.7}} animate={{opacity:[.2,.75,.45],scale:1}} transition={{delay:i*.18,duration:1.5,repeat:Infinity}}><Users/><span>RELAY // 0{i+1}</span></motion.div>)}</div><div className="b6-bed-lit"><Bed/><span>床 A 已点亮</span></div><div className="b6-scene-caption"><small>MATCH COMPLETE</small><h2>影子大厅已叠加</h2><p>队友中继影像已投射至原驻地。没有独立大厅载入。</p><button onClick={onContinue}>前往床 A <ChevronRight/></button></div></div>}
function BedReadySurface({pending,onReady,onCancel}:{pending:boolean;onReady:()=>void;onCancel:()=>void}){return <div className="b6-world b6-bed-ready"><div className="b6-pixel-room"/><motion.div className="b6-bed-entity" animate={{filter:['brightness(1)','brightness(1.35)','brightness(1)']}} transition={{duration:2,repeat:Infinity}}><Bed/><span>BED // A</span><i/></motion.div><section><small>COMPETITIVE DIVE GATE</small><h2>坐标锁定 · 床 A</h2><p>床 B：后置功能，暂不可用。床 C：仅自测。当前只有床 A 可以正式入局。</p><div><button onClick={onCancel}>取消</button><button className="is-primary" onClick={onReady} disabled={pending}>{pending?<Loader2 className="b6-spin"/>:<Play/>}{pending?'装载请求中…':'确认进入梦境'}</button></div></section></div>}
function RewardSurface({onContinue}:{onContinue:()=>void}){return <div className="b6-reward"><div className="b6-reward-rays"/><motion.div className="b6-medal" initial={{scale:.5,rotate:-20,opacity:0}} animate={{scale:1,rotate:0,opacity:1}}><Shield/><i/></motion.div><small>REWARD PROJECTION // CONFIRMED</small><h2>中继信标 · VII</h2><p>完成第七区首次稳定潜入</p><div className="b6-reward-line"><span>信用点 <b>+240</b></span><span>共鸣结晶 <b>+3</b></span></div><button onClick={onContinue}>确认并返回驻地 <ChevronRight/></button></div>}
function Feedback({projection:p}:{projection:JourneyProjection}){if(!p.feedback)return null;return <motion.div className={`b6-feedback is-${p.feedback.status}`} role="status" aria-live="polite" initial={{opacity:0,x:20}} animate={{opacity:1,x:0}}><Radio/><div><b>{p.feedback.status.toUpperCase()}</b><span>{p.feedback.message}</span></div></motion.div>}
function OverlayHost({projection:p,scenario,settingsSource,close,open,retry}:{projection:JourneyProjection;scenario:PortScenario;settingsSource:string;close:()=>void;open:(id:OverlayId,source?:string)=>void;retry:()=>void}){const id=p.activeOverlay;useEffect(()=>{const fn=(e:KeyboardEvent)=>{if(e.key==='Escape'&&id&&id!=='blocking-error')close()};window.addEventListener('keydown',fn);return()=>window.removeEventListener('keydown',fn)},[close,id]);if(!id)return null;return <AnimatePresence><div className={`b6-overlay b6-overlay-${id}`}><div className="b6-overlay-scrim"/>{id==='settings'?<B6Settings source={settingsSource} scenario={scenario} onClose={close} onSave={async()=>{const r=await submitJourneyIntent('settings.save',scenario);if(r.status==='accepted')close()}}/>:id==='narrative'?<div className="b6-narrative"><DialogPortrait connected onComplete={close}/></div>:id==='notification'?<motion.div className="b6-notification" initial={{x:80,opacity:0}} animate={{x:0,opacity:1}}><Bell/><div><small>ANCHOR NETWORK</small><b>新的中继信号已归档</b><span>第七区 · 低优先级通知，不抢占输入</span></div><button onClick={close}><X/></button></motion.div>:id==='pause'?<motion.section className="b6-pause" role="dialog" aria-modal="true" initial={{opacity:0,x:-30}} animate={{opacity:1,x:0}}><small>SYS://PAUSE.PROTOCOL</small><h2>旅程暂停</h2><p>世界暂停策略由宿主控制。当前演示保留投影，不修改对局事实。</p><button autoFocus onClick={close}><Play/>继续</button><button onClick={()=>open('settings','pause')}><Settings2/>设置</button><button onClick={()=>open('blocking-error')}><CircleStop/>安全返回测试</button></motion.section>:<motion.section className="b6-error" role="alertdialog" aria-modal="true" initial={{opacity:0,scale:.96}} animate={{opacity:1,scale:1}}><AlertTriangle/><small>BLOCKING // {p.phase.toUpperCase()}</small><h2>{p.phase==='ready'?'模拟连接中断':p.feedback?.message??'旅程投影不可用'}</h2><p>已冻结低优先级输入。当前 route 与返回原点保持不变。</p><div><button autoFocus onClick={retry}><RotateCcw/>重试当前节点</button><button onClick={()=>{close()}}><Shield/>安全关闭</button></div></motion.section>}</div></AnimatePresence>}
