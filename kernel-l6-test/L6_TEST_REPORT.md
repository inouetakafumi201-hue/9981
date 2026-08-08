# L6层测试报告：Decision 决策树

## 测试执行

| 项目 | 结果 |
| --- | --- |
| 命名测试 | 70 / 70 通过 |
| 测试套件 | 1 / 1 通过 |
| fast-check 属性测试组 | 21 组 |
| 属性测试生成样本 | 380,000 / 380,000 通过 |
| 确定性边界用例 | 49 / 49 通过 |
| 测试失败 | 0 |
| 覆盖率（Statements） | 98.63% |
| 覆盖率（Branches） | 97.82% |
| 覆盖率（Functions） | 100% |
| 覆盖率（Lines） | 98.57% |

执行命令：

```powershell
npm test
npm run build
npx jest --runInBand --coverage
```

结果：`npm test`、`npm run build` 和覆盖率测试均以退出码 `0` 完成。`npm install --package-lock-only` 还确认依赖锁文件同步，`npm audit` 报告 0 vulnerabilities。

## 属性测试统计

| 测试项 | 运行次数 | 通过 | 失败 | 本次覆盖率运行耗时 |
| --- | ---: | ---: | ---: | ---: |
| DEC-2：非法答案被拒绝 | 100,000 | 100,000 | 0 | 2216ms |
| DEC-5：重复答案被拒绝 | 100,000 | 100,000 | 0 | 2448ms |
| DEC-4：TTL 过期自动应用默认答案 | 10,000 | 10,000 | 0 | 63ms |
| DEC-3：maxCount 限制 | 10,000 | 10,000 | 0 | 310ms |
| 单选、状态迁移、默认答案与上下文 effect | 150,000 | 150,000 | 0 | — |
| 多 tick 累积、超时隔离 | 10,000 | 10,000 | 0 | — |
| **总计** | **380,000** | **380,000** | **0** | — |

> 属性测试样本数为 fast-check 实际配置的 `numRuns` 之和；它与 Jest 的 70 个命名测试数分别统计。

## 覆盖的关键行为

- `options` 为空、`minCount > maxCount` 和非法 `defaultAnswer` 会被拒绝。
- 非法选项、重复选项、超出 `maxCount`、单选二次回答和已 resolve 后回答均返回对应错误。
- `minCount`、`maxCount`、单选/多选状态转移及 `minCount = 0` 均被验证。
- `ttl = null` 永不超时；达到 TTL 后应用默认答案，并在满足数量约束时自动 resolve。
- `Record<string, OptionDef>` 中已选选项的 effect 按回答顺序执行，并接收调用方上下文。
- 不同决策的状态和超时行为相互隔离。

## 修复的 Bug

### Bug #1：超时默认答案可绕过 `minCount`

**复现序列**：创建 `minCount = 2`、`defaultAnswer = ['A']` 的决策；TTL 到期后，超时逻辑将状态标记为 `answered`。旧版 `resolve()` 仅检查状态，因此会将只包含一个答案的决策错误地 resolve。

**修复**：`resolve()` 现在先校验 `decision.answer.length < decision.minCount`，不足时抛出 `E_DEC_UNANSWERED`；`minCount = 0` 的空答案仍允许 resolve。超时自动 resolve 失败时，决策保留为 `answered`，不会错误执行 effect。

## 交付物

- `src/decision.ts`
- `src/decision-system.ts`
- `src/index.ts`
- `test/l6-property.test.ts`
- `L6_TEST_REPORT.md`

## 结论

所有 70 个命名测试及 380,000 个属性测试样本均通过，TypeScript 编译成功，行覆盖率为 98.57%。L6 Decision 决策树已完成验证。
