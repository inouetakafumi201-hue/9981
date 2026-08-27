import { TopBar } from '@editor/components/editor/top-bar'
import { LeftPanel } from '@editor/components/editor/left-panel'
import { Canvas } from '@editor/components/editor/canvas'
import { RightPanel } from '@editor/components/editor/right-panel'
import { DiagnosticsBar } from '@editor/components/editor/diagnostics-bar'
import { ScreenFx } from '@editor/components/editor/fx'
import { GameCursor } from '@editor/components/editor/game-cursor'
import { GameContextMenu } from '@editor/components/editor/game-context-menu'
import { BootSequence } from '@editor/components/editor/boot-sequence'
import { KeyboardShortcuts, ToastLayer } from '@editor/components/editor/global-controls'
import { AssetLibrary } from '@editor/components/library/asset-library'
import { ResearchBench } from '@editor/components/bench/research-bench'
import { PixelPainter } from '@editor/components/painter/pixel-painter-connector'
import { MetaStateProvider } from '@editor/components/meta-state-provider'

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
