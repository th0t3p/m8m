// Anomaly flag detection — pure pattern matching, no ML (Phase 1).

import type {
  AnalysisResult,
  EventSeverity,
  MemoryCategory,
  MemoryEntry,
  MemoryFlag,
} from './types.js';

const INSTRUCTION_MARKERS =
  /\b(always|never|must|do not|don't|ensure|make sure|remember to)\b/i;
const INSTRUCTION_VERBS =
  /\b(respond|reply|answer|include|exclude|send|share|output|format|ignore|mention|tell|use|add|remove|avoid|note|store|save|delete|keep|remember)\b/i;

const URL_REGEX = /https?:\/\/[^\s]+/i;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const URL_REGEX_G = /https?:\/\/[^\s]+/gi;
const EMAIL_REGEX_G = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const AWS_KEY_REGEX = /AKIA[0-9A-Z]{16}/;
const GENERIC_SECRET_REGEX = /\b(sk[-_]|pk[-_]|ghp_|gho_|Bearer\s+)/i;
const PASSWORD_MENTION_REGEX = /(password|passwd|pwd)\s*(is|=|:)\s*/i;
const SECRET_KEYWORD_REGEX = /\b(key|token|secret|password|api_key|apikey|passwd)\b/i;
const LONG_TOKEN_REGEX = /\b[A-Za-z0-9_-]{20,}\b/;

const HIDDEN_CHAR_REGEX = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/;

const SUBJECT_PREFIX_REGEX =
  /^\s*(the\s+)?(user|i|he|she|they|we|it|this|that|my|his|her|their|name|age)\b/i;

const PREFERENCE_TERMS = /\b(prefer|prefers|like|likes|dislike|dislikes|favorite|favourite|default)\b/i;
const FACT_TERMS = /\b(work(s)?\s+at|live(s)?\s+in|born\s+in|name\s+is|age\s+is)\b/i;
const RELATIONSHIP_TERMS = /\b(married|partner|friend|colleague|spouse|wife|husband|parent|mother|father|sibling|boss|teammate)\b/i;
const EVENT_TERMS = /\b(meeting|deadline|appointment|schedule|scheduled|tomorrow|next week|next month)\b/i;
const DATE_PATTERN = /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/;

const RELATION_FACT_REGEX =
  /([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)\s+(is|are|works?\s+at|work\s+at|lives?\s+in|live\s+in|born\s+in|prefers?|uses?|likes?|dislikes?|name\s+is|age\s+is)\s+([^.,;]+)/g;

function now(): string {
  return new Date().toISOString();
}

function flag(type: string, detail: string, severity: EventSeverity): MemoryFlag {
  return { type, detail, detected_at: now(), severity };
}

function isInstruction(content: string): boolean {
  if (!INSTRUCTION_MARKERS.test(content) || !INSTRUCTION_VERBS.test(content)) {
    return false;
  }
  // "User prefers X" / "I like Y" are statements about a subject, not directives.
  if (SUBJECT_PREFIX_REGEX.test(content)) return false;
  return true;
}

function canonicalizePredicate(predicate: string): string {
  const p = predicate.toLowerCase().trim();
  if (p === 'are') return 'is';
  if (p === 'works at' || p === 'work at') return 'work at';
  if (p === 'lives in' || p === 'live in') return 'live in';
  if (p === 'prefers') return 'prefer';
  if (p === 'uses') return 'use';
  if (p === 'likes') return 'like';
  if (p === 'dislikes') return 'dislike';
  return p;
}

interface EntityFact {
  entity: string;
  predicate: string;
  value: string;
}

function extractEntityFacts(content: string): EntityFact[] {
  const facts: EntityFact[] = [];
  for (const m of content.matchAll(RELATION_FACT_REGEX)) {
    facts.push({
      entity: m[1].trim(),
      predicate: canonicalizePredicate(m[2]),
      value: m[3].trim(),
    });
  }
  return facts;
}

/** Extract named-entity-ish strings (emails, URLs, proper-noun phrases). */
export function extractEntities(content: string): string[] {
  const entities = new Set<string>();
  for (const m of content.matchAll(EMAIL_REGEX_G)) entities.add(m[0]);
  for (const m of content.matchAll(URL_REGEX_G)) entities.add(m[0]);
  for (const m of content.matchAll(RELATION_FACT_REGEX)) {
    const entity = m[1].trim();
    if (entity.length > 1 && !/^(the|this|that|my|our|their|his|her)$/i.test(entity)) {
      entities.add(entity);
    }
  }
  // Also capture standalone capitalized tokens that aren't sentence-initial.
  for (const m of content.matchAll(/\b([A-Z][a-z]{1,}(?:[A-Z][a-z]+)*)\b/g)) {
    const token = m[1];
    if (token.length > 2 && !/^(The|This|That|User|I|He|She|They|We|It)$/.test(token)) {
      entities.add(token);
    }
  }
  return [...entities].slice(0, 20);
}

export function classifyCategory(
  content: string,
  flags: MemoryFlag[],
): MemoryCategory {
  if (flags.some((f) => f.type === 'contains_credential')) return 'credential';
  if (flags.some((f) => f.type === 'contains_instruction')) return 'instruction';
  if (RELATIONSHIP_TERMS.test(content)) return 'relationship';
  if (FACT_TERMS.test(content)) return 'fact';
  if (PREFERENCE_TERMS.test(content)) return 'preference';
  if (EVENT_TERMS.test(content) || DATE_PATTERN.test(content)) return 'event';
  return 'unknown';
}

/**
 * Analyze memory content and produce flags, category, entities, and a 0-1
 * anomaly score. `sourceType`/`sourcePlatform` enable the source-unknown rule.
 */
export function analyzeEntry(
  content: string,
  existingMemories: MemoryEntry[] = [],
  sourceType?: string,
  sourcePlatform?: string,
  context?: { parent_heading?: string; node_type?: string },
): AnalysisResult {
  const flags: MemoryFlag[] = [];

  // 1. Instruction detection (warning)
  if (isInstruction(content)) {
    flags.push(
      flag(
        'contains_instruction',
        'Reads as a directive to the AI rather than a fact about the user',
        'warning',
      ),
    );
  }

  const hasUrl = URL_REGEX.test(content);
  const hasEmail = EMAIL_REGEX.test(content);
  const instructionContext = isInstruction(content);
  // URLs/emails inside code blocks are usually illustrative, not suspicious.
  const inCodeBlock = context?.node_type === 'code_block';

  // 2. URL detection
  if (hasUrl) {
    const url = content.match(URL_REGEX)?.[0] ?? '';
    const severity = instructionContext && !inCodeBlock ? 'warning' : 'info';
    flags.push(
      flag(
        'contains_url',
        `URL detected${instructionContext ? ' alongside an instruction' : ''}: ${url}`,
        severity,
      ),
    );
  }

  // 3. Email detection
  if (hasEmail) {
    const email = content.match(EMAIL_REGEX)?.[0] ?? '';
    const severity = instructionContext && !inCodeBlock ? 'warning' : 'info';
    flags.push(
      flag(
        'contains_email',
        `Email detected${instructionContext ? ' alongside an instruction' : ''}: ${email}`,
        severity,
      ),
    );
  }

  // 4. Credential detection (critical)
  const credMatches: string[] = [];
  if (AWS_KEY_REGEX.test(content)) credMatches.push('AWS access key');
  if (GENERIC_SECRET_REGEX.test(content)) {
    const m = content.match(GENERIC_SECRET_REGEX)?.[0] ?? '';
    credMatches.push(`secret token pattern (${m.trim()})`);
  }
  if (PASSWORD_MENTION_REGEX.test(content)) credMatches.push('password mention');
  if (SECRET_KEYWORD_REGEX.test(content) && LONG_TOKEN_REGEX.test(content)) {
    credMatches.push('long token near secret keyword');
  }
  if (credMatches.length > 0) {
    flags.push(
      flag('contains_credential', `Possible credential: ${credMatches.join(', ')}`, 'critical'),
    );
  }

  // 5. Contradiction detection (warning)
  if (existingMemories.length > 0) {
    const newFacts = extractEntityFacts(content);
    for (const existing of existingMemories) {
      if (existing.content === content) continue;
      const existingFacts = extractEntityFacts(existing.content);
      for (const nf of newFacts) {
        for (const ef of existingFacts) {
          if (
            nf.entity.toLowerCase() === ef.entity.toLowerCase() &&
            nf.predicate === ef.predicate &&
            nf.value.toLowerCase() !== ef.value.toLowerCase()
          ) {
            flags.push(
              flag(
                'contradicts_existing',
                `"${nf.entity} ${nf.predicate} ${nf.value}" conflicts with an existing memory ("${ef.value}")`,
                'warning',
              ),
            );
          }
        }
      }
    }
  }

  // 6. Source unknown (info)
  if (sourceType === 'unknown' || sourcePlatform === 'unknown') {
    flags.push(
      flag(
        'source_unknown',
        'Memory has an unknown or missing provenance source',
        'info',
      ),
    );
  }

  // 7. Hidden character detection (warning)
  if (HIDDEN_CHAR_REGEX.test(content)) {
    flags.push(
      flag(
        'hidden_character',
        'Content contains zero-width, bidi-override, or homoglyph characters',
        'warning',
      ),
    );
  }

  // Deduplicate flags by type + detail (contradiction can emit duplicates).
  const seen = new Set<string>();
  const deduped = flags.filter((f) => {
    const key = `${f.type}|${f.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const category = classifyCategory(content, deduped);
  const entities = extractEntities(content);
  const anomaly_score = Math.min(1, computeAnomalyScore(deduped));

  return { flags: deduped, category, entities, anomaly_score };
}

const FLAG_WEIGHTS: Record<string, number> = {
  contains_credential: 0.6,
  hidden_character: 0.4,
  contains_instruction: 0.3,
  contradicts_existing: 0.3,
  contains_url: 0.15,
  contains_email: 0.15,
  source_unknown: 0.2,
};

function computeAnomalyScore(flags: MemoryFlag[]): number {
  let score = 0;
  for (const f of flags) {
    const base = FLAG_WEIGHTS[f.type] ?? 0.1;
    if (f.severity === 'warning') score += base + 0.05;
    else if (f.severity === 'critical') score += base + 0.1;
    else score += base;
  }
  return Math.round(Math.min(1, score) * 1000) / 1000;
}
