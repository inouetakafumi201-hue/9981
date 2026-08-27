/**
 * L2 Model: SourceSpan Tests
 *
 * 验证精确 UTF-8 字节映射和源内容哈希的正确性
 */

import { describe, it, expect } from 'vitest';
import {
  validateSourceSpan,
  mergeSourceSpans,
  type SourceSpan,
} from '../../model/source';

describe('validateSourceSpan', () => {
  it('accepts valid span', () => {
    const span: SourceSpan = {
      startLine: 1,
      startColumn: 0,
      startByteOffset: 0,
      endLine: 1,
      endColumn: 10,
      endByteOffset: 10,
      sourceSliceHash: 'a'.repeat(64), // Valid SHA-256 hex
    };
    expect(validateSourceSpan(span)).toHaveLength(0);
  });

  it('rejects startLine > endLine', () => {
    const span: SourceSpan = {
      startLine: 5,
      startColumn: 0,
      startByteOffset: 0,
      endLine: 2,
      endColumn: 10,
      endByteOffset: 50,
      sourceSliceHash: 'a'.repeat(64),
    };
    const issues = validateSourceSpan(span);
    expect(issues).toContain('startLine must be <= endLine');
  });

  it('rejects startColumn > endColumn on same line', () => {
    const span: SourceSpan = {
      startLine: 1,
      startColumn: 20,
      startByteOffset: 20,
      endLine: 1,
      endColumn: 10,
      endByteOffset: 10,
      sourceSliceHash: 'a'.repeat(64),
    };
    const issues = validateSourceSpan(span);
    expect(issues).toContain('on same line, startColumn must be <= endColumn');
  });

  it('allows different columns on different lines', () => {
    const span: SourceSpan = {
      startLine: 1,
      startColumn: 20,
      startByteOffset: 20,
      endLine: 3,
      endColumn: 5,
      endByteOffset: 100,
      sourceSliceHash: 'a'.repeat(64),
    };
    const issues = validateSourceSpan(span);
    expect(issues).not.toContain('column');
  });

  it('rejects startByteOffset > endByteOffset', () => {
    const span: SourceSpan = {
      startLine: 1,
      startColumn: 0,
      startByteOffset: 50,
      endLine: 2,
      endColumn: 10,
      endByteOffset: 40,
      sourceSliceHash: 'a'.repeat(64),
    };
    const issues = validateSourceSpan(span);
    expect(issues).toContain('startByteOffset must be <= endByteOffset');
  });

  it('rejects invalid sourceSliceHash format', () => {
    const span: SourceSpan = {
      startLine: 1,
      startColumn: 0,
      startByteOffset: 0,
      endLine: 1,
      endColumn: 10,
      endByteOffset: 10,
      sourceSliceHash: 'invalid_hash', // Not 64 hex chars
    };
    const issues = validateSourceSpan(span);
    expect(issues).toContain('sourceSliceHash must be a 64-character hex string (SHA-256)');
  });

  it('rejects sourceSliceHash with non-hex characters', () => {
    const span: SourceSpan = {
      startLine: 1,
      startColumn: 0,
      startByteOffset: 0,
      endLine: 1,
      endColumn: 10,
      endByteOffset: 10,
      sourceSliceHash: 'Z'.repeat(64), // 'Z' is not in [a-f0-9]
    };
    const issues = validateSourceSpan(span);
    expect(issues).toContain('sourceSliceHash must be a 64-character hex string (SHA-256)');
  });

  it('rejects sourceSliceHash with uppercase letters', () => {
    const span: SourceSpan = {
      startLine: 1,
      startColumn: 0,
      startByteOffset: 0,
      endLine: 1,
      endColumn: 10,
      endByteOffset: 10,
      sourceSliceHash: 'ABCDEF0123456789'.padEnd(64, '0'), // Contains uppercase
    };
    const issues = validateSourceSpan(span);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('rejects sourceSliceHash with incorrect length', () => {
    const shortHash: SourceSpan = {
      startLine: 1,
      startColumn: 0,
      startByteOffset: 0,
      endLine: 1,
      endColumn: 10,
      endByteOffset: 10,
      sourceSliceHash: 'a'.repeat(32), // Only 32 chars
    };
    expect(validateSourceSpan(shortHash)).toContain('sourceSliceHash must be a 64-character hex string (SHA-256)');

    const longHash: SourceSpan = {
      startLine: 1,
      startColumn: 0,
      startByteOffset: 0,
      endLine: 1,
      endColumn: 10,
      endByteOffset: 10,
      sourceSliceHash: 'a'.repeat(128), // 128 chars
    };
    expect(validateSourceSpan(longHash)).toContain('sourceSliceHash must be a 64-character hex string (SHA-256)');
  });
});

describe('mergeSourceSpans', () => {
  it('merges two spans on same line correctly', () => {
    const a: SourceSpan = {
      startLine: 1,
      startColumn: 5,
      startByteOffset: 5,
      endLine: 1,
      endColumn: 10,
      endByteOffset: 10,
      sourceSliceHash: 'a'.repeat(64),
    };
    const b: SourceSpan = {
      startLine: 1,
      startColumn: 8,
      startByteOffset: 8,
      endLine: 1,
      endColumn: 15,
      endByteOffset: 15,
      sourceSliceHash: 'b'.repeat(64),
    };

    const merged = mergeSourceSpans(a, b);
    expect(merged.startLine).toBe(1);
    expect(merged.startColumn).toBe(5);
    expect(merged.startByteOffset).toBe(5);
    expect(merged.endLine).toBe(1);
    expect(merged.endColumn).toBe(15);
    expect(merged.endByteOffset).toBe(15);
  });

  it('merges two spans on different lines correctly', () => {
    const a: SourceSpan = {
      startLine: 1,
      startColumn: 5,
      startByteOffset: 5,
      endLine: 2,
      endColumn: 10,
      endByteOffset: 50,
      sourceSliceHash: 'a'.repeat(64),
    };
    const b: SourceSpan = {
      startLine: 2,
      startColumn: 8,
      startByteOffset: 48,
      endLine: 3,
      endColumn: 15,
      endByteOffset: 100,
      sourceSliceHash: 'b'.repeat(64),
    };

    const merged = mergeSourceSpans(a, b);
    expect(merged.startLine).toBe(1);
    expect(merged.startByteOffset).toBe(5);
    expect(merged.endLine).toBe(3);
    expect(merged.endByteOffset).toBe(100);
  });

  it('preserves hash from first span', () => {
    const a: SourceSpan = {
      startLine: 1,
      startColumn: 0,
      startByteOffset: 0,
      endLine: 1,
      endColumn: 10,
      endByteOffset: 10,
      sourceSliceHash: 'aaaa' + 'a'.repeat(60),
    };
    const b: SourceSpan = {
      startLine: 1,
      startColumn: 5,
      startByteOffset: 5,
      endLine: 1,
      endColumn: 15,
      endByteOffset: 15,
      sourceSliceHash: 'bbbb' + 'b'.repeat(60),
    };

    const merged = mergeSourceSpans(a, b);
    expect(merged.sourceSliceHash).toBe(a.sourceSliceHash);
  });

  it('handles non-overlapping spans', () => {
    const a: SourceSpan = {
      startLine: 1,
      startColumn: 0,
      startByteOffset: 0,
      endLine: 1,
      endColumn: 5,
      endByteOffset: 5,
      sourceSliceHash: 'a'.repeat(64),
    };
    const b: SourceSpan = {
      startLine: 2,
      startColumn: 0,
      startByteOffset: 20,
      endLine: 2,
      endColumn: 5,
      endByteOffset: 25,
      sourceSliceHash: 'b'.repeat(64),
    };

    const merged = mergeSourceSpans(a, b);
    expect(merged.startLine).toBe(1);
    expect(merged.endLine).toBe(2);
    expect(merged.startByteOffset).toBe(0);
    expect(merged.endByteOffset).toBe(25);
  });
});
