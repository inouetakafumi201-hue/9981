"""反向漏洞审查：逐条放宽地图管线的规则，确认测试套件必然失败。

任何一个变异体"存活"（测试仍全绿）都说明对应的规则没有被真正钉住——那条测试是空转的。
本脚本只在本地跑，跑完把文件恢复原状。
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VALIDATE = ROOT / 'src/play/map/validate.ts'
TYPES = ROOT / 'src/play/map/types.ts'
CURVE = ROOT / 'src/play/map/curve.ts'
COMPILE = ROOT / 'src/play/map/compile.ts'

# (名字, 文件, 原文, 替换为) —— 每条都是"把规则放宽/删掉"
MUTANTS = [
    ('坐标越界不再拒绝', VALIDATE,
     'return Number.isFinite(value) && value >= COORD_MIN && value <= COORD_MAX;',
     'return true;'),
    ('坐标只查下界', VALIDATE,
     'return Number.isFinite(value) && value >= COORD_MIN && value <= COORD_MAX;',
     'return Number.isFinite(value) && value >= COORD_MIN;'),
    ('NaN 坐标放行', VALIDATE,
     'return Number.isFinite(value) && value >= COORD_MIN && value <= COORD_MAX;',
     'return Number.isNaN(value) || (value >= COORD_MIN && value <= COORD_MAX);'),
    ('场景嵌套不再检查', VALIDATE,
     'if (!admitted.includes(node.scale)) {',
     'if (false) {'),
    # 这里曾有两个变异体（'通行代价允许非整数'、'通行代价不再限幅'），随 MapEdge.weight 一起删。
    # 代价属于门户类型，不是逐边填的数。注意这条规则现在**无法**用变异体证明：它是一个"字段不存在"，
    # 没有可以放松的代码行。守它的是测试里那条「编译产物里任何地方都不出现 weight」——加回字段
    # 就得同时改那条测试，改动会显式暴露出来。这是变异审查的结构盲区，写在这里以免被当成漏测。
    ('Expr 键名遮蔽不再拦', VALIDATE,
     'if (!EXPR_DISCRIMINANT_KEYS.includes(key)) continue;',
     'continue;'),
    ('吸附容差放大到 0.05', VALIDATE,
     'export const SNAP_TOLERANCE = 0.005;',
     'export const SNAP_TOLERANCE = 0.05;'),
    ('连接数上限统一放成 5', TYPES,
     '  large: 5,\n  medium: 4,\n  small: 3,\n};',
     '  large: 5,\n  medium: 5,\n  small: 5,\n};'),
    ('小场景上限从 3 放到 4', TYPES,
     '  large: 5,\n  medium: 4,\n  small: 3,\n};',
     '  large: 5,\n  medium: 4,\n  small: 4,\n};'),
    ('编译不再因 error 中止', COMPILE,
     'if (errors.length > 0) return { ok: false, diagnostics: findings };',
     'if (errors.length > 99999) return { ok: false, diagnostics: findings };'),
    # 以下针对端到端测试：产物内容缺失时 spawn 仍会 ok，只有真正断言内容的测试才抓得住。
    ('编译丢掉所有连接', COMPILE,
     'links: map.edges.map(linkSpecOf),',
     'links: [],'),
    ('编译丢掉所有实体放置', COMPILE,
     'entities: map.placements.map(entitySpecOf),',
     'entities: [],'),
    ('编译丢掉最后一个节点', COMPILE,
     'nodes: map.nodes.map(nodeSpecOf),',
     'nodes: map.nodes.slice(0, -1).map(nodeSpecOf),'),
    ('单向标记恒为 false', COMPILE,
     "directed: edge.directionality === 'unidirectional',",
     'directed: false,'),
    ('连接端点写反', COMPILE,
     '    a: edge.a,\n    b: edge.b,',
     '    a: edge.b,\n    b: edge.a,'),
    ('曲线长度反过来决定代价', CURVE,
     'export function pathLength',
     'export function pathLength'),  # 占位：见下方说明，曲线不参与编译，无可放宽处
]
# `曲线长度反过来决定代价` 无法作为变异体表达——因为 compile.ts 根本不 import curve.ts。
# 这本身就是那条规则的证据（几何与拓扑在代码层面无连接），所以从清单里剔除而不是假装测了。
MUTANTS = [m for m in MUTANTS if m[0] != '曲线长度反过来决定代价']


def read(path: Path) -> str:
    return path.read_text(encoding='utf-8')


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding='utf-8', newline='')


def run_tests() -> bool:
    """返回 True 表示测试全绿。"""
    # 不用 text=True：Windows 控制台默认 GBK，会在解码 vitest 的 UTF-8 输出时抛异常。
    proc = subprocess.run(
        ['npx', 'vitest', 'run', 'src/play/map', '--reporter=dot'],
        cwd=ROOT, capture_output=True, shell=True,
    )
    return proc.returncode == 0


def main() -> int:
    originals = {p: read(p) for p in {VALIDATE, TYPES, CURVE, COMPILE}}

    # 先确认基线是绿的，否则整场审查没有意义。
    if not run_tests():
        print('基线就是红的，先修好再做变异审查。')
        return 2
    print('基线：全绿\n')

    survivors = []
    try:
        for name, path, old, new in MUTANTS:
            source = originals[path]
            if source.count(old) != 1:
                print(f'  ?? {name}: 锚点匹配 {source.count(old)} 次，跳过（脚本需更新）')
                survivors.append(f'{name}（锚点失配）')
                continue
            write(path, source.replace(old, new))
            killed = not run_tests()
            write(path, source)
            print(f'  {"杀死" if killed else "存活 <<<"} {name}')
            if not killed:
                survivors.append(name)
    finally:
        for path, text in originals.items():
            write(path, text)

    print()
    if survivors:
        print(f'{len(survivors)} 个变异体存活，对应规则没有被钉住：')
        for name in survivors:
            print(f'  - {name}')
        return 1
    print(f'全部 {len(MUTANTS)} 个变异体被杀死。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
