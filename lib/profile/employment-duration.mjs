import {buildFactReview} from './fact-review.mjs';

// A display-only date difference. This never changes source facts or approvals.
const list = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();
const normalized = value => text(value).replace(/\s+/g, ' ').toLowerCase();
const sourceKey = ref => `${ref.documentId}:${ref.segmentId}`;
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthToken = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const fullToken = `(?:\\d{4}-\\d{2}(?:-\\d{2})?|${monthToken}\\.?[ -]+(?:\\d{1,2},?\\s+)?\\d{4}|\\d{1,2}[/.-]\\d{4}|\\d{4}/\\d{1,2})`;
const ongoing = value => /^(?:present|pres\.?|current|currently|ongoing|to date|till date|now)$/i.test(text(value));
const DAY = 86400000;

function validDate(year, month, day = 1) {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() + 1 === month && value.getUTCDate() === day;
}
function parseDate(raw) {
  const value = text(raw);
  if (ongoing(value)) return {ongoing: true, raw: value};
  let match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (match) {
    const year = Number(match[1]), month = Number(match[2]), day = match[3] ? Number(match[3]) : null;
    return validDate(year, month, day ?? 1) ? {year, month, day, precision: day == null ? 'month' : 'day', raw: value} : null;
  }
  match = new RegExp(`^(${monthToken})\\.?[ -]+(?:(\\d{1,2}),?\\s+)?(\\d{4}|\\d{2})$`, 'i').exec(value);
  if (match) {
    const month = months.findIndex(name => name.startsWith(match[1].toLowerCase().slice(0, 3))) + 1;
    const day = match[2] ? Number(match[2]) : null;
    if (match[3].length === 2) return day == null ? {month, yearSuffix: Number(match[3]), precision: 'month', shortYear: true, raw: value} : null;
    const year = Number(match[3]);
    return validDate(year, month, day ?? 1) ? {year, month, day, precision: day == null ? 'month' : 'day', raw: value} : null;
  }
  match = /^(\d{1,2})[/.-](\d{4})$/.exec(value);
  if (match && validDate(Number(match[2]), Number(match[1]))) return {year: Number(match[2]), month: Number(match[1]), day: null, precision: 'month', raw: value};
  match = /^(\d{4})\/(\d{1,2})$/.exec(value);
  if (match && validDate(Number(match[1]), Number(match[2]))) return {year: Number(match[1]), month: Number(match[2]), day: null, precision: 'month', raw: value};
  return null;
}
function evidenceDocument(state, ref) {
  const document = list(state.documents).find(document => document.id === ref.documentId && !document.deleted && ['resume', 'answer'].includes(document.kind));
  const segment = list(document?.segments).find(segment => segment.id === ref.segmentId);
  return segment && text(ref.quote) && segment.text.includes(ref.quote)
    && (ref.documentVersion == null || document.version == null || ref.documentVersion === document.version) ? {document, segment} : null;
}
function validApproval(state, fact) {
  return fact.category === 'employment' && (!fact.lifecycle || fact.lifecycle === 'active') && !fact.conflict
    && fact.approval === 'approved' && list(fact.evidence).length > 0 && fact.evidence.every(ref => evidenceDocument(state, ref))
    && !list(state.facts).some(other => other.id === fact.id && Number(other.version) > Number(fact.version))
    && list(state.approvals).some(approval => approval.id === fact.approvalRef && approval.kind === 'fact'
      && approval.recordId === fact.id && approval.recordVersion === fact.version && approval.decision === 'approved');
}
function readCell(cell, state) {
  if (!cell || cell.status === 'missing' || !text(cell.value) || !list(cell.entries).length) return {reason: 'missing_date'};
  if (cell.status === 'conflicting' || cell.entries.some(entry => entry.conflict)) return {reason: 'conflicting_date'};
  if (cell.status !== 'provided') return {reason: 'unmatched_source'};
  if (cell.entries.some(entry => !list(entry.evidence).length || entry.evidence.some(ref => !evidenceDocument(state, ref))
    || !entry.evidence.some(ref => ref.quote.includes(text(entry.value))))) return {reason: 'date_not_explicit_in_source'};
  const parsed = parseDate(cell.value);
  if (!parsed) return {reason: /^\d{4}$/.test(text(cell.value)) ? 'insufficient_date_precision' : 'invalid_or_ambiguous_date'};
  return parsed;
}
function matchesDate(raw, full) {
  if (raw?.ongoing) return full?.ongoing === true;
  if (!raw || !full || full.ongoing || full.shortYear || raw.precision !== full.precision || raw.month !== full.month || raw.day !== full.day && !(raw.day == null && full.day == null)) return false;
  return raw.shortYear ? full.year % 100 === raw.yearSuffix : raw.year === full.year;
}
function approvedRanges(statement) {
  const pattern = new RegExp(`(?<![\\d/.-])(${fullToken})\\s*(?:[-–—]|to|through|until)\\s*(${fullToken}|Present|Pres\\.?|Current|Currently|Ongoing|To date|Till date|Now)(?![a-z\\d/-]|\\.\\d)`, 'gi');
  return [...text(statement).matchAll(pattern)].map(match => ({start: parseDate(match[1]), end: parseDate(match[2])}));
}
function roleSourceKeys(record, state) {
  if (record.jobTitle?.status !== 'provided' || !text(record.jobTitle.value)) return new Set();
  const title = normalized(record.jobTitle.value), titleKeys = new Set();
  for (const entry of list(record.jobTitle.entries)) for (const ref of list(entry.evidence)) {
    const source = evidenceDocument(state, ref);
    const lines = source?.segment.text.split(/\r?\n/) || [];
    const startValues = list(record.startDate?.entries).map(entry => normalized(entry.value));
    const endValues = list(record.endDate?.entries).map(entry => normalized(entry.value));
    const hasDates = line => startValues.some(value => value && normalized(line).includes(value))
      && endValues.some(value => value && normalized(line).includes(value));
    // A shared paragraph alone does not bind dates to a neighboring role.
    if (lines.some((line, index) => normalized(line).includes(title)
      && (hasDates(line) || hasDates(lines[index + 1] || '') && !/[a-z]{4,}/i.test((lines[index + 1] || '').replace(new RegExp(`${monthToken}|Present|Pres\\.?|Current|Currently|Ongoing|To date|Till date`, 'gi'), ''))))) titleKeys.add(sourceKey(ref));
  }
  const startKeys = new Set(list(record.startDate?.entries).flatMap(entry => list(entry.evidence)).filter(ref => evidenceDocument(state, ref)).map(sourceKey));
  const endKeys = new Set(list(record.endDate?.entries).flatMap(entry => list(entry.evidence)).filter(ref => evidenceDocument(state, ref)).map(sourceKey));
  return new Set([...titleKeys].filter(key => startKeys.has(key) && endKeys.has(key)));
}
function sameRole(fact, role) {
  if (normalized(fact.field) === role) return true;
  const escaped = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match a complete asserted title, rather than Analyst inside Senior Analyst.
  return new RegExp(`(?:^|\\bas\\s+(?:a\\s+|an\\s+)?)${escaped}(?:\\s*\\([^)]*\\))?\\s+(?:at|from)\\b`, 'i').test(normalized(fact.statement));
}
function sameEmploymentSource(record, state, fact, keys) {
  const company = record.companyName?.status === 'provided' ? normalized(record.companyName.value) : '';
  if (company) {
    const scopedCompany = normalized(fact.scope).split(/\s*\|\s*/)[0];
    const assertedCompany = /\bat\s+(.+?)\s+from\s/i.exec(normalized(fact.statement))?.[1];
    if (assertedCompany && assertedCompany !== company) return false;
    if (scopedCompany !== company && assertedCompany !== company) return false;
  }
  // One source paragraph may contain several records with identical titles and
  // short dates. Bind the approval to the actual quoted record span in every
  // relevant cell, rather than allowing the segment ID to transfer approval.
  return fact.evidence.some(ref => keys.has(sourceKey(ref)) && [record.jobTitle, record.startDate, record.endDate].every(cell =>
    list(cell?.entries).some(entry => list(entry.evidence).some(recordRef => sourceKey(recordRef) === sourceKey(ref)
      && evidenceDocument(state, recordRef) && (ref.quote.includes(recordRef.quote) || recordRef.quote.includes(ref.quote))))));
}
function resolveShortDates(record, state, start, end) {
  if (!start.shortYear && !end.shortYear) return {start, end, resolvedFromFactRefs: []};
  const keys = roleSourceKeys(record, state), role = normalized(record.jobTitle?.value);
  if (!keys.size || !role) return {reason: 'short_year_requires_approved_full_year'};
  const candidates = [];
  for (const fact of list(state.facts).filter(fact => validApproval(state, fact))) {
    if (!sameRole(fact, role)) continue;
    if (!sameEmploymentSource(record, state, fact, keys)) continue;
    const assertedRanges = approvedRanges(fact.statement);
    // Multiple asserted stints need an explicit individual association first.
    if (assertedRanges.length !== 1) continue;
    for (const range of assertedRanges) if (matchesDate(start, range.start) && matchesDate(end, range.end))
      candidates.push({...range, factRef: {id: fact.id, version: fact.version, approvalRef: fact.approvalRef}});
  }
  const unique = new Map();
  for (const candidate of candidates) {
    const identity = JSON.stringify([candidate.start.year, candidate.start.month, candidate.start.day, candidate.end.ongoing ? 'ongoing' : [candidate.end.year, candidate.end.month, candidate.end.day]]);
    if (!unique.has(identity)) unique.set(identity, {...candidate, factRefs: []});
    unique.get(identity).factRefs.push(candidate.factRef);
  }
  if (unique.size !== 1) return {reason: unique.size ? 'conflicting_approved_full_years' : 'short_year_requires_approved_full_year'};
  const resolved = [...unique.values()][0];
  return {start: start.shortYear ? {...resolved.start, raw: start.raw, yearResolution: 'approved_same_source_assertion'} : start,
    end: end.shortYear ? {...resolved.end, raw: end.raw, yearResolution: 'approved_same_source_assertion'} : end,
    resolvedFromFactRefs: resolved.factRefs};
}
const position = date => date.precision === 'month' ? date.year * 12 + date.month - 1 : Math.round(Date.UTC(date.year, date.month - 1, date.day) / DAY);
const iso = (value, precision) => precision === 'month' ? `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, '0')}` : new Date(value * DAY).toISOString().slice(0, 10);
function span(start, end, precision) {
  if (precision === 'month') return {months: end - start, residualDays: 0};
  const first = new Date(start * DAY), last = new Date(end * DAY);
  let count = (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth();
  const anchor = count => Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + count,
    Math.min(first.getUTCDate(), new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + count + 1, 0)).getUTCDate()));
  if (anchor(count) > last.getTime()) count--;
  return {months: count, residualDays: Math.round((last.getTime() - anchor(count)) / DAY), totalDays: end - start};
}
function described(count, residualDays = 0) {
  const years = Math.floor(count / 12), remainingMonths = count % 12;
  const parts = [years ? `${years} ${years === 1 ? 'year' : 'years'}` : '', remainingMonths ? `${remainingMonths} ${remainingMonths === 1 ? 'month' : 'months'}` : '', residualDays ? `${residualDays} ${residualDays === 1 ? 'day' : 'days'}` : ''].filter(Boolean);
  return {months: count, totalMonths: count, years, remainingMonths, residualDays, label: parts.join(' ') || '0 months'};
}
function unavailable(reason) {
  return {status: 'unavailable', months: null, totalMonths: null, years: null, remainingMonths: null, residualDays: null,
    label: 'Unable to calculate', reason, precision: null, resolvedFromFactRefs: [], independentlyVerified: false};
}

/**
 * Section 1 only: elapsed employment date differences, without inclusive months.
 * Short years require an approved same-role, same-source full-year assertion.
 * This pure projection never changes dates, approvals, or other review defaults.
 * @param {any} stateOrRecords A profile state, or employment review records.
 * @param {{asOf?:string|null,documents?:any[],facts?:any[],approvals?:any[]}} [options]
 */
export function buildEmploymentDurations(stateOrRecords, {asOf, documents = [], facts = [], approvals = []} = {}) {
  const state = Array.isArray(stateOrRecords) ? {documents, facts, approvals} : (stateOrRecords || {});
  const records = Array.isArray(stateOrRecords) ? stateOrRecords : buildFactReview(state).employment;
  const roles = [], intervals = [];
  for (const record of records) {
    let start = readCell(record.startDate, state), end = readCell(record.endDate, state);
    let reason = record.associationStatus === 'requires_review' ? 'unresolved_record_association' : start.reason || end.reason;
    let resolvedFromFactRefs = [];
    if (!reason) {
      const resolved = resolveShortDates(record, state, start, end);
      reason = resolved.reason;
      if (!reason) { start = resolved.start; end = resolved.end; resolvedFromFactRefs = resolved.resolvedFromFactRefs; }
    }
    const usesAsOf = !reason && end.ongoing === true;
    if (!reason && start.ongoing) reason = 'invalid_start_date';
    if (!reason && usesAsOf) {
      const supplied = parseDate(asOf);
      if (!asOf) reason = 'ongoing_requires_explicit_as_of';
      else if (!supplied || supplied.shortYear || supplied.ongoing) reason = 'invalid_as_of';
      else {
        end = {...supplied, raw: end.raw, ongoing: true};
        if (start.precision === 'month' && end.precision === 'day') end = {...end, day: null, precision: 'month'};
      }
    }
    if (!reason && start.precision !== end.precision) reason = 'mixed_date_precision';
    if (!reason && position(end) < position(start)) reason = 'end_precedes_start';
    let duration = unavailable(reason);
    if (!reason) {
      const interval = {start: position(start), end: position(end), precision: start.precision, roleIds: [record.id]};
      const difference = span(interval.start, interval.end, interval.precision);
      duration = {...described(difference.months, difference.residualDays), status: 'calculated', precision: interval.precision,
        start: iso(interval.start, interval.precision), end: iso(interval.end, interval.precision), usesAsOf,
        asOf: usesAsOf ? asOf : null, resolvedFromFactRefs, independentlyVerified: false,
        ...(difference.totalDays == null ? {} : {totalDays: difference.totalDays})};
      intervals.push(interval);
    }
    roles.push({recordId: record.id, scope: record.scope, jobTitle: record.jobTitle?.value || null, duration});
  }
  const includedRoleIds = roles.filter(role => role.duration.status === 'calculated').map(role => role.recordId);
  const excludedRoleIds = roles.filter(role => role.duration.status !== 'calculated').map(role => role.recordId);
  let total = {...unavailable(records.length ? 'no_calculable_employment_dates' : 'no_employment_records'), includedRoleIds, excludedRoleIds, mergedPeriods: [], asOf: asOf || null,
    countingConvention: 'End date minus start date at source precision; overlapping employment periods count once.'};
  const precisions = new Set(intervals.map(interval => interval.precision));
  if (precisions.size > 1) total.reason = 'mixed_record_precision';
  else if (intervals.length) {
    const precision = intervals[0].precision, merged = [];
    for (const interval of intervals.sort((left, right) => left.start - right.start || left.end - right.end)) {
      const prior = merged.at(-1);
      if (prior && interval.start <= prior.end) { prior.end = Math.max(prior.end, interval.end); prior.roleIds.push(...interval.roleIds); }
      else merged.push({...interval, roleIds: [...interval.roleIds]});
    }
    let count = 0, days = 0, totalDays = 0;
    const mergedPeriods = merged.map(period => {
      const difference = span(period.start, period.end, precision); count += difference.months; days += difference.residualDays; totalDays += difference.totalDays || 0;
      return {start: iso(period.start, precision), end: iso(period.end, precision), roleIds: period.roleIds, ...described(difference.months, difference.residualDays)};
    });
    total = {...total, ...described(count, days), status: excludedRoleIds.length ? 'partial' : 'calculated', precision, mergedPeriods,
      reason: excludedRoleIds.length ? 'incomplete_employment_dates' : null, complete: !excludedRoleIds.length,
      ...(precision === 'day' ? {totalDays} : {})};
    if (excludedRoleIds.length) total.label += ' from dated roles';
  }
  return {schemaVersion: 1, roles, total};
}
