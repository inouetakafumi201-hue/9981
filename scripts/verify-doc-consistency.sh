#!/bin/bash
# 文档一致性校验：确保 docs/访谈决策记录.md 的裁决与 .kiro/specs/ 不脱节。
#
# 这里守的是一类真实发生过的缺陷：某项决策在 spec 里生效了，却没回写决策记录；
# 或某个未冻结项已被裁决关闭，spec 里却仍在拒绝引用它的配置。
# 用法：bash scripts/verify-doc-consistency.sh
cd "$(dirname "$0")/.." || exit 1
fail=0

echo "===== 1) 已关闭项不得再被声明为未冻结 ====="
# U-002 / U-004 / U-005 已关闭，不应再出现在 UnresolvedId 联合类型里
ids=$(grep -o "UnresolvedId = .*" .kiro/specs/wakeup-core-mechanics/design.md)
echo "UnresolvedId: $ids"
for closed in U-002 U-004 U-005; do
  if echo "$ids" | grep -q "$closed"; then echo "  ✗ $closed 已关闭却仍在 UnresolvedId 中"; fail=1; fi
done
[ $fail -eq 0 ] && echo "  ✓ 已关闭项均已移出"

echo
echo "===== 2) U-SPACE 已关闭项不得再要求保持 Unresolved ====="
for closed in U-SPACE-007; do
  if grep -q "\`$closed\`.*必须保持" .kiro/specs/wakeup-space-items/requirements.md; then
    echo "  ✗ $closed 已关闭却仍要求保持 Unresolved"; fail=1
  else echo "  ✓ $closed 已解除"; fi
done

echo
echo "===== 3) 仍未冻结项必须仍被保护 ====="
for open in T-001 U-001 U-003; do
  if grep -q "'$open'" .kiro/specs/wakeup-core-mechanics/design.md; then
    echo "  ✓ $open 仍在 UnresolvedId 中受保护"
  else echo "  ✗ $open 仍未冻结却已被移出保护"; fail=1; fi
done

echo
echo "===== 4) 旧规则不得复活 ====="
# 只有把「远程伤害 -1」当作生效规则陈述才算复活；标注为已取代/已否决的历史记述属正常保留。
if grep -rn "远程伤害 -1" docs .kiro 2>/dev/null \
   | grep -v "归档\|_归档" \
   | grep -v "不得复活\|已被取代\|之所以不够\|已否决\|v1"; then
  echo "  ✗ 已否决的「远程伤害 -1」出现在生效语境中"; fail=1
else echo "  ✓ 未复活（仅存于「已被取代」的历史记述中）"; fi

echo
echo "===== 5) 废用词检查（宪法铁律）====="
# 排除三类正当用法：宪法自身的禁用词表、UGC 创作语境（D-009 允许）、前端模板语法等技术义。
for banned in "模板" "内容层"; do
  hits=$(grep -rn "$banned" docs/L2_基类层 docs/L3_玩法层 2>/dev/null \
         | grep -v "废用\|禁用\|禁止使用\|JSX\|Vue\|模板语法")
  if [ -n "$hits" ]; then echo "  ⚠ 「$banned」疑似违规用法:"; echo "$hits" | head -5; else echo "  ✓ 「$banned」无违规用法"; fi
done
# 宪法自身必须保留禁用词表
grep -qE "废用术语|废用词" docs/L0_规范宪法.md && echo "  ✓ 宪法废用术语表存在" || { echo "  ✗ 宪法废用术语表缺失"; fail=1; }

echo
echo "===== 6) D-025 违规命名 ====="
if grep -rn "Among Us" docs --include=*.md 2>/dev/null | grep -v "访谈决策记录\|归档\|命名规范"; then
  echo "  ✗ 仍有违规命名"; fail=1
else echo "  ✓ 活跃文档已清理（决策记录内的历史记述属正常保留）"; fi

echo
echo "===== 7) 仪式动画四项一致性 ====="
# 只数 JSON 块内的条目，避免把讨论 C-1 的正文也算进来。
n=$(awk '/"ceremonialActionSemantics"/,/\]/' .kiro/specs/wakeup-ui-animation/design.md | grep -c 'actionSemanticId')
echo "  默认 profile 仪式动画项数: $n（应为 4）"
[ "$n" -eq 4 ] && echo "  ✓ 四项" || { echo "  ✗ 项数不符"; fail=1; }
# 招架必须在其中，且必须溯源到 D-032
if awk '/"ceremonialActionSemantics"/,/\]/' .kiro/specs/wakeup-ui-animation/design.md | grep -q 'parry-trigger.*D-032'; then
  echo "  ✓ 招架触发已加入且溯源 D-032"
else echo "  ✗ 招架触发缺失或溯源错误"; fail=1; fi
# requirements 侧不得再声明「三项」
if grep -q 'exactly the three approved' .kiro/specs/wakeup-ui-animation/requirements.md; then
  echo "  ✗ requirements 仍声明三项"; fail=1
else echo "  ✓ requirements 已改为四项"; fi

echo
echo "===== 8) 属性与 Validates 一一对应 ====="
for f in .kiro/specs/wakeup-ui-animation/design.md .kiro/specs/wakeup-core-mechanics/design.md; do
  p=$(grep -c '^### Property ' "$f")
  v=$(grep -c '^\*\*Validates: Requirements ' "$f")
  echo "  $(basename $(dirname $f)): $p 条属性 / $v 条 Validates"
  [ "$p" -eq "$v" ] || { echo "    ✗ 数量不符"; fail=1; }
done

echo
if [ $fail -eq 0 ]; then echo "===== 全部校验通过 ====="; else echo "===== 存在失败项 ====="; fi
exit $fail
