import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it, expect } from 'vitest';
// @ts-expect-error The executable ESM helper has no generated declaration file.
import { discoverCharacters, registerCharacters } from '../../scripts/asset-pipeline/register-character-assets.mjs';

let sourceRoot: string;
const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,0x49,0x48,0x44,0x52,0,0,0,1,0,0,0,1,8,6,0,0,0,0x1f,0x15,0xc4,0x89,0,0,0,0]);

beforeEach(() => { sourceRoot = mkdtempSync(join(tmpdir(), 'char-register-source-')); });

function writeRole(root: string, name: string, { missingFrame }: { missingFrame?: string } = {}) {
  const rolePath = join(root, name);
  mkdirSync(join(rolePath, 'frames'), { recursive: true });
  for (let i = 1; i <= 16; i += 1) {
    const frame = `f${String(i).padStart(2, '0')}`;
    if (frame === missingFrame) continue;
    writeFileSync(join(rolePath, 'frames', `${frame}.png`), png);
  }
  writeFileSync(join(rolePath, 'sheet.png'), png);
  writeFileSync(join(rolePath, 'meta.json'), JSON.stringify({ source: 'x.png', size: 128, colors: 32 }));
}

describe('register-character-assets.mjs', () => {
  it('发现子目录并忽略根级文件', () => {
    writeRole(sourceRoot, '侦探');
    writeRole(sourceRoot, 'mercenary');
    writeFileSync(join(sourceRoot, 'stray.png'), 'png');
    expect(discoverCharacters(sourceRoot).map((c: { id: string }) => c.id)).toEqual(['侦探', 'mercenary']);
  });

  it('缺帧或损坏 PNG 时失败', () => {
    writeRole(sourceRoot, 'badrole', { missingFrame: 'f09' });
    expect(() => discoverCharacters(sourceRoot)).toThrow(/missing f09/);
    sourceRoot = mkdtempSync(join(tmpdir(), 'char-register-source-'));
    writeRole(sourceRoot, 'broken');
    writeFileSync(join(sourceRoot, 'broken', 'frames', 'f01.png'), 'not png');
    expect(() => discoverCharacters(sourceRoot)).toThrow(/invalid PNG/);
  });

  it('复制完整角色并生成 manifest 与 registry', () => {
    writeRole(sourceRoot, 'cpd特工');
    const output = mkdtempSync(join(tmpdir(), 'char-register-out-'));
    const { registry } = registerCharacters({ source: sourceRoot, output });
    const entry = registry.entries[0];
    expect(entry.id).toBe('cpd特工');
    expect(readdirSync(join(output, entry.id, 'frames'))).toHaveLength(16);
    expect(existsSync(join(output, entry.id, 'manifest.json'))).toBe(true);
    expect(readFileSync(join(output, 'registry.json'), 'utf8')).toContain('wakeup-character-registry');
    expect(entry.frames[0].path).toBe(`characters/${entry.id}/frames/f01.png`);
  });

  it('dry-run 不写输出目录且重复注册字节稳定', () => {
    writeRole(sourceRoot, 'a');
    const output = join(mkdtempSync(join(tmpdir(), 'char-register-out-')), 'nested');
    expect(registerCharacters({ source: sourceRoot, output, dryRun: true }).registry.entries).toHaveLength(1);
    expect(existsSync(output)).toBe(false);
    registerCharacters({ source: sourceRoot, output });
    const first = readFileSync(join(output, 'registry.json'), 'utf8');
    registerCharacters({ source: sourceRoot, output });
    expect(readFileSync(join(output, 'registry.json'), 'utf8')).toBe(first);
  });
});
