## 任务：PT-06 — 把 `test/**` 纳入 typecheck 与 lint，堵住"写了不被检查"

### 1. 背景与意图
`npm run typecheck`（`tsconfig.json`）只覆盖 `src` + `test/properties`，**不含 `test/l2`**；`tsconfig.l2.json` 虽含 `test/l2` 但**无 npm 脚本运行它**；`npm run lint` 只 `eslint src`。后果：`test/l2` 与其他测试目录里"引用已删除字段/类型错误"`tsc` 抓不到——本轮 `attackShape` 陈旧断言即由此漏到运行期才失败。本任务消除这一盲区。对应主状态板 PT-06、全局报告 §七。

### 2. 权威依据（先读）
- `tsconfig.json`、`tsconfig.l2.json`、`package.json` scripts、`.eslintrc.cjs`
- `vitest.config.ts`（了解测试实际 include：`src/**`、`test/l2/**`、`test/properties/**`）

### 3. 就绪确认
- 依赖已闭合：全仓测试当前全绿（2016 通过），是安全的改造基线。
- 冻结：不改任何测试逻辑或源码逻辑，只改工程配置。

### 4. 允许改动的目录（白名单）
- `tsconfig.json` / `tsconfig.l2.json`（或新增聚合 tsconfig）
- `package.json` 的 `scripts`（如新增 `typecheck` 覆盖全测试、或让默认 typecheck 包含 test 全域）
- `.eslintrc.cjs` 与 lint 脚本（把 `test/**` 纳入 lint，或为测试目录设合理的 override 规则）

### 5. 禁止触碰（黑名单）
- **不改任何 `src/**`、`test/**` 的代码逻辑**。若纳入后暴露出真实类型/lint 错误：**逐条如实记录为交接项**（指明文件与错误），**不在本任务顺手改测试内容**（除非是纯类型注解层面的无行为修复且已说明）。
- 不动 `vitest.config.ts` 的测试语义。

### 6. 行为契约
遵循 `docs/00_并行作战手册.md` §四。改配置后**必跑**：`npx tsc --noEmit`（新范围）、`npx vitest run`、`npm run lint`。若新范围报出既有错误，先判断是"配置过严"还是"真实缺陷"，真实缺陷登记交接项。

### 7. DoD（可机器校验）
- [ ] 存在一条命令（如 `npm run typecheck`）能对 **`src` + `test/l2` + `test/properties` 全体**做 `tsc --noEmit` 且 0 错（或把暴露的真实错误清单化为交接项）。
- [ ] lint 覆盖 `test/**`（0 错，或警告可接受并说明）。
- [ ] `npx vitest run` 仍全绿。
- [ ] 在 `docs/00_主状态板.md` 健康快照更新命令说明。

### 8. 回流方式
- 完成后主状态板 PT-06 标 ✅，更新健康快照的 typecheck/lint 覆盖说明。
- 纳入后暴露的真实错误 → 逐条写成交接项（归属到对应 spec 的线），不自行跨线修。
