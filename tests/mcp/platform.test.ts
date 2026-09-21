import { afterEach, describe, expect, it } from 'vitest';
import { detectPlatform, setClientPlatform } from '../../src/mcp/handlers.js';

// detectPlatform() reads module-level clientPlatform (set via
// setClientPlatform), then M8M_PLATFORM, then environment sniffing. Keep env
// mutations contained and restore the original object in-place.
const SAVED_ENV = { ...process.env };

function envOf(env: Record<string, string>): void {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, { PATH: '/usr/bin', ...env });
}

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, SAVED_ENV);
});

describe('detectPlatform env sniffing', () => {
  it('detects each harness by its env token', () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ CODEBUDDY_HOME: 'x' }, 'codebuddy'],
      [{ WINDSURF_API_KEY: 'x' }, 'windsurf'],
      [{ CODEIUM_TOKEN: 'x' }, 'windsurf'],
      [{ CLINE_API_KEY: 'x' }, 'cline'],
      [{ CODEX_HOME: 'x' }, 'codex'],
      [{ AIDER_MODEL: 'x' }, 'aider'],
      [{ GITHUB_COPILOT: '1' }, 'copilot'],
      [{ CONTINUE_API_KEY: 'x' }, 'continue_dev'],
      [{ GEMINI_API_KEY: 'x' }, 'gemini'],
      [{ ZED_AI: '1' }, 'zed'],
      [{ TRAE_HOME: 'x' }, 'trae'],
      [{ GOOSE_API_KEY: 'x' }, 'goose'],
      [{ QODER_API_KEY: 'x' }, 'qoder'],
      [{ DSH_HOME: 'x' }, 'dsh'],
      [{ CLAUDE_CODE_ENTRYPOINT: 'x' }, 'claude_code'],
      [{ CLAUDE_DESKTOP: '1' }, 'claude_desktop'],
      [{ CURSOR: '1' }, 'cursor'],
    ];
    for (const [env, expected] of cases) {
      envOf(env);
      expect(detectPlatform()).toBe(expected);
    }
  });

  it('defaults to unknown without any token', () => {
    envOf({});
    expect(detectPlatform()).toBe('unknown');
  });

  // Regression: this machine's DSH env also inherits CLAUDE_CODE_* vars, and
  // the old keyword order let `claude` win over `dsh` (dsh was listed last).
  it('prefers dsh when DSH_* and CLAUDE_CODE_* coexist', () => {
    envOf({ DSH_HOME: 'x', CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'y', ANTHROPIC_MODEL: 'z' });
    expect(detectPlatform()).toBe('dsh');
  });
});

describe('setClientPlatform', () => {
  it('stores the self-reported name verbatim (lowercased)', () => {
    const cases: Array<[string, string]> = [
      ['CodeBuddy', 'codebuddy'],
      ['Windsurf', 'windsurf'],
      ['Cline', 'cline'],
      ['codex-cli', 'codex-cli'],
      ['Aider', 'aider'],
      ['github-copilot', 'github-copilot'],
      ['Continue', 'continue'],
      ['gemini-cli', 'gemini-cli'],
      ['Zed', 'zed'],
      ['Trae', 'trae'],
      ['Goose', 'goose'],
      ['Qoder', 'qoder'],
      ['Claude Code', 'claude code'],
      ['claude-desktop', 'claude-desktop'],
      ['Cursor', 'cursor'],
      ['DeepSeek Harness', 'deepseek harness'],
      ['ChatGPT', 'chatgpt'],
    ];
    for (const [name, expected] of cases) {
      setClientPlatform(name);
      expect(detectPlatform()).toBe(expected);
    }
  });
});
