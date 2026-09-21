// Terminal output formatting primitives.
//
// Small, centralized helpers so every m8m command shares the same visual
// language: a 2-space indent, a 45-char `─` separator, and Unicode status
// icons. Color is disabled when NO_COLOR is set or `--no-color` is passed.

import chalk from 'chalk';

const WIDTH = 45;
const INDENT = '  ';

// Respect NO_COLOR and --no-color. chalk v5 also auto-detects TTY/NO_COLOR,
// but forcing level=0 guarantees plain output in CI/pipes too.
if (process.env.NO_COLOR !== undefined || process.argv.includes('--no-color')) {
  chalk.level = 0;
}

export type StatStyle = 'dim' | 'warn' | 'plain';

/** Current terminal width (fallback 80). */
export function termWidth(): number {
  return process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
}

/** `m8m — Title` header with a dim `─` rule underneath. */
export function header(title: string): string {
  return `${chalk.bold.white(`${INDENT}m8m — ${title}`)}\n${separator()}`;
}

/** A dim `─` rule, 45 chars wide, indented. */
export function separator(): string {
  return chalk.dim(`${INDENT}${'─'.repeat(WIDTH)}`);
}

/** Truncate a path, keeping the tail (the filename) intact. */
export function truncatePath(path: string, max: number): string {
  if (path.length <= max) return path;
  return `…${path.slice(path.length - (max - 1))}`;
}

/** Left/right pad a string to a column width (Unicode-aware-ish). */
export function pad(s: string, width: number, right = false): string {
  const len = [...s].length;
  return right ? s.padStart(width - (s.length - len)) : s.padEnd(width - (s.length - len));
}

export function success(text: string): string {
  return `${INDENT}${chalk.green('✓')} ${text}`;
}

export function skipped(text: string): string {
  return `${INDENT}${chalk.dim('○')} ${chalk.dim(text)}`;
}

export function inProgress(text: string): string {
  return `${INDENT}${chalk.cyan('◐')} ${chalk.dim(text)}`;
}

export function watching(text: string): string {
  return `${INDENT}${chalk.cyan('●')} ${chalk.dim(text)}`;
}

export function dim(text: string): string {
  return `${INDENT}${chalk.dim(text)}`;
}

export function warn(text: string): string {
  return `${INDENT}${chalk.yellow('⚠')} ${text}`;
}

export function critical(text: string): string {
  return `${INDENT}${chalk.red.bold('🔴')} ${chalk.red.bold(text)}`;
}

export function info(text: string): string {
  return `${INDENT}${chalk.blue('ℹ')} ${text}`;
}

/** Summary footer: `─` rule + `Label  stat · stat · stat`. */
export function summary(label: string, stats: Array<{ text: string; style?: StatStyle }>): string {
  const parts = stats.map((s) => {
    if (s.style === 'warn') return chalk.yellow(s.text);
    if (s.style === 'plain') return s.text;
    return chalk.dim(s.text);
  });
  return `${separator()}\n${chalk.bold.white(`${INDENT}${label}`)}  ${parts.join(' · ')}`;
}
