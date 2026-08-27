'use client'

import { useEffect, type ReactNode } from 'react'
import { createDemoMetaStateStore } from '../../../meta-state/demo-fixture'
import { bindMetaStateShell } from '../../wiring/meta-state-shell-binding'

const store = createDemoMetaStateStore()

export function MetaStateProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const binding = bindMetaStateShell(store)
    return () => binding.unbind()
  }, [])
  return <>{children}</>
}
