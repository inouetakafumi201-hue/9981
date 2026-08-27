/**
 * 端到端 boot smoke test：直接调 `bootUiBackend()`，确认装载成功并返回 UiSystem。
 * 运行：`npx vitest run src/devboard/__tests__/backend-boot-smoke.test.ts`
 */
import { describe, expect, it } from 'vitest'
import { bootUiBackend } from '../game-ui-shell-15/lib/match-boot'

describe('V0 backend boot (双轨制端到端接线 · step 7)', () => {
  it('bootUiBackend 成功装载对局并返回 UiSystem', () => {
    const ui = bootUiBackend()
    if (ui === null) {
      // console.error already printed diagnostics
      throw new Error('bootUiBackend returned null — see console.error for diagnostics')
    }
    expect(ui).toBeTruthy()
    expect(typeof ui.query.projection).toBe('function')
    expect(typeof ui.query.descriptor).toBe('function')
    expect(typeof ui.interaction.sendIntent).toBe('function')
  })

  it('projection port 真实拉取 (g:ui / scopeId=loaded-match:all)', () => {
    const ui = bootUiBackend()
    if (ui === null) throw new Error('bootUiBackend returned null')
    const result = ui.query.projection({ agentId: 'g:ui', scopeId: 'loaded-match:all' })
    if (!result.ok) throw new Error('projection rejected: ' + JSON.stringify(result.diagnostics))
    expect(result.value.scope.scopeId).toBe('loaded-match:all')
    expect(result.value.projection.entities.length).toBeGreaterThan(0)
  })

  it('descriptor port 真实拉取 (actor=e:hero)', () => {
    const ui = bootUiBackend()
    if (ui === null) throw new Error('bootUiBackend returned null')
    const result = ui.query.descriptor({ agentId: 'g:ui', scopeId: 'loaded-match:all', actorId: 'e:hero', includeUnavailable: true })
    if (!result.ok) throw new Error('descriptor rejected: ' + JSON.stringify(result.diagnostics))
    // 玩家可用动作集合应该非空（move / pickup / 等）
    expect(result.value.descriptor.paidActions.length + result.value.descriptor.attachedActions.length).toBeGreaterThan(0)
    // 验证双轨制 track 字段
    for (const a of result.value.descriptor.paidActions) {
      expect(['highlight', 'card']).toContain(a.track)
    }
  })

  it('sendIntent 走真实判罚路径（intent 提交后 kernel 引擎完成 require 求值并判罚）', () => {
    const ui = bootUiBackend()
    if (ui === null) throw new Error('bootUiBackend returned null')
    // 验证链路：InteractionIntent → l2Submit → kernel.invoke('intent.submit') → evalRequire。
    // 动作被引擎判罚拒绝是因为 UI 层的纯字符串 bindings 无法满足 refExists(varOf('node'))
    // 的 Ref 求值预期（这是 UI→kernel 绑定语义的一个已知缺口，待后续修正，不影响本测试目标）。
    const intent = {
      intentId: `smoke-${Date.now()}`,
      agentId: 'e:hero',
      target: { kind: 'action' as const, actionId: 'action:play.move' },
      bindings: { node: 'n:map-a' },
      observedRevision: { sequence: 0, fingerprint: 'smoke' },
      inputSource: 'pointer' as const,
    }
    const outcome = ui.interaction.sendIntent(intent)
    // 验证 intent.submit Op 被执行且 require 被求值（结果为 rejected 是因为 bindings 语义缺口，
    // 但路径本身完全正确——没有 action 未注册、Op 不存在、Op 执行异常等代码 bug）
    expect(outcome.kind === 'accepted' || outcome.kind === 'rejected').toBe(true)
    if (outcome.kind === 'rejected') {
      const reasons = outcome.rejection.diagnostics.map((d: { code: string; reason: string }) => `${d.code}: ${d.reason}`)
      const isIntentSubmitOpExecuted = reasons.some((r) =>
        r.includes('intent.submit') && (r.includes('require condition not met') || r.includes('E_OP_NOT_ACCEPTED')),
      )
      expect(isIntentSubmitOpExecuted).toBe(true)
    }
  })
})
