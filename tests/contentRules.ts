// Spec §6 content rules as reusable checks. Used by tests/content.test.ts (static strings),
// and by later tasks for log templates (commands) and the built index.html text (e2e).

/** The only "... ago" / "... years" phrases allowed on screen (spec §6 rule 1). */
export const ALLOWED_AGE_PHRASES = ['about 2,000 years ago', 'about 100 generations ago', 'over the last 4,000 years'] as const;

const AGE_PATTERNS: [string, RegExp][] = [
  ['BCE/BC', /\bBCE?\b/],
  ['BP', /\bBP\b/],
  ['kya/ya', /\bk?ya\b/i],
  ['years/generations ago', /\b(?:years?|yrs?|generations?|centuries|millennia)\s+ago\b/i],
  ['N years (a time span)', /\b\d[\d,.]*\s*(?:years?|yrs?)\b/i],
];
const BANNED_WORDS = /\b(?:mesolithic|neolithic|pal(?:a)?eolithic|megalithic|ice age)\b/i;
// AADR Group IDs (Country_Period style, source populations) and sample IDs never reach the screen.
const GROUP_ID = /\b(?:England|Scotland|Wales|Ireland|Britain|UK|Turkey|Russia|Germany|Denmark|Netherlands|France|Spain|Italy|Norway|Sardinia)_[A-Za-z0-9_]+|\b(?:Yamnaya|Loschbour|Turkey_N)\b/;
const SAMPLE_ID = /\b(?:I\d{4,}|HG\d{5}|NA\d{5}|VK\d{2,}|[A-Z]{2,4}\d{2,}\.SG)\b/;
const BRIDGE = /^The newcomers were themselves part steppe herder, part farmer, so the steppe colour rises to \d{1,3}%, not 90%\.$/;
// Rule 3 is about the Beaker turnover figure. A bare "90%" is only that figure when the same string
// talks about replacement/turnover/the gene pool (or cites it), so a consumer bar line such as
// "British 90%" is not a violation.
const TURNOVER_CONTEXT = /replac|turnover|gene pool|Olalde|±\s*2\s*%/i;

/**
 * Returns the names of every §6 rule the text breaks (empty = clean).
 * Rule 1: ages and banned period words; Rule 1: no Group/sample IDs; Rule 2: earlier-group label;
 * Rule 3: a turnover "90%" only with "at least" (or inside the exact bridging line); Rule 8: consumer-test claims.
 */
export function ruleViolations(text: string): string[] {
  const out: string[] = [];
  let stripped = text;
  for (const ok of ALLOWED_AGE_PHRASES) stripped = stripped.split(ok).join(' ');
  for (const [name, re] of AGE_PATTERNS) if (re.test(stripped)) out.push(`rule1:${name}`);
  if (BANNED_WORDS.test(text)) out.push('rule1:banned-word');
  if (GROUP_ID.test(text)) out.push('rule1:group-id');
  if (SAMPLE_ID.test(text)) out.push('rule1:sample-id');
  if (/first farmers(?! \/ Stonehenge builders)/i.test(text)) out.push('rule2:earlier-group-label');
  if (/\b90\s*%/.test(text) && TURNOVER_CONTEXT.test(text) && !/at least 90% ± 2%/i.test(text) && !BRIDGE.test(text)) {
    out.push('rule3:90-without-at-least');
  }
  if (/23andMe/i.test(text) && /\d/.test(text.replace(/23andMe/gi, ''))) out.push('rule8:23andme-number');
  if (/AncestryDNA/i.test(text) && !/white paper/i.test(text)) out.push('rule8:ancestrydna-without-white-paper');
  return out;
}
