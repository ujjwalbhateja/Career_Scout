import {ProfileError} from './domain.mjs';
import {extractSectionOneFacts} from './section-one.mjs';

const PREFIX = 'Fact evidence grounding: ';
const MAX_REFS = 8, MAX_QUOTE = 6000;
const list = value => Array.isArray(value) ? value : [];
const whitespace = value => String(value).replace(/\s+/gu, ' ').trim();
const fail = message => { throw new ProfileError(PREFIX + message, 502); };
const bullet = value => /^\s*(?:[•●▪◦*]|[-–—−]\s|\d+[.)]\s)/u.test(value);
const heading = value => /^(?:(?:professional|work|employment|volunteer) experience|experience|employment history|education(?: and certifications?)?|academic qualifications?|certifications?|core competencies|skills|technical skills|technical tools|tools and technologies|programming languages|projects?|publications?|awards?|interests?|references?|(?:professional |career )?summary|(?:career )?objective|profile)\s*:?$/i.test(value.trim())
  || /^[A-Z][A-Z &/()'-]{3,}\s*:?$/.test(value.trim());
const label = value => /^[\p{L}][\p{L} &/()'-]{0,60}:\s*\S/u.test(value.trim());
const roleWords = /\b(?:analyst|associate|manager|director|president|officer|engineer|consultant|specialist|lead|head|intern|executive|coordinator|supervisor|administrator|developer|designer|researcher|assistant|partner|counsel)\b/i;
const dateRange = /(?:\b\d{4}-\d{2}(?:-\d{2})?|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{2}(?:\d{2})?)\s*(?:[-–—−]|to|through|until)\s*(?:\d{4}|[A-Za-z])/i;
const recordHeader = value => !bullet(value) && (dateRange.test(value) || value.includes('|') && roleWords.test(value));

function pageOf(segment) {
  const id = /(?:^|\.)page(\d+)(?:\.|$)/i.exec(String(segment.id || ''))?.[1];
  const locator = /^page\s+(\d+)\b/i.exec(String(segment.locator || ''))?.[1];
  if (id && locator && Number(id) !== Number(locator)) return null;
  return id || locator ? Number(id || locator) : null;
}
function sourceContexts(document) {
  const events = new Map(), owned = new Set(), listContexts = new Set();
  const byId = new Map(document.segments.map((segment, index) => [segment.id, index]));
  const parsedFacts = document.kind === 'resume' ? extractSectionOneFacts(document).facts : [];
  if (document.kind === 'resume') {
    const records = new Map();
    for (const fact of parsedFacts.filter(fact => ['employment', 'education'].includes(fact.category))) {
      const key = fact.category + ':' + fact.scope;
      if (!records.has(key)) records.set(key, []);
      records.get(key).push(fact);
    }
    for (const [key, facts] of records) {
      const anchors = facts.filter(fact => ['job_title', 'qualification', 'start_date', 'end_date'].includes(fact.field))
        .map(fact => byId.get(fact.evidence[0]?.segmentId)).filter(Number.isInteger);
      if (!anchors.length) continue;
      const start = Math.min(...anchors);
      const previous = events.get(start);
      events.set(start, previous && previous !== key ? 'ambiguous-record:' + start : key);
      for (const fact of facts) if (byId.has(fact.evidence[0]?.segmentId)) owned.add(byId.get(fact.evidence[0].segmentId));
    }
  }
  const contexts = [];
  let current = 'document';
  for (let index = 0; index < document.segments.length; index++) {
    const value = document.segments[index].text;
    if (heading(value)) current = 'section:' + index;
    else if (events.has(index)) current = events.get(index);
    else if (!owned.has(index) && recordHeader(value)) current = 'record:' + index;
    else if (label(value)) {
      current = 'field:' + index;
      if (/[,;]/.test(value)) listContexts.add(current);
    }
    contexts.push(current);
  }
  return {contexts, listContexts, listedSkills: parsedFacts.filter(fact => fact.category === 'skills')};
}
function skillItems(value) {
  if (typeof value !== 'string' || !/[,;]/.test(value)) return null;
  const items = value.split(/[,;]/).map(whitespace);
  return items.length >= 2 && items.every(Boolean) && new Set(items).size === items.length ? items : null;
}
function groupedSkillReferences(document, proposal, ref, metadata) {
  const requested = skillItems(ref.quote), asserted = skillItems(proposal.statement);
  if (!requested || !asserted || requested.length !== asserted.length || requested.some(item => !asserted.includes(item)))
    fail('A grouped skill assertion and its quote must contain the same complete listed items.');
  if (!['programming_languages', 'tools_technologies', 'other_skills'].includes(proposal.field))
    fail('A grouped skill assertion must use its source-supported skill category.');
  const sourceItems = metadata.listedSkills.filter(fact => fact.field === proposal.field && fact.evidence.some(source =>
    source.documentId === document.id && source.segmentId === ref.segmentId && source.quote.includes(fact.statement)));
  const references = requested.map(item => {
    const source = sourceItems.find(fact => whitespace(fact.statement) === item);
    if (!source) fail('A grouped skill quote contains an item that is not explicitly listed in this source and skill category.');
    return {...ref, quote: source.statement};
  });
  if (references.length > MAX_REFS) fail('A grouped skill assertion needs more than eight source references. Split it into separately supported assertions.');
  return references;
}
function canContinue(document, index, metadata) {
  const before = document.segments[index], after = document.segments[index + 1];
  if (!before || !after || !before.text.trim() || !after.text.trim()) return false;
  const firstPage = pageOf(before), nextPage = pageOf(after);
  if (firstPage == null || firstPage !== nextPage) return false;
  if (document.mime && document.mime !== 'application/pdf') return false;
  if (metadata.contexts[index] !== metadata.contexts[index + 1]) return false;
  if (heading(before.text) || heading(after.text) || label(after.text) || recordHeader(before.text) || recordHeader(after.text) || bullet(after.text)) return false;
  if (/[.!?:;]\s*$/.test(before.text)) return false;
  // PDF extraction stores visual lines as segments. A lower-case continuation
  // or a clearly continued labelled list is recoverable; an unmarked capital-
  // letter paragraph is deliberately left for the extractor to cite separately.
  return /^[\p{Ll},)\]]/u.test(after.text.trim())
    || metadata.listContexts.has(metadata.contexts[index]) && /[,;]/.test(before.text) && /[,;]/.test(after.text);
}
function normalizedSegment(value, segmentIndex) {
  let normalized = '';
  const positions = [];
  for (let index = 0; index < value.length; index++) {
    if (/\s/u.test(value[index])) {
      if (!normalized) continue;
      if (normalized.endsWith(' ')) positions.at(-1).end = index + 1;
      else { normalized += ' '; positions.push({segmentIndex, start: index, end: index + 1}); }
    } else { normalized += value[index]; positions.push({segmentIndex, start: index, end: index + 1}); }
  }
  if (normalized.endsWith(' ')) { normalized = normalized.slice(0, -1); positions.pop(); }
  return {text: normalized, positions};
}
function sourceRuns(document, metadata) {
  const runs = [];
  for (let index = 0; index < document.segments.length; index++) {
    const part = normalizedSegment(document.segments[index].text, index);
    if (index && canContinue(document, index - 1, metadata)) {
      const run = runs.at(-1); run.text += ' ' + part.text; run.positions.push(null, ...part.positions);
    } else runs.push(part);
  }
  return runs;
}
function wordBoundary(source, start, end, quote) {
  const word = value => value && /[\p{L}\p{N}_]/u.test(value);
  return !(word(quote[0]) && word(source[start - 1])) && !(word(quote.at(-1)) && word(source[end]));
}
function occurrences(source, quote) {
  const found = [];
  for (let from = 0, at; (at = source.indexOf(quote, from)) >= 0; from = at + 1)
    if (wordBoundary(source, at, at + quote.length, quote)) found.push(at);
  return found;
}
function matchingFragments(document, runs, quote) {
  const matches = [];
  for (const run of runs) for (const at of occurrences(run.text, quote)) {
    const points = run.positions.slice(at, at + quote.length).filter(Boolean);
    if (!points.length) continue;
    const spans = new Map();
    for (const point of points) {
      const previous = spans.get(point.segmentIndex);
      if (previous) previous.end = point.end;
      else spans.set(point.segmentIndex, {start: point.start, end: point.end});
    }
    matches.push([...spans].map(([index, span]) => ({index, quote: document.segments[index].text.slice(span.start, span.end)})));
  }
  return matches;
}

/**
 * Ground one full model batch before any proposed fact is written. Exact valid
 * citations retain their supplied shape. Repairs change only evidence IDs and
 * quotes, using unique whitespace-equivalent source spans and original text.
 * An unmatched grouped skill list may instead cite its complete explicit,
 * parser-backed items in the stated segment and matching skill category.
 * Cross-segment repair is limited to same-page PDF continuations. Unknown
 * segment IDs, separate paragraphs, capitalized unmarked continuations and
 * other source records require the model to cite their fragments separately.
 * @param {any} document Current analyzed resume or saved-answer document.
 * @param {any[]} proposals
 * @returns {any[]}
 */
export function groundFactProposals(document, proposals) {
  if (!document || document.deleted || !['resume', 'answer'].includes(document.kind)
    || typeof document.id !== 'string' || !Array.isArray(document.segments)
    || document.segments.some(segment => typeof segment.id !== 'string' || typeof segment.text !== 'string')
    || new Set(document.segments.map(segment => segment.id)).size !== document.segments.length)
    fail('Only a current resume or saved answer with original source segments can establish profile facts.');
  if (!Array.isArray(proposals) || proposals.length > 200) fail('The extracted fact batch is invalid.');
  const metadata = sourceContexts(document), runs = sourceRuns(document, metadata);
  const allSource = document.segments.map(segment => whitespace(segment.text)).join(' ');
  const copy = structuredClone(proposals);
  for (const proposal of copy) {
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal) || !Array.isArray(proposal.evidence)
      || !proposal.evidence.length || proposal.evidence.length > MAX_REFS) fail('Every extracted assertion needs between one and eight source references.');
    const grounded = [];
    for (const ref of proposal.evidence) {
      if (!ref || typeof ref !== 'object' || ref.documentId !== document.id) fail('An extracted assertion cites a source outside the document being analyzed.');
      if (ref.documentVersion != null && ref.documentVersion !== document.version) fail('An extracted assertion cites an outdated source version.');
      if (typeof ref.segmentId !== 'string' || typeof ref.quote !== 'string' || !ref.quote.trim() || ref.quote.length > MAX_QUOTE)
        fail('An extracted assertion has an invalid or oversized source quote.');
      const declared = document.segments.findIndex(segment => segment.id === ref.segmentId);
      if (declared < 0) fail('An extracted assertion cites an unknown source segment.');
      if (document.segments[declared].text.includes(ref.quote)) { grounded.push(ref); continue; }
      const quote = whitespace(ref.quote), matches = matchingFragments(document, runs, quote);
      if (matches.length > 1) fail('A source quote matches more than one passage. Cite the original fragments separately.');
      if (!matches.length) {
        // A model may reorder or select a comma-separated skill list. Only
        // after exact/whitespace recovery fails, recover whole parser-backed
        // items in this stated segment, never arbitrary narrative substrings.
        if (proposal.category === 'skills' && proposal.evidence.length === 1 && /[,;]/.test(ref.quote)) {
          grounded.push(...groupedSkillReferences(document, proposal, ref, metadata)); continue;
        }
        if (occurrences(allSource, quote).length) fail('A source quote crosses a page, record, or paragraph boundary. Cite the original fragments separately.');
        fail('A source quote could not be matched safely. Its words, numbers, punctuation, and case must match the original passage.');
      }
      const fragments = matches[0];
      if (metadata.contexts[declared]?.startsWith('ambiguous-record:') || fragments.some(fragment => metadata.contexts[fragment.index] !== metadata.contexts[declared]))
        fail('A source quote belongs to a different record or section. Cite its original source fragments separately.');
      for (const fragment of fragments) grounded.push({...ref, segmentId: document.segments[fragment.index].id, quote: fragment.quote});
      if (grounded.length > MAX_REFS) fail('A grounded assertion needs more than eight source references. Split it into separately supported assertions.');
    }
    if (grounded.length > MAX_REFS) fail('A grounded assertion needs more than eight source references. Split it into separately supported assertions.');
    proposal.evidence = grounded;
  }
  return copy;
}
