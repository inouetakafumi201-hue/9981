/**
 * 变异体文本定位：让 `from`/`to` 片段与源文件的行尾风格无关。
 *
 * 变异体定义统一用 `\n` 书写多行片段，但源文件用什么行尾取决于谁上次保存过它
 * （本仓库 `strict-json-decoder.ts` 是 CRLF，同目录兄弟文件是 LF）。
 * 不归一化的话，跨行的 `from` 串会匹配失败并被报成 PATTERN-NOT-FOUND；
 * 而"没跑到的变异体"与"被杀死的变异体"在结论上天差地别，绝不能混为一谈。
 *
 * 归一化的责任放在运行器一侧：变异体不该知道文件的行尾风格。
 *
 * 两个运行器（mutation-run / mutation-isolate）共用本模块，避免两处实现漂移。
 * 注意不要把本文件放进 `scripts/mutants/`——那个目录下的每个 `.mjs` 都会被当成变异体集加载。
 */

/** 把片段里的换行统一成 `source` 实际使用的行尾。 */
export function toSourceEol(fragment, source) {
  return source.includes('\r\n') ? fragment.replace(/\r?\n/g, '\r\n') : fragment.replace(/\r\n/g, '\n');
}

/**
 * 定位 `pattern`（按 `source` 行尾归一化后）的位置。
 *
 * @returns `null` 表示找不到；否则 `{index, length, count}`。
 *          `count > 1` 意味着该串在文件里不唯一——只替换第一处会得到一个语义不明的
 *          变异体，其存活/被杀都无法解释，因此调用方应当把这种情况单独报出而非照常判定。
 */
export function locate(source, pattern) {
  const needle = toSourceEol(pattern, source);
  const first = source.indexOf(needle);
  if (first < 0) return null;
  let count = 0;
  for (let at = first; at >= 0; at = source.indexOf(needle, at + needle.length)) count += 1;
  return { index: first, length: needle.length, count };
}

/** 应用一处替换。用下标切片而非 `String.replace`，后者会把 `$&`、`$1` 当成引用。 */
export function applyMutant(source, site, replacement) {
  return source.slice(0, site.index) + toSourceEol(replacement, source) + source.slice(site.index + site.length);
}
