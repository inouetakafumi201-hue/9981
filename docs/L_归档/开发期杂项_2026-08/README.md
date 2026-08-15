# 开发期杂项归档（2026-08-15 文档清理）

> **归档原因**：2026-08-15 全面文档清理中，把已不可能在常规开发中再被复用的一组**一次性测试工程**与**交付报告/运行产物**从仓库活跃区收拢到这里，避免污染 `src/`、`test/`、根目录与 `.kiro/reports/`。

## 处置原则

按宪法第八条「归档：完成或废弃的 Spec 移入 L_归档」与 `steering_历史/README.md` 先例：**只归档、不删除**——所有内容保留在 git 历史中，供追溯；权威/现行内容已在别处。

## 归档清单

| 子目录 | 原路径 | 内容 | 为何归档 |
|---|---|---|---|
| `kernel测试工程/` | 仓库根 `kernel-l1l2-test/` … `kernel-l13-test/`（12 个） | 内核四件套验收的独立测试工程（Lxx_TEST_REPORT.md / mutation / coverage / dist，240 个受追文件） | 一次性验收子项目；现行测试基线在 `test/` 与 `src/**/__tests__`；`KERNEL_VERIFICATION_STATUS.md` 为层的验证索引 |
| `semantic-review/` | 仓库根 `semantic-review/` | 2026-08-11 架构迁移一次性分析 | 结论已并入 `00_架构域与文档分类.md`，无引用 |
| `wave2报告/` | `.kiro/reports/` | Wave2 迁移/武器-D071 完成报告 | 一次性交付执行报告；权威内容已入 `docs/L2_基类层/04_物品装备.md` 等 |
| `根目录杂项/` | 仓库根 `.l11-safety-backup/`、`.mutation-report.json` 等 | L11 备份副本 + 变异/tmp 测试运行产物 | 一次性产物/重复副本；`scripts/mutation-run.mjs` 会即时重建 `.mutation-report.json` |

## 仍有效的权威入口

- 内核层验证索引 → 根目录 `KERNEL_VERIFICATION_STATUS.md`（未迁移）
- 引擎层/基类层现行测试 → `test/`、`src/**/__tests__`
- 审查报告现行入口 → `docs/L_审查报告/00_并行产出裁决与整理.md`（未迁移）
