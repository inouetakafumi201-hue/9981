/**
 * Design Tokens —— 表现层唯一美学真相源（CJS 镜像）。
 *
 * 权威文件是 `tokens.ts`（ESM，供 TS/React 消费）；本文件是同一份数据的 CJS 镜像，
 * 只给 `tailwind.config.cjs` 读取（Tailwind 配置加载器不解析 ESM TS，且避免引 ts-node）。
 * 任何颜色改动先改 `tokens.ts`，再同步这里——两处必须逐项一致。
 */
module.exports = {
  colors: {
    // —— 五条视觉定律的语义色 ——
    damage: '#e53e3e', // 红：生命减损、伤害、致命危险
    stamina: '#3182ce', // 蓝：清醒度、体力（清醒值/SP）、科技、处决
    alert: '#d69e2e', // 黄：感官、注意、警戒
    action: '#dd6b20', // 橙：行动点 / AP、行动消耗及进度
    safe: '#38a169', // 绿：安全、正面交互、免费与让利
    constraint: '#805ad5', // 紫：关系约束、局部菜单替换、远程
    melee: '#ed64a6', // 珊瑚：近战、格斗、攻击性行为、暴力
    social: '#06b6d4', // 青：社交、交流、UGC/创意工坊来源与创作物
    cooldown: '#718096', // 灰：冷却、延迟、不会立刻生效
    interactive: '#f3f4f6', // 灰白：可交互但受制于当前状态（高光/材质）
    dream: '#ffffff', // 纯白/奶白：梦境边界与过载概念色
    gold: '#d4af37', // 金：区别性品级高光
    silver: '#a8b2bd', // 银：区别性品级高光
    ink: '#0d1824',
    muted: '#627383',
    panel: '#f8fbfd',
    border: '#cfdae2',
    canvas: '#e7eff3',
  },
};
