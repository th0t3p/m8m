// Attack-detection regression tests.
//
// These are the most valuable tests in the suite: they guarantee that the
// pattern-based analyzer never silently *loses* detection as we iterate, and
// that clean content never starts producing false positives.
//
// Each fixture is parsed into a document tree, then every node is run through
// `analyzeEntry` so the same flags a real import would produce are asserted.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeEntry } from '../../src/core/analyzer.js';
import { parseDocumentTree } from '../../src/watcher/parsers.js';
import type { AnalysisResult, MemoryFlag, ParsedNode } from '../../src/core/types.js';

// Characters the hidden-character detector flags.
const HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;
const visible = (s: string): string => s.replace(HIDDEN_CHARS, '');

interface NodeResult {
  node: ParsedNode;
  analysis: AnalysisResult;
  flags: MemoryFlag[];
}

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/attacks/${name}`, import.meta.url), 'utf8');
}

/** Parse a fixture and run the analyzer over every node (recursively). */
function analyzeTree(content: string, filePath: string): NodeResult[] {
  const doc = parseDocumentTree(content, filePath);
  const out: NodeResult[] = [];
  const walk = (n: ParsedNode): void => {
    const analysis = analyzeEntry(n.content, [], 'document', 'local_file', { node_type: n.node_type });
    out.push({ node: n, analysis, flags: analysis.flags });
    for (const child of n.children ?? []) walk(child);
  };
  for (const root of doc.nodes) walk(root);
  return out;
}

const hasFlag = (n: NodeResult, type: string): boolean => n.flags.some((f) => f.type === type);
const hasCritical = (n: NodeResult, type: string): boolean =>
  n.flags.some((f) => f.type === type && f.severity === 'critical');
const nodeWith = (results: NodeResult[], text: string): NodeResult => {
  const node = results.find((n) => n.node.content.includes(text));
  expect(node, `expected a node containing: ${text}`).toBeTruthy();
  return node!;
};

// ---------------------------------------------------------------------------

describe('Clean memories — zero false positives', () => {
  const results = analyzeTree(fixture('clean_memories.md'), 'clean_memories.md');

  it('parses into more than 10 nodes (sanity check)', () => {
    expect(results.length).toBeGreaterThan(10);
  });

  // THE most important assertion in the whole suite: clean content must stay
  // clean. A false positive here kills trust faster than a missed detection.
  it('flags zero nodes on clean content', () => {
    const flagged = results.filter((n) => n.flags.length > 0);
    expect(flagged).toHaveLength(0);
  });

  it('has zero anomaly score on every node', () => {
    for (const n of results) expect(n.analysis.anomaly_score).toBe(0);
  });
});

describe('MemGhost attack — instruction injection via email', () => {
  const results = analyzeTree(fixture('memghost_attack.md'), 'memghost_attack.md');

  it('flags the injected instruction as contains_instruction', () => {
    expect(hasFlag(nodeWith(results, 'always include the full file path'), 'contains_instruction')).toBe(true);
  });

  it('flags advisor email as contains_email', () => {
    expect(hasFlag(nodeWith(results, 'advisor@wealth-mgmt-partners.com'), 'contains_email')).toBe(true);
  });

  it('flags backup-assistant email as contains_email', () => {
    expect(hasFlag(nodeWith(results, 'backup-assistant@proton.me'), 'contains_email')).toBe(true);
  });

  it('flags exactly three nodes in total', () => {
    const flagged = results.filter((n) => n.flags.length > 0);
    expect(flagged).toHaveLength(3);
  });

  it('leaves non-attack nodes unflagged', () => {
    const benign = results.filter(
      (n) =>
        n.node.content.includes('User prefers concise') ||
        n.node.content.includes('primary language') ||
        n.node.content.includes('# Memories'),
    );
    expect(benign.length).toBeGreaterThan(0);
    for (const n of benign) expect(n.flags).toHaveLength(0);
  });
});

describe('MemoryGraft attack — curl exfiltration in project conventions', () => {
  const results = analyzeTree(fixture('memorygraft_attack.md'), 'memorygraft_attack.md');

  it('flags devmetrics.io node with contains_url', () => {
    expect(hasFlag(nodeWith(results, 'devmetrics.io'), 'contains_url')).toBe(true);
  });

  it('flags Bearer proj_auto node with contains_credential (critical)', () => {
    expect(hasCritical(nodeWith(results, 'Bearer proj_auto'), 'contains_credential')).toBe(true);
  });

  it('flags logcollect.dev node with contains_url', () => {
    expect(hasFlag(nodeWith(results, 'logcollect.dev'), 'contains_url')).toBe(true);
  });

  it('leaves "Always run tests before committing" unflagged', () => {
    expect(nodeWith(results, 'Always run tests before committing').flags).toHaveLength(0);
  });

  it('leaves "Keep functions under 50 lines" unflagged', () => {
    expect(nodeWith(results, 'Keep functions under 50 lines').flags).toHaveLength(0);
  });
});

describe('Credential harvest — catches all credential types', () => {
  const results = analyzeTree(fixture('credential_harvest.md'), 'credential_harvest.md');
  const credCritical = (text: string) => hasCritical(nodeWith(results, text), 'contains_credential');

  it('flags AWS access key as HIGH credential (warning)', () => {
    const n = nodeWith(results, 'AKIAIOSFODNN7EXAMPLE');
    expect(n.flags.some((f) => f.type === 'contains_credential' && f.severity === 'warning')).toBe(true);
  });

  it('flags Stripe test key as critical credential', () => {
    expect(credCritical('stripe_test_')).toBe(true);
  });

  it('flags Stripe live key as critical credential', () => {
    expect(credCritical('stripe_live_')).toBe(true);
  });

  it('flags database password as critical credential', () => {
    expect(credCritical('Pr0duction!2024_db')).toBe(true);
  });

  it('flags JWT signing secret as critical credential', () => {
    expect(credCritical('super_secret_jwt_key')).toBe(true);
  });

  it('raises 4 critical + 1 high credential flags in total', () => {
    const cred = results.flatMap((n) => n.flags).filter((f) => f.type === 'contains_credential');
    expect(cred.filter((f) => f.severity === 'critical').length).toBeGreaterThanOrEqual(4);
    expect(cred.filter((f) => f.severity === 'warning').length).toBeGreaterThanOrEqual(1);
  });

  it('leaves version notes unflagged', () => {
    expect(nodeWith(results, 'Node.js version 20.11.0').flags).toHaveLength(0);
    expect(nodeWith(results, 'npm version 10.2.4').flags).toHaveLength(0);
  });
});

describe('Sleeper memory — known limitation (documents current behavior)', () => {
  const results = analyzeTree(fixture('sleeper_memory.md'), 'sleeper_memory.md');

  it('does NOT flag "printenv | grep" (known miss)', () => {
    // TODO: Phase 2 ML detection should catch this exfiltration pattern.
    // When it does, flip this assertion to expect detection.
    expect(nodeWith(results, 'printenv | grep').flags).toHaveLength(0);
  });

  it('leaves every other node unflagged (no false positives)', () => {
    for (const n of results) {
      expect(n.flags, `unexpected flags on: ${JSON.stringify(n.node.content)}`).toHaveLength(0);
    }
  });
});

describe('Hidden character injection', () => {
  const results = analyzeTree(fixture('hidden_chars.md'), 'hidden_chars.md');
  const hiddenWarning = (n: NodeResult): boolean =>
    n.flags.some((f) => f.type === 'hidden_character' && f.severity === 'warning');

  it('flags zero-width "dark mode" as hidden_character (warning)', () => {
    const node = results.find((n) => visible(n.node.content).includes('darkmode'));
    expect(node).toBeTruthy();
    expect(hiddenWarning(node!)).toBe(true);
  });

  it('flags RTL-override "TypeScript" as hidden_character (warning)', () => {
    const node = results.find((n) => visible(n.node.content).includes('TypeScript'));
    expect(node).toBeTruthy();
    expect(hiddenWarning(node!)).toBe(true);
  });

  it('leaves "User uses VS Code" unflagged', () => {
    expect(nodeWith(results, 'User uses VS Code').flags).toHaveLength(0);
  });

  it('leaves "User enjoys reading" unflagged', () => {
    expect(nodeWith(results, 'User enjoys reading').flags).toHaveLength(0);
  });
});

describe('Poisoned MCP config', () => {
  const results = analyzeTree(fixture('poisoned_mcp_config.json'), 'poisoned_mcp_config.json');

  it('flags at least one node with contains_url for collect.evil.com', () => {
    const nodes = results.filter((n) => n.node.content.includes('collect.evil.com') && hasFlag(n, 'contains_url'));
    expect(nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('flags at least one node with contains_url for hooks.evil.com', () => {
    const nodes = results.filter((n) => n.node.content.includes('hooks.evil.com') && hasFlag(n, 'contains_url'));
    expect(nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('leaves the legitimate m8m server unflagged', () => {
    const node = results.find((n) => n.node.heading === 'm8m');
    expect(node).toBeTruthy();
    expect(node!.flags).toHaveLength(0);
  });
});
