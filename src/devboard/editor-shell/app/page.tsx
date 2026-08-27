import { TopBar } from '@/components/editor/top-bar'
import { LeftPanel } from '@/components/editor/left-panel'
import { Canvas } from '@/components/editor/canvas'
import { RightPanel } from '@/components/editor/right-panel'
import { DiagnosticsBar } from '@/components/editor/diagnostics-bar'
import { ScreenFx } from '@/components/editor/fx'
import { GameCursor } from '@/components/editor/game-cursor'
import { GameContextMenu } from '@/components/editor/game-context-menu'
import { BootSequence } from '@/components/editor/boot-sequence'
import { KeyboardShortcuts, ToastLayer } from '@/components/editor/global-controls'
import { AssetLibrary } from '@/components/library/asset-library'
import { ResearchBench } from '@/components/bench/research-bench'
import { PixelPainter } from '@/components/painter/pixel-painter-connector'
import { MetaStateProvider } from '@/components/meta-state-provider'

export default function Page() {
  return (
    <MetaStateProvider>
      <main className="relative flex h-screen w-full flex-col overflow-hidden bg-background text-foreground select-none">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {/* left + center + diagnostics */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <LeftPanel />
            <Canvas />
          </div>
          <DiagnosticsBar />
        </div>
        {/* right inspector spans full height */}
        <RightPanel />
      </div>
      <ScreenFx />
      <GameCursor />
      <GameContextMenu />
      <KeyboardShortcuts />
      <ToastLayer />
      <BootSequence />
      <AssetLibrary />
      <ResearchBench />
      <PixelPainter />
      </main>
    </MetaStateProvider>
  )
}
