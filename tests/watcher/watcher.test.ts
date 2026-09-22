import { describe, expect, it } from 'vitest';
import {
  firstAddedLine,
  firstRemovedLine,
  flagLabel,
  maskAddedLine,
  topFlag,
} from '../../src/watcher/watcher.js';
import type { MemoryFlag } from '../../src/core/types.js';

describe('firstAddedLine', () => {
  it('returns the first line present in new but not old', () => {
    expect(firstAddedLine('a\nb', 'a\nb\nc')).toBe('c');
  });

  it('returns empty when nothing was added', () => {
    expect(firstAddedLine('a\nb', 'a\nb')).toBe('');
  });

  it('handles brand-new content', () => {
    expect(firstAddedLine('', 'hello')).toBe('hello');
  });
});

describe('firstRemovedLine', () => {
  it('returns the first line present in old but not new', () => {
    expect(firstRemovedLine('a\nb\nc', 'a')).toBe('b');
  });

  it('returns empty when nothing was removed', () => {
    expect(firstRemovedLine('a\nb', 'a\nb')).toBe('');
  });

  it('handles content reduced to nothing', () => {
    expect(firstRemovedLine('hello', '')).toBe('hello');
  });
});

describe('flagLabel', () => {
  it('humanizes known flag types', () => {
    expect(flagLabel('contains_credential')).toBe('credential detected');
    expect(flagLabel('contains_email')).toBe('email detected');
    expect(flagLabel('contains_instruction')).toBe('instruction detected');
  });

  it('falls back to the raw type', () => {
    expect(flagLabel('weird_type')).toBe('weird_type');
  });
});

describe('maskAddedLine', () => {
  it('masks sk_ secrets', () => {
    const out = maskAddedLine('key is sk_example_abcdefghijklmnop');
    expect(out).toContain('sk_exa****');
    expect(out).not.toContain('abcdefghijklmnop');
  });

  it('masks AWS access keys', () => {
    const out = maskAddedLine('AKIAIOSFODNN7EXAMPLE');
    expect(out).toContain('****');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('masks emails', () => {
    const out = maskAddedLine('contact jane@example.com');
    expect(out).toContain('ja****@example.com');
    expect(out).not.toContain('jane@example.com');
  });

  it('leaves benign text untouched', () => {
    expect(maskAddedLine('just a normal line')).toBe('just a normal line');
  });
});

describe('topFlag', () => {
  const f = (severity: MemoryFlag['severity'], type = 'x'): MemoryFlag => ({
    type,
    detail: '',
    detected_at: '',
    severity,
  });

  it('returns the most severe flag', () => {
    const top = topFlag([f('info'), f('critical'), f('warning')]);
    expect(top?.severity).toBe('critical');
  });

  it('returns null for an empty flag list', () => {
    expect(topFlag([])).toBeNull();
  });
});
