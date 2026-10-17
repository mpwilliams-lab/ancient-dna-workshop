// Spec §6 content rules (v2.1, as changed by v3 §9) as reusable checks. Used by tests/content.test.ts (static strings),
// by later tasks for log templates (commands) and cards, and by the e2e scan of the built page's text (e2e/helpers.ts).

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
// Rule 3 (v3 §9): a string talks about the Beaker turnover when it mentions replacement, turnover, the gene pool or cites
// Olalde. In that context a "90%" may never appear on screen, and every "9 in 10" must read "at least 9 in 10" or
// "more than 9 in 10". A consumer bar line such as "British 90%" has no turnover context, so it is not a violation.
const TURNOVER_CONTEXT = /replac|turnover|gene pool|Olalde|±\s*2\s*%/i;
const QUALIFIED_NINE_IN_TEN = /\b(?:at least|more than) 9 in 10\b/gi;
// The v2.1 bridge line ("... so the steppe colour rises to 64%, not 90%.") is deleted everywhere (v3 §3.2).
const BRIDGE_LINE = /\bsteppe colou?r rises to \d{1,3}\s*%,? not 90\s*%/i;
// Rule 11 (v3 §9): the modern sample is "Britain today", never "modern England" or "England today". The approved G1 text
// says "people in England today carry ...", a statement about people living in England, so "in England today" is allowed.
const ENGLAND_FOR_BRITAIN_TODAY = /\bmodern England\b|(?<!\bin )\bEngland today\b/i;
// Rule 14 (v3 §3, §9): no paternity or Y-chromosome-mismatch content on screen.
const NEVER_ON_SCREEN = /paternity|illegitim|affair|mismatch/i;

/**
 * Returns the names of every rule the text breaks (empty = clean).
 * Rule 1: ages, banned period words, Group/sample IDs; rule 2: the earlier-group label; rule 3: the Beaker turnover
 * (no turnover "90%", "9 in 10" only with "at least"/"more than", no bridge line); rule 8: consumer-test claims;
 * rule 11: "Britain today" never called England; rule 14: never-on-screen words.
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
  if (TURNOVER_CONTEXT.test(text)) {
    if (/\b90\s*%/.test(text)) out.push('rule3:turnover-90');
    if (/\b9 in 10\b/i.test(text.replace(QUALIFIED_NINE_IN_TEN, ''))) out.push('rule3:9-in-10-without-at-least');
  }
  if (BRIDGE_LINE.test(text)) out.push('rule3:bridge-line');
  if (/23andMe/i.test(text) && /\d/.test(text.replace(/23andMe/gi, ''))) out.push('rule8:23andme-number');
  if (/AncestryDNA/i.test(text) && !/white paper/i.test(text)) out.push('rule8:ancestrydna-without-white-paper');
  if (ENGLAND_FOR_BRITAIN_TODAY.test(text)) out.push('rule11:england-for-britain-today');
  if (NEVER_ON_SCREEN.test(text)) out.push('rule14:never-on-screen');
  return out;
}
