/**
 * 变异体清单的预检：不跑测试，只核对每条 find 在源码中恰好命中 1 次。
 *
 * 存在理由：驱动器把命中 0 次或 >1 次记为 INVALID 并排除出得分。
 * 若不预检，一条写错的 find 要等它那一轮套件跑完（数十秒）才暴露，
 * 116 条排查一遍的代价高得离谱。这里一次全查完。
 *
 * 同时核对 CRLF/LF：多行 find 字符串在本文件里是 \n 分隔的，
 * 若源码是 CRLF，所有多行 find 都会命中 0 次——这类失败看起来像"写错了"，
 * 实际是行尾问题，必须区分开报。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTANTS } from './mutants.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');

const cache = new Map<string, string>();
function read(file: string): string {
  let t = cache.get(file);
  if (t === undefined) {
    t = fs.readFileSync(path.join(SRC, file), 'utf8');
    cache.set(file, t);
  }
  return t;
}

let bad = 0;
const ids = new Set<string>();

for (const m of MUTANTS) {
  if (ids.has(m.id)) {
    process.stdout.write(`${m.id} 重复的变异体 id\n`);
    bad++;
  }
  ids.add(m.id);

  const text = read(m.file);
  const hits = text.split(m.find).length - 1;
  if (hits !== 1) {
    const crlf = text.includes('\r\n');
    const multiline = m.find.includes('\n');
    const hint = hits === 0 && multiline && crlf ? '（源码为 CRLF，多行 find 需改写）' : '';
    process.stdout.write(`${m.id} 命中 ${hits} 次${hint}  ${m.desc}\n`);
    bad++;
    continue;
  }
  if (m.find === m.replace) {
    process.stdout.write(`${m.id} find 与 replace 相同（空变异）  ${m.desc}\n`);
    bad++;
  }
}

const text = read('diagnostic.ts');
process.stdout.write(`\n行尾：${text.includes('\r\n') ? 'CRLF' : 'LF'}\n`);
process.stdout.write(`变异体：${MUTANTS.length}  问题：${bad}\n`);
process.exit(bad === 0 ? 0 : 1);
