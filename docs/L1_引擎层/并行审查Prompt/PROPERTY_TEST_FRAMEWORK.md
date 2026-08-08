# 属性测试驱动审查 — 执行框架

> ## 🗄️ 已执行完毕（L3–L6），并已被扩展为全 13 层
>
> 本文件是**方法论 + L3–L6 四层的分发 Prompt**。后续由
> [`EXECUTE_ALL_TESTS.md`](EXECUTE_ALL_TESTS.md) 扩展到全 13 层并执行完毕。
>
> **已修正的失效引用**：文中原引用的 `Prompt_L3_*` ~ `Prompt_L6_*` 四份文件已被删除，
> 现存对应物是本目录的 `TEST_L3_*` ~ `TEST_L6_*`（见 §「总控Prompt」与 §「我现在交给你的4个并行Prompt」）。
>
> **结果**：`kernel-l3-test` ~ `kernel-l6-test` 四个子项目全部 PASS，
> 见 [`00_状态基线.md`](00_状态基线.md) §3.2。

## 核心原则

**我不信思考，我信代码测试。**

所有审查Agent必须：
1. **写代码**：实现Spec描述的机制
2. **写测试**：海量属性测试 + 边界用例
3. **跑测试**：执行并记录失败
4. **修复Bug**：根据失败用例修复代码
5. **重复**：直到所有测试通过

---

## 测试框架结构

```typescript
// test-framework/kernel-property-test.ts

import fc from 'fast-check';

/**
 * 属性测试基础设施
 */
export class PropertyTest {
  // 不变量检查器
  static checkInvariants(world: World): InvariantViolation[] {
    const violations: InvariantViolation[] = [];
    
    // INV-1: 引用完整性
    for (const entity of world.entities) {
      if (entity.containers) {
        for (const [name, container] of Object.entries(entity.containers)) {
          if (!container.owner || container.owner !== entity.id) {
            violations.push({
              code: 'E_INV_DANGLING',
              detail: `container ${name} owner mismatch`
            });
          }
        }
      }
    }
    
    // INV-11: 堆叠守恒
    const stackCounts = new Map<string, number>();
    for (const item of world.items) {
      const current = stackCounts.get(item.def) || 0;
      stackCounts.set(item.def, current + item.stack);
    }
    // 与快照对比...
    
    // ... 其他15条不变量
    
    return violations;
  }
  
  // 生成随机Op序列
  static genOpSequence(length: number) {
    return fc.array(
      fc.oneof(
        fc.record({ op: fc.constant('stack.split'), /* args */ }),
        fc.record({ op: fc.constant('entity.place'), /* args */ }),
        fc.record({ op: fc.constant('cost.freeze'), /* args */ }),
        // ... 所有Op
      ),
      { minLength: 1, maxLength: length }
    );
  }
}

/**
 * L3层属性测试套件
 */
describe('L3: Ops + Transaction守恒性', () => {
  
  it('INV-11: 任意Op序列后堆叠守恒', () => {
    fc.assert(
      fc.property(
        PropertyTest.genOpSequence(50),
        (ops) => {
          const world = new World();
          const snapshot = world.snapshot();
          
          const tx = world.beginTx();
          for (const op of ops) {
            try {
              tx.exec(op);
            } catch (e) {
              // Op失败是允许的
            }
          }
          const result = tx.commit();
          
          if (result.ok) {
            // 提交成功 → 不变量必须成立
            const violations = PropertyTest.checkInvariants(world);
            return violations.length === 0;
          } else {
            // 提交失败 → 状态必须回滚
            return world.equals(snapshot);
          }
        }
      ),
      { numRuns: 10000 } // 1万次随机测试
    );
  });
  
  it('INV-4: 任意Op序列后位置互斥', () => {
    fc.assert(
      fc.property(
        PropertyTest.genOpSequence(50),
        (ops) => {
          const world = new World();
          world.beginTx();
          for (const op of ops) {
            try { world.exec(op); } catch {}
          }
          world.commit();
          
          // 检查所有Entity
          for (const entity of world.entities) {
            const hasNode = entity.place?.node != null;
            const hasSlot = entity.place?.slot != null;
            if (hasNode && hasSlot) {
              return false; // 违反INV-4
            }
          }
          return true;
        }
      ),
      { numRuns: 10000 }
    );
  });
  
  // ... 其余80条L3用例
});

/**
 * L4层属性测试套件
 */
describe('L4: Hook五阶段竞争', () => {
  
  it('HOOK-2: instead竞争排序确定性', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({
          priority: fc.integer({ min: 0, max: 100 }),
          containerIndex: fc.integer({ min: 0, max: 5 }),
          slotIndex: fc.integer({ min: 0, max: 10 }),
          defId: fc.string()
        })),
        (hooks) => {
          const sorted1 = sortInsteadHooks(hooks);
          const sorted2 = sortInsteadHooks(hooks);
          
          // 多次排序结果必须相同
          return JSON.stringify(sorted1) === JSON.stringify(sorted2);
        }
      ),
      { numRuns: 10000 }
    );
  });
  
  it('HOOK-4: depth上限防止无限递归', () => {
    const world = new World();
    const entity = world.createEntity();
    
    // 创建自递归Hook
    entity.addHook({
      on: 'event_loop',
      phase: 'after',
      effect: (ctx) => ctx.emit('event_loop')
    });
    
    try {
      world.emit('event_loop', { target: entity });
      return false; // 应该抛异常
    } catch (e) {
      return e.code === 'E_HOOK_DEPTH_EXCEEDED';
    }
  });
  
  // ... 其余45条L4用例
});
```

---

## 并行Prompt模板

每个Prompt让Agent：
1. **实现机制**（写代码）
2. **写属性测试**（fast-check）
3. **跑10万次随机测试**
4. **报告所有失败用例**
5. **修复并重测**

---

## Prompt 1: L3层实现与测试

````markdown
# 任务：实现并测试L3层（Ops + 事务守恒性）

## 你的任务

1. **实现以下机制**（TypeScript）：
   - `stack.split(source, amount, into)`
   - `stack.merge(source, into)`
   - `stack.adjust(item, delta)`
   - `entity.place(entity, at)`
   - `cost.freeze(entity, resources)`
   - `Transaction`（begin/commit/rollback）

2. **实现16条不变量检查器**：
   ```typescript
   class InvariantChecker {
     checkINV_11_StackConservation(world: World): Violation[]
     checkINV_4_LocationMutex(world: World): Violation[]
     checkINV_12_CostConservation(world: World): Violation[]
     // ... 其余13条
   }
   ```

3. **编写属性测试**：
   - 使用`fast-check`生成10万条随机Op序列
   - 每条序列执行后检查所有不变量
   - 记录所有违反的用例

4. **执行测试并报告**：
   ```bash
   npm install fast-check
   npm test
   ```

5. **修复所有失败用例**：
   - 对每个失败，给出：
     - 触发Bug的最小Op序列
     - 违反的不变量
     - 修复方案
   - 修复后重跑测试，直到100%通过

## 测试套件框架

```typescript
import fc from 'fast-check';

describe('L3: Ops守恒性', () => {
  
  // 测试1：堆叠守恒（INV-11）
  it('任意Op序列后同DefId物品总量不变', () => {
    fc.assert(
      fc.property(
        fc.array(genRandomOp(), { maxLength: 50 }),
        (ops) => {
          const world = new World();
          const beforeCounts = countItemsByDef(world);
          
          const tx = world.beginTx();
          for (const op of ops) {
            try { tx.exec(op); } catch {}
          }
          const result = tx.commit();
          
          if (result.ok) {
            const afterCounts = countItemsByDef(world);
            return deepEqual(beforeCounts, afterCounts);
          } else {
            // 失败则回滚
            const afterCounts = countItemsByDef(world);
            return deepEqual(beforeCounts, afterCounts);
          }
        }
      ),
      { numRuns: 100000 }
    );
  });
  
  // 测试2：位置互斥（INV-4）
  it('任意Op序列后Entity的node与slot互斥', () => {
    fc.assert(
      fc.property(
        fc.array(genRandomOp(), { maxLength: 50 }),
        (ops) => {
          const world = new World();
          world.beginTx();
          for (const op of ops) {
            try { world.exec(op); } catch {}
          }
          world.commit();
          
          for (const entity of world.entities) {
            if (entity.place?.node && entity.place?.slot) {
              return false; // 违反INV-4
            }
          }
          return true;
        }
      ),
      { numRuns: 100000 }
    );
  });
  
  // 测试3：Cost守恒（INV-12）
  it('任意Op序列后冻结的代价被结算或全额退回', () => {
    fc.assert(
      fc.property(
        fc.array(genRandomOp(), { maxLength: 50 }),
        (ops) => {
          const world = new World();
          const entity = world.createEntity({ gold: 100 });
          
          const tx = world.beginTx();
          for (const op of ops) {
            try { tx.exec(op); } catch {}
          }
          const result = tx.commit();
          
          // 检查：无残留frozen资源
          return entity.frozenResources.size === 0;
        }
      ),
      { numRuns: 100000 }
    );
  });
  
  // 测试4-80: 其余边界用例...
  // （从之前生成的80条用例中提取，转为代码）
});

// 随机Op生成器
function genRandomOp() {
  return fc.oneof(
    fc.record({
      type: fc.constant('stack.split'),
      source: fc.uuid(),
      amount: fc.integer({ min: 1, max: 100 }),
      target: fc.uuid()
    }),
    fc.record({
      type: fc.constant('entity.place'),
      entity: fc.uuid(),
      at: fc.uuid()
    }),
    fc.record({
      type: fc.constant('cost.freeze'),
      entity: fc.uuid(),
      gold: fc.integer({ min: 1, max: 50 })
    })
    // ... 其他Op
  );
}
```

## 交付物

1. **代码**：`src/kernel/l3-ops.ts`（所有Op实现）
2. **测试**：`test/l3-property.test.ts`（10万次属性测试）
3. **报告**：`L3_TEST_REPORT.md`
   - 总测试数：100,000
   - 通过：99,847
   - 失败：153
   - 失败用例清单（每条包含最小复现序列）
   - 修复方案

## 成功标准

- ✅ 所有测试100%通过
- ✅ 无不变量违反
- ✅ 代码覆盖率 > 95%

---

**开始执行。用代码说话，不要推理。**
````

---

## Prompt 2: L4层实现与测试

````markdown
# 任务：实现并测试L4层（Hook五阶段竞争）

## 你的任务

1. **实现Hook系统**：
   ```typescript
   class HookSystem {
     emit(type: string, data: any): void
     registerHook(hook: HookDef): void
     
     private collectInsteadHooks(type: string): Hook[]
     private sortInsteadHooks(hooks: Hook[]): Hook[]
     private checkDepth(current: number): void
     private checkReentry(type: string, hookId: string): void
   }
   ```

2. **实现竞争排序**（§6.2）：
   ```typescript
   function sortInsteadHooks(hooks: Hook[]): Hook[] {
     return hooks.sort((a, b) => {
       if (a.priority !== b.priority) return b.priority - a.priority;
       if (a.containerIndex !== b.containerIndex) return a.containerIndex - b.containerIndex;
       if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
       return a.defId.localeCompare(b.defId);
     });
   }
   ```

3. **编写属性测试**：
   - 竞争排序确定性：1万次随机Hook数组，排序结果必须一致
   - depth上限：100次自递归Hook，必须在32层截断
   - 重入锁：100次A→B→A循环，必须被阻止

4. **执行测试**：
   ```bash
   npm test -- l4-property.test.ts
   ```

5. **修复所有失败用例**

## 测试套件

```typescript
describe('L4: Hook竞争', () => {
  
  // 测试1：排序确定性
  it('相同Hook集合排序结果一致', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({
          priority: fc.integer(0, 100),
          containerIndex: fc.integer(0, 5),
          slotIndex: fc.integer(0, 10),
          defId: fc.string()
        })),
        (hooks) => {
          const sorted1 = sortInsteadHooks(hooks);
          const sorted2 = sortInsteadHooks(hooks);
          return JSON.stringify(sorted1) === JSON.stringify(sorted2);
        }
      ),
      { numRuns: 10000 }
    );
  });
  
  // 测试2：depth上限
  it('自递归在32层截断', () => {
    const world = new World();
    const entity = world.createEntity();
    
    entity.addHook({
      on: 'event_loop',
      phase: 'after',
      effect: (ctx) => ctx.emit('event_loop')
    });
    
    try {
      world.emit('event_loop', { target: entity });
      return false;
    } catch (e) {
      return e.code === 'E_HOOK_DEPTH_EXCEEDED';
    }
  });
  
  // 测试3：重入锁
  it('A→B→A被阻止', () => {
    const world = new World();
    const log: string[] = [];
    
    world.registerHook({
      id: 'hook_A',
      on: 'event_A',
      phase: 'after',
      effect: (ctx) => {
        log.push('A');
        ctx.emit('event_B');
      }
    });
    
    world.registerHook({
      id: 'hook_B',
      on: 'event_B',
      phase: 'after',
      effect: (ctx) => {
        log.push('B');
        ctx.emit('event_A');
      }
    });
    
    try {
      world.emit('event_A');
    } catch (e) {
      return e.code === 'E_HOOK_REENTRY' && log.length === 2;
    }
  });
  
  // 测试4-45: 其余用例...
});
```

## 交付物

1. **代码**：`src/kernel/l4-hook.ts`
2. **测试**：`test/l4-property.test.ts`
3. **报告**：`L4_TEST_REPORT.md`

---

**开始执行。用代码说话，不要推理。**
````

---

## Prompt 3: L5层实现与测试

````markdown
# 任务：实现并测试L5层（Expr表达式求值）

## 你的任务

1. **实现表达式求值器**：
   ```typescript
   class ExprEvaluator {
     eval(expr: Expr, ctx: Context): Value
     
     private evalArithmetic(op: string, left: Value, right: Value): Value
     private evalLogic(op: string, left: Value, right: Value): Value
     private evalQuery(query: Query, ctx: Context): Value
   }
   ```

2. **实现类型检查**（依据 §3.1.3 + §3.1.5）：
   - 算术运算要求两侧同为number，否则返回null
   - 逻辑运算要求bool，否则返回null
   - 除零返回null（不抛异常，§3.1.5 全函数承诺）
   - null传播：null参与任何运算返回null
   - 拒绝Infinity/NaN写入状态，但中间值允许

3. **编写属性测试**：
   - 1万次随机表达式求值
   - 类型安全性：类型不匹配的表达式返回null（不报错）
   - null传播：null参与运算结果为null
   - 除零检查：x/0返回null（不报错，保持全函数）

4. **执行测试**

## 测试套件

```typescript
describe('L5: Expr求值', () => {
  
  // 测试1：类型安全
  it('算术运算拒绝非number', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.boolean(), fc.constant(null)),
        (value) => {
          const expr = { op: '+', left: { type: 'literal', value: 10 }, right: { type: 'literal', value } };
          try {
            eval(expr);
            return value === null; // null传播允许
          } catch (e) {
            return e.code === 'E_EXPR_TYPE';
          }
        }
      ),
      { numRuns: 10000 }
    );
  });
  
  // 测试2：除零返回null（§3.1.5 全函数承诺，不抛异常）
  it('除零返回null', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        (numerator) => {
          const expr = { op: '/', left: { type: 'literal', value: numerator }, right: { type: 'literal', value: 0 } };
          const result = eval(expr); // 不会抛出
          return result === null;
        }
      ),
      { numRuns: 10000 }
    );
  });
  
  // 测试3-47: 其余用例...
});
```

## 交付物

1. **代码**：`src/kernel/l5-expr.ts`
2. **测试**：`test/l5-property.test.ts`
3. **报告**：`L5_TEST_REPORT.md`

---

**开始执行。用代码说话，不要推理。**
````

---

## Prompt 4: L6层实现与测试

````markdown
# 任务：实现并测试L6层（Decision决策树）

## 你的任务

1. **实现决策系统**：
   ```typescript
   class DecisionSystem {
     open(decision: DecisionDef): string
     answer(id: string, choice: string): void
     resolve(id: string): void
     
     private checkTimeout(decision: Decision): void
     private validateAnswer(decision: Decision, choice: string): void
   }
   ```

2. **实现状态机**：
   - open → answer → resolve
   - 超时自动应用defaultAnswer
   - 答案合法性检查
   - 嵌套决策拒绝

3. **编写属性测试**：
   - 1万次随机决策流转
   - 超时行为：ttl过期后必须应用defaultAnswer
   - 答案验证：非法答案必须拒绝
   - 嵌套限制：决策中触发决策必须报错

4. **执行测试**

## 测试套件

```typescript
describe('L6: Decision', () => {
  
  // 测试1：答案验证
  it('非法答案被拒绝', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 2, maxLength: 5 }),
        fc.string(),
        (options, invalidChoice) => {
          fc.pre(!options.includes(invalidChoice)); // 确保不在options中
          
          const world = new World();
          const decId = world.decision.open({ options });
          
          try {
            world.decision.answer(decId, invalidChoice);
            return false;
          } catch (e) {
            return e.code === 'E_DEC_INVALID_ANSWER';
          }
        }
      ),
      { numRuns: 10000 }
    );
  });
  
  // 测试2：超时
  it('ttl过期自动应用defaultAnswer', () => {
    const world = new World();
    const decId = world.decision.open({
      options: ['A', 'B'],
      ttl: 1000, // 1秒
      defaultAnswer: ['A']
    });
    
    // 等待超时
    world.tick(1001);
    
    const dec = world.decision.get(decId);
    return dec.answer.includes('A') && dec.status === 'resolved';
  });
  
  // 测试3-30: 其余用例...
});
```

## 交付物

1. **代码**：`src/kernel/l6-decision.ts`
2. **测试**：`test/l6-property.test.ts`
3. **报告**：`L6_TEST_REPORT.md`

---

**开始执行。用代码说话，不要推理。**
````

---

## 总控Prompt：并行执行4个任务

````markdown
# 总任务：元机制内核全面属性测试

## 你的使命

**用代码说话，不要推理。**

将以下4个任务**并行分发**到4个独立Agent：

1. **Agent_L3**：执行`TEST_L3_Ops事务守恒性.md`
2. **Agent_L4**：执行`TEST_L4_Hook五阶段竞争.md`
3. **Agent_L5**：执行`TEST_L5_Expr表达式求值.md`
4. **Agent_L6**：执行`TEST_L6_Decision决策树.md`

每个Agent必须：
1. 写代码实现Spec描述的机制
2. 写10万次属性测试
3. 跑测试并记录所有失败
4. 修复所有Bug
5. 重测直到100%通过
6. 提交测试报告

## 执行方式

```bash
# 在4个独立目录并行执行
mkdir -p kernel-test/{l3,l4,l5,l6}

# L3
cd kernel-test/l3
npm init -y
npm install fast-check typescript @types/node
# 复制Prompt_L3内容，开始执行

# L4
cd ../l4
npm init -y
npm install fast-check typescript @types/node
# 复制Prompt_L4内容，开始执行

# L5
cd ../l5
npm init -y
npm install fast-check typescript @types/node
# 复制Prompt_L5内容，开始执行

# L6
cd ../l6
npm init -y
npm install fast-check typescript @types/node
# 复制Prompt_L6内容，开始执行
```

## 最终交付物

4份测试报告：
- `L3_TEST_REPORT.md`
- `L4_TEST_REPORT.md`
- `L5_TEST_REPORT.md`
- `L6_TEST_REPORT.md`

每份报告包含：
- 总测试数
- 通过/失败统计
- 所有失败用例的最小复现序列
- 修复方案
- 修复后的重测结果

## 成功标准

- ✅ 4层全部测试100%通过
- ✅ 无不变量违反
- ✅ 代码覆盖率 > 95%

---

**现在开始执行。用代码和测试结果说话，不要任何推理和解释。**
````

---

## 我现在交给你的4个并行Prompt

对应本目录的以下文件（原名为 `Prompt_L3_*` ~ `Prompt_L6_*`，已更名/合并到 `TEST_L*` 系列）：
- `TEST_L3_Ops事务守恒性.md`
- `TEST_L4_Hook五阶段竞争.md`
- `TEST_L5_Expr表达式求值.md`
- `TEST_L6_Decision决策树.md`

每个Prompt都是**完全自包含的执行任务**，Agent拿到后直接：
1. 写代码
2. 写测试
3. 跑测试
4. 修复
5. 报告

**用代码说话，不要思考。**

---

**执行状态**: 🗄️ 已执行完毕。本文件是 L3–L6 四层属性测试的方法论与分发依据，
后由 [`EXECUTE_ALL_TESTS.md`](EXECUTE_ALL_TESTS.md) 扩展为全 13 层。
结果见 [`00_状态基线.md`](00_状态基线.md) §3.2（`kernel-l3-test` ~ `kernel-l6-test` 均 PASS）。