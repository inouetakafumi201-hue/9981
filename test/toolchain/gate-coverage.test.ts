/**
 * 工具链门禁守卫（PT-06 的机器化守卫）。
 *
 * ## 为什么需要这个文件
 *
 * PT-06 修复了一个信任缺口：`test/l2/**` 曾不在 `tsconfig` 的 typecheck 范围内，
 * `npm run lint` 也只检查 `src`。后果是"测试引用一个已从类型上删除的字段"这类错误
 * `tsc` 抓不到，只在运行期暴露为 `undefined`（2026-08-08 删除 `ActionDescriptor.attackShape`
 * 后，`test/l2/integration/end-to-end.integration.test.ts` 的陈旧断言就是这样漏过去的）。
 *
 * 但"改好了配置"和"以后不会再坏"是两件事。配置盲区的本质是**没有任何东西在监视范围本身**，
 * 所以只写文档说明"已修复"仍然是靠人记性。本文件把范围不变量变成断言：
 * 任何人缩小 typecheck / lint 范围、或新建一个不在检查范围里的测试目录，都会让本套测试变红。
 *
 * ## 守卫的不变量
 *
 * - **G1 检查范围 ⊇ 磁盘现实**：`src/` 与 `test/` 下每个 `.ts` / `.tsx` 文件都必须出现在
 *   `tsconfig.json` 解析出的 program 文件集合里。
 * - **G2 运行范围 ⊆ 检查范围的根**：`vitest.config.ts` 的每个 include glob 的根目录都必须落在
 *   `src` 或 `test` 之下——否则 G1 覆盖不到它，需要同步扩大 typecheck 范围。
 * - **G3 typecheck 脚本跑的是全域配置**：`npm run typecheck` 不得用 `-p` / `--project`
 *   指向某个窄范围 tsconfig（例如 `tsconfig.l2.json`）。
 * - **G4 lint 脚本覆盖两棵树且扩展名不漏**：目标含 `src` 与 `test`；磁盘上出现 `.tsx` 时
 *   `--ext` 必须包含 `.tsx`。
 * - **G5 lint 对测试目录真的有效**：ESLint 不忽略 `test/**`，且在测试目录路径下能真实报出 error
 *   （断言的是行为，不是配置字符串）。
 * - **G6 verify 串联三门禁**：`npm run verify` 必须依次包含 typecheck、lint、test，
 *   且数据可解析守卫 `verify:data` 必须串联进 verify、位列 `verify:docs` 之前。
 * - **G7 数据 JSON 静态可解析门禁在岗**：`scripts/verify-data-json.mjs` 必须存在、
 *   被 `verify:data` 与 `verify` 引用，判据确实是严格 `JSON.parse` 且失败即 `exit 1`。
 *
 * 参考：`docs/00_主状态板.md` §一（健康快照与命令覆盖范围）、
 * `AGENTS.md` 结尾「项目实践原则」架构决策原则「契约要机器可校验」「零耦合要有守卫」。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import vitestConfig from '../../vitest.config.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 被 typecheck / lint 共同覆盖的两棵树。二者是本仓库全部第一方 TypeScript 代码的所在。 */
const COVERED_ROOTS = ['src', 'test'] as const;

/** 统一成仓库相对、正斜杠、小写的形式，避免 Windows 盘符大小写与分隔符差异造成假失败。 */
function toComparableRelativePath(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).split(sep).join('/').toLowerCase();
}

/**
 * 递归收集一棵树下的 TypeScript 源文件。
 *
 * 跳过 `node_modules` 与以 `.` 开头的目录：前者不是第一方代码，后者是工具缓存/备份
 * （例如根目录的 `.l11-safety-backup/`），都不属于门禁应覆盖的范围。
 */
function collectTypeScriptFiles(treeRoot: string): string[] {
  const collected: string[] = [];
  const pending: string[] = [treeRoot];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        pending.push(fullPath);
        continue;
      }
      if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        collected.push(fullPath);
      }
    }
  }

  return collected;
}

/**
 * 用 TypeScript 自己的 config 解析器算出 program 会包含哪些文件。
 *
 * 刻意不自己实现 include/exclude 的 glob 语义：那等于重写一遍 tsc 的规则，
 * 一旦语义有偏差，守卫就会给出与真实 `tsc` 不一致的结论——守卫本身变成新的信任缺口。
 * `ts.readConfigFile` 同时能吃掉 tsconfig 里的注释（JSONC）。
 */
function parseTsconfigFileNames(configFileName: string): string[] {
  const configPath = resolve(REPO_ROOT, configFileName);
  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(readResult.error, `${configFileName} 读取失败：${JSON.stringify(readResult.error)}`).toBeUndefined();

  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, REPO_ROOT, undefined, configPath);
  const fatalErrors = parsed.errors.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  expect(
    fatalErrors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')),
    `${configFileName} 解析出错`,
  ).toEqual([]);

  return parsed.fileNames;
}

/** 取 glob 中第一个含通配符的段之前的部分，即该 glob 的静态根目录。 */
function staticGlobRoot(glob: string): string {
  const rootSegments: string[] = [];
  for (const segment of glob.split('/')) {
    if (/[*?[\]{}!+@]/.test(segment)) {
      break;
    }
    rootSegments.push(segment);
  }
  return rootSegments.join('/');
}

/** 判断 `candidate` 是否等于 `ancestor` 或位于其之下（按路径段比较，避免 `srcx` 误判为 `src` 下）。 */
function isWithin(candidate: string, ancestor: string): boolean {
  if (candidate === ancestor) {
    return true;
  }
  return candidate.startsWith(`${ancestor}/`);
}

interface PackageManifest {
  readonly scripts?: Readonly<Record<string, string>>;
}

function readPackageManifest(): PackageManifest {
  const raw = readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8');
  return JSON.parse(raw) as PackageManifest;
}

function readScript(name: string): string {
  const scripts = readPackageManifest().scripts ?? {};
  const script = scripts[name];
  expect(script, `package.json 缺少 "${name}" 脚本`).toBeTypeOf('string');
  return script as string;
}

/** ESLint CLI 中"下一个 token 是自己的值"的选项。解析目标参数时必须跳过它们的值。 */
const ESLINT_VALUE_FLAGS = new Set([
  '--ext',
  '--config',
  '-c',
  '--ignore-pattern',
  '--ignore-path',
  '--parser',
  '--parser-options',
  '--plugin',
  '--rule',
  '--rulesdir',
  '--format',
  '-f',
  '--output-file',
  '-o',
  '--max-warnings',
  '--cache-location',
  '--resolve-plugins-relative-to',
  '--report-unused-disable-directives-severity',
  '--env',
  '--global',
]);

interface ParsedLintScript {
  /** 传给 eslint 的位置参数，即被检查的目录/文件。 */
  readonly targets: readonly string[];
  /** `--ext` 声明的扩展名，统一带前导点。 */
  readonly extensions: readonly string[];
}

function parseLintScript(script: string): ParsedLintScript {
  const tokens = script.trim().split(/\s+/u);
  const targets: string[] = [];
  const extensions: string[] = [];
  let skipNext = false;

  for (const [index, token] of tokens.entries()) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (index === 0) {
      // 命令名本身（eslint / npx 等价形式在本仓库不使用）。
      expect(token, 'lint 脚本应直接调用 eslint').toBe('eslint');
      continue;
    }
    if (token.startsWith('--ext=')) {
      extensions.push(...token.slice('--ext='.length).split(','));
      continue;
    }
    if (token === '--ext') {
      const value = tokens[index + 1];
      if (value !== undefined) {
        extensions.push(...value.split(','));
      }
      skipNext = true;
      continue;
    }
    if (ESLINT_VALUE_FLAGS.has(token)) {
      skipNext = true;
      continue;
    }
    if (token.startsWith('-')) {
      continue;
    }
    targets.push(token);
  }

  return {
    targets,
    extensions: extensions.map((extension) => (extension.startsWith('.') ? extension : `.${extension}`)),
  };
}

describe('G1: typecheck 范围必须覆盖磁盘上全部第一方 TypeScript 文件', () => {
  it('src/ 与 test/ 下每个 .ts / .tsx 都在 tsconfig.json 解析出的 program 里', () => {
    const programFiles = new Set(parseTsconfigFileNames('tsconfig.json').map(toComparableRelativePath));

    const missing: string[] = [];
    for (const treeRoot of COVERED_ROOTS) {
      for (const absolutePath of collectTypeScriptFiles(resolve(REPO_ROOT, treeRoot))) {
        const comparable = toComparableRelativePath(absolutePath);
        if (!programFiles.has(comparable)) {
          missing.push(comparable);
        }
      }
    }

    expect(
      missing.sort(),
      '以下文件不在 `npm run typecheck` 的检查范围内——这正是 PT-06 修复的盲区形态：'
        + '文件能被 vitest 跑到、却不被 tsc 检查，于是"引用已删除字段"只在运行期炸。'
        + '修法是扩大 tsconfig.json 的 include（推荐写目录名而不是枚举子目录），而不是删掉本断言。',
    ).toEqual([]);
  });

  it('两棵树都确实有文件被收集到，防止断言因为遍历失效而空转', () => {
    // 若 collectTypeScriptFiles 因路径错误返回空数组，上一条断言会以"没有缺失"的假象通过。
    for (const treeRoot of COVERED_ROOTS) {
      expect(
        collectTypeScriptFiles(resolve(REPO_ROOT, treeRoot)).length,
        `${treeRoot}/ 下没有收集到任何 TypeScript 文件，遍历逻辑或仓库结构已变`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('G2: vitest 的运行范围必须落在 typecheck 覆盖的树里', () => {
  it('每个 include glob 的静态根目录都位于 src/ 或 test/ 之下', () => {
    const includeGlobs = vitestConfig.test?.include;
    expect(includeGlobs, 'vitest.config.ts 未声明 test.include').toBeDefined();

    const outside: string[] = [];
    for (const glob of includeGlobs ?? []) {
      const root = staticGlobRoot(glob);
      const covered = COVERED_ROOTS.some((treeRoot) => isWithin(root, treeRoot));
      if (!covered) {
        outside.push(`${glob}（根目录 "${root}"）`);
      }
    }

    expect(
      outside.sort(),
      '以下 vitest include 的根目录不在 typecheck 覆盖的 src/ 与 test/ 之内，'
        + '意味着这些测试会被运行但不被类型检查。要么把它们移入 src/ 或 test/，'
        + '要么同时扩大 tsconfig.json 的 include 并把新根加入本文件的 COVERED_ROOTS。',
    ).toEqual([]);
  });
});

describe('G3: typecheck 脚本必须跑全域配置，不得被换成窄范围 tsconfig', () => {
  it('npm run typecheck 不使用 -p / --project 指向其他 tsconfig', () => {
    const script = readScript('typecheck');
    expect(
      /(^|\s)(-p|--project)(\s|=)/u.test(script),
      `typecheck 脚本当前是 "${script}"。它必须使用默认 tsconfig.json（全域范围）。`
        + '窄范围配置（如 tsconfig.l2.json）只能作为补充门禁挂在别的脚本名下，'
        + '例如 typecheck:l2——否则 G1 守住的范围会被脚本层面绕过。',
    ).toBe(false);
  });

  it('窄范围的 L2 隔离门禁仍然存在且仍指向 tsconfig.l2.json', () => {
    // PT-06 之前 tsconfig.l2.json 没有任何脚本会跑它，等于形同虚设。
    // 这条断言保证"补充门禁"不会再次退化成无人执行的死配置。
    expect(readScript('typecheck:l2')).toMatch(/--noEmit/u);
    expect(readScript('typecheck:l2')).toMatch(/tsconfig\.l2\.json/u);
  });

  it('tsconfig.l2.json 是真正的窄范围（严格小于全域范围），否则它就失去了隔离验证的意义', () => {
    const fullScope = parseTsconfigFileNames('tsconfig.json').map(toComparableRelativePath);
    const l2Scope = parseTsconfigFileNames('tsconfig.l2.json').map(toComparableRelativePath);

    expect(l2Scope.length).toBeGreaterThan(0);
    expect(
      l2Scope.length,
      'tsconfig.l2.json 的范围不再小于全域范围，说明隔离验证已经名不副实',
    ).toBeLessThan(fullScope.length);
  });
});

describe('G4: lint 脚本必须覆盖两棵树，且扩展名不漏', () => {
  it('lint 目标同时包含 src 与 test', () => {
    const parsed = parseLintScript(readScript('lint'));
    for (const treeRoot of COVERED_ROOTS) {
      expect(
        parsed.targets.some((target) => isWithin(target.split(sep).join('/'), treeRoot)),
        `lint 脚本的检查目标 ${JSON.stringify(parsed.targets)} 未覆盖 "${treeRoot}"。`
          + 'PT-06 之前只 lint src，测试目录处于无人检查状态。',
      ).toBe(true);
    }
  });

  it('磁盘上出现的每种扩展名都在 --ext 里，新增 .tsx 不会静默漏检', () => {
    const parsed = parseLintScript(readScript('lint'));
    const presentExtensions = new Set<string>();
    for (const treeRoot of COVERED_ROOTS) {
      for (const absolutePath of collectTypeScriptFiles(resolve(REPO_ROOT, treeRoot))) {
        presentExtensions.add(absolutePath.endsWith('.tsx') ? '.tsx' : '.ts');
      }
    }

    for (const extension of [...presentExtensions].sort()) {
      expect(
        parsed.extensions,
        `仓库里已存在 ${extension} 文件，但 lint 脚本的 --ext 是 ${JSON.stringify(parsed.extensions)}，`
          + '这些文件会被 eslint 静默跳过。',
      ).toContain(extension);
    }
  });
});

/**
 * ESLint 的 Node API 结果的最小形状。
 *
 * `eslint` 8.x 的包内不自带类型声明（类型在未安装的 `@types/eslint` 里），因此这里用
 * `createRequire` 动态加载并把结果收窄到自己声明的结构，而不是为了一个守卫测试去新增依赖。
 */
interface EslintMessageShape {
  readonly severity: number;
  readonly ruleId: string | null;
}

interface EslintResultShape {
  readonly messages: readonly EslintMessageShape[];
}

interface EslintInstanceShape {
  isPathIgnored(filePath: string): Promise<boolean>;
  lintText(code: string, options: { readonly filePath: string }): Promise<readonly EslintResultShape[]>;
}

function createEslintInstance(): EslintInstanceShape {
  const requireFromHere = createRequire(import.meta.url);
  const eslintModule = requireFromHere('eslint') as {
    readonly ESLint: new (options: { readonly cwd: string }) => EslintInstanceShape;
  };
  return new eslintModule.ESLint({ cwd: REPO_ROOT });
}

/**
 * 取 `test/` 下每个顶层子目录的一个代表文件。
 *
 * 为什么抽代表而不是全量：`ESLint#isPathIgnored` 每次调用都要走一遍配置解析，实测单次约 1 秒，
 * 对 38 个文件全量探测要 40 秒以上，会把这套守卫拖成没人愿意跑的慢测试。
 * 忽略规则的粒度是目录（`.eslintignore` / `ignorePatterns`），因此"每个顶层子目录一个代表"
 * 足以发现"整棵子树被忽略"这一真实风险；更细粒度的漏检由下面"无忽略声明"的断言兜住。
 */
function representativeTestFiles(): string[] {
  const testRoot = resolve(REPO_ROOT, 'test');
  const representatives: string[] = [];
  for (const entry of readdirSync(testRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }
    const [first] = collectTypeScriptFiles(join(testRoot, entry.name)).sort();
    if (first !== undefined) {
      representatives.push(first);
    }
  }
  return representatives;
}

describe('G5: lint 对 test/ 目录必须真的生效（断言行为，不只是配置字符串）', () => {
  it('test/ 下每个顶层子目录的代表文件都没有被 ESLint 忽略', async () => {
    const eslint = createEslintInstance();
    const samples = representativeTestFiles();
    expect(samples.length, 'test/ 下没有可用于探测的子目录').toBeGreaterThan(0);

    const ignored: string[] = [];
    for (const absolutePath of samples) {
      if (await eslint.isPathIgnored(absolutePath)) {
        ignored.push(toComparableRelativePath(absolutePath));
      }
    }

    expect(ignored.sort(), 'ESLint 忽略了这些测试子树，它们实际上不受 lint 门禁保护').toEqual([]);
  });

  it('不存在把测试目录排除在外的忽略声明', () => {
    // 与上一条互补：上一条抽样验证行为，这一条静态排除"某个深层目录被单独忽略"的可能。
    expect(
      existsSync(resolve(REPO_ROOT, '.eslintignore')),
      '仓库新增了 .eslintignore。它可能把 test/ 的某个子树排除在 lint 之外；'
        + '若确实需要忽略，请在本断言处显式声明允许范围，而不是让忽略规则不受监视地生长。',
    ).toBe(false);

    const eslintrcSource = readFileSync(resolve(REPO_ROOT, '.eslintrc.cjs'), 'utf8');
    expect(
      /ignorePatterns/u.test(eslintrcSource),
      '.eslintrc.cjs 出现了 ignorePatterns。同上：忽略规则必须显式受监视。',
    ).toBe(false);
  });

  it('在 test/ 路径下的违规代码会被判为 error，而不是被无声放过', async () => {
    const eslint = createEslintInstance();
    // 探针只存在于内存中（该路径没有对应的磁盘文件），因此不会污染仓库，也不会被 tsc / vitest 收集。
    const [result] = await eslint.lintText('const probe = { dup: 1, dup: 2 };\nexport default probe;\n', {
      filePath: resolve(REPO_ROOT, 'test', 'toolchain', '__eslint-scope-probe__.ts'),
    });

    expect(result, 'ESLint 未对测试目录下的文件返回任何结果').toBeDefined();
    const errors = (result?.messages ?? []).filter((message) => message.severity === 2);
    expect(
      errors.map((message) => message.ruleId),
      '测试目录下的重复键没有被判为 error，说明 lint 规则对 test/ 实际上不起作用',
    ).toContain('no-dupe-keys');
  });
});

describe('G6: verify 脚本必须串联三道门禁', () => {
  it('npm run verify 依次包含 typecheck、lint、test', () => {
    const script = readScript('verify');
    for (const stage of ['typecheck', 'lint', 'test']) {
      expect(script, `verify 脚本 "${script}" 未包含 ${stage} 阶段`).toContain(stage);
    }
    expect(script.indexOf('typecheck')).toBeLessThan(script.indexOf('lint'));
  });

  it('verify:data 作为独立门禁随 verify 串联，且位列 verify:docs 之前', () => {
    // 数据可解析守卫是白盒迭代的稳定器：把"数据损坏"从运行时炸提前到静态拦。
    // 它必须先于 verify:docs（文档一致性）；如果有人把它从 verify 里摘掉或移到后面，
    // 数据损坏风险会被静默放过。
    const verify = readScript('verify');
    const jobs = ['verify:data', 'verify:docs'];
    for (const job of jobs) {
      expect(verify, `verify 脚本 "${verify}" 未包含 ${job} 阶段`).toContain(`npm run ${job}`);
    }
    expect(verify.indexOf('verify:data')).toBeLessThan(verify.indexOf('verify:docs'));
  });
});

describe('G7: 数据 JSON 静态可解析门禁在岗', () => {
  it('verify-data-json.mjs 存在且被 verify:data 引用', () => {
    const scriptPath = resolve(REPO_ROOT, 'scripts', 'verify-data-json.mjs');
    expect(existsSync(scriptPath), 'scripts/verify-data-json.mjs 必须存在').toBe(true);

    // verify:data 与 verify 都必须引用它——防止门禁被静默用别的实现替换/绕开。
    expect(readScript('verify:data')).toContain('verify-data-json.mjs');
    expect(readScript('verify')).toContain('verify:data');

    // 解析判据确实是把"严格 parse"当作硬门槛，而不是只数文件个数之类的软检查。
    const source = readFileSync(scriptPath, 'utf8');
    expect(source).toContain('JSON.parse');
    expect(source).toMatch(/process\.exit\(1\)/u);
  });
});
