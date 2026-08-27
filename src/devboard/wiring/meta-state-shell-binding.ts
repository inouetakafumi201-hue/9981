import type { MetaStateStore } from '../../meta-state/store'
import { createMetaStateActions } from '../../meta-state/actions/facade'
import { bindMetaStateActions, unbindMetaStateActions } from '../editor-shell/lib/library-store'
import { bindMetaStateBench, unbindMetaStateBench } from '../editor-shell/lib/bench-store'

export interface MetaStateShellBinding {
  readonly revision: () => number
  unbind(): void
}

export function bindMetaStateShell(store: MetaStateStore): MetaStateShellBinding {
  const actions = createMetaStateActions(store)
  bindMetaStateActions(actions, store.getState().revision)
  bindMetaStateBench(store)
  return {
    revision: () => store.getState().revision,
    unbind() {
      unbindMetaStateActions()
      unbindMetaStateBench()
    },
  }
}
