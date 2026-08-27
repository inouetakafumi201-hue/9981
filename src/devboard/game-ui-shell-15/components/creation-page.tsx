'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import EditorPage from '@editor/app/page'
import { openLibrary } from '@editor/lib/library-store'
import { openBench } from '@editor/lib/bench-store'
import {
  completeCreationVisit,
  readCreationVisit,
  switchCreationHref,
  type CreationTool,
} from '@/lib/creation-navigation'

interface CreationPageProps { tool: CreationTool }

export function CreationPage({ tool }: CreationPageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const visit = readCreationVisit(tool, new URLSearchParams(searchParams.toString()))

  useEffect(() => {
    if (tool === 'asset-library') openLibrary()
    if (tool === 'research-bench') {
      openLibrary()
      openBench()
    }
  }, [tool])

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ tool: CreationTool }>).detail
      if (detail?.tool) router.push(switchCreationHref(detail.tool, visit))
    }
    const onExit = () => router.push(completeCreationVisit(visit))
    window.addEventListener('creation:navigate', onNavigate)
    window.addEventListener('creation:exit', onExit)
    return () => {
      window.removeEventListener('creation:navigate', onNavigate)
      window.removeEventListener('creation:exit', onExit)
    }
  }, [router, visit.entryId, visit.entryTool, visit.returnTo])

  return <div className="creation-page-transition"><EditorPage /></div>
}
