// A derived review, never a fact approval or an independent verification.
// Canonical fields let the extractor supply explicit values without asking a
// model to calculate tenure. Missing placeholders must not become fact proposals.
export const MISSING_FACT_VALUE = 'Missing / Not Provided';
export const UNAVAILABLE_EXPERIENCE = 'Unable to Calculate Accurately.';

const key = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const normalized = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const fields = {
  personal: {
    fullName: ['full_name', 'name', 'candidate_name'],
    email: ['email', 'email_id', 'email_address'],
    mobile: ['mobile', 'mobile_number', 'phone', 'phone_number', 'telephone'],
    address: ['address', 'home_address', 'residential_address', 'current_address']
  },
  employment: {
    companyName: ['company_name', 'company', 'employer', 'employer_name'],
    jobTitle: ['job_title', 'role_title', 'position_title', 'employment_title', 'designation'],
    startDate: ['start_date', 'employment_start_date', 'employment_start', 'date_started'],
    endDate: ['end_date', 'employment_end_date', 'employment_end', 'date_ended'],
    location: ['location', 'employment_location', 'company_location', 'work_location']
  },
  education: {
    institutionName: ['institution_name', 'university_name', 'university', 'institution', 'school', 'school_name', 'college', 'college_name'],
    qualification: ['qualification', 'qualification_name', 'degree', 'degree_name', 'educational_qualification', 'user_confirmed_qualification'],
    startDate: ['start_date', 'education_start_date', 'education_start'],
    endDate: ['end_date', 'education_end_date', 'education_end', 'graduation_date'],
    location: ['location', 'education_location', 'university_location', 'institution_location']
  },
  certifications: {
    name: ['certification_name', 'certificate_name', 'certification', 'name', 'user_confirmed_qualification'],
    issueDate: ['issue_date', 'completion_date', 'certification_date', 'date']
  }
};
const skillFields = {
  programmingLanguages: ['programming_languages', 'programming_language', 'language'],
  toolsTechnologies: ['tools_technologies', 'tools_and_technologies', 'technical_tools', 'technical_tools_and_systems', 'tools_and_systems', 'tool', 'tools', 'technology', 'technologies', 'platform', 'software'],
  otherSkills: ['other_skills', 'other_skill', 'skill', 'skills', 'professional_skill', 'technical_skill']
};
const available = fact => fact && (!fact.lifecycle || fact.lifecycle === 'active') && !['rejected', 'withdrawn'].includes(fact.approval);
const approvalStatus = entries => {
  const statuses = [...new Set(entries.map(entry => entry.approval || 'pending'))];
  return statuses.length === 1 ? statuses[0] : statuses.length ? 'mixed' : 'none';
};

function matchedEvidence(refs, documents) {
  return Array.isArray(refs) && refs.length > 0 && refs.every(ref => {
    const document = documents.find(item => item.id === ref.documentId && !item.deleted && ['resume', 'answer'].includes(item.kind));
    const segment = document?.segments?.find(item => item.id === ref.segmentId);
    return segment && typeof ref.quote === 'string' && ref.quote.trim() && segment.text.includes(ref.quote)
      && (ref.documentVersion == null || document.version == null || ref.documentVersion === document.version);
  });
}

function entryFromFact(fact, documents) {
  // `value`, when supplied, is an exact source substring, not a normalized date
  // or a second free-form assertion. Legacy facts keep their original statement.
  const suppliedValue = typeof fact.value === 'string' && fact.value.trim() ? fact.value.trim() : null;
  const value = suppliedValue || String(fact.statement ?? '').trim();
  const evidence = Array.isArray(fact.evidence) ? fact.evidence.map(ref => ({...ref})) : [];
  const matched = matchedEvidence(evidence, documents) && (!suppliedValue || evidence.some(ref => ref.quote.includes(suppliedValue)));
  return {
    factId: fact.id, factVersion: fact.version, approvalRef: fact.approvalRef || null, value, statement: String(fact.statement ?? ''),
    category: fact.category, field: fact.field, scope: fact.scope, origin: fact.origin || null,
    evidence, evidenceStatus: matched ? 'matched_source' : 'requires_review',
    approval: fact.approval || 'pending', confirmation: fact.confirmation || 'source_stated',
    independentlyVerified: false, conflict: fact.conflict === true
  };
}

/** A source-linked claim view; changing this view never changes the fact. */
export function factReviewEntry(fact, documents = []) { return entryFromFact(fact, documents); }

const monthToken = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const dateToken = `(?:\\d{4}-\\d{2}(?:-\\d{2})?|${monthToken}\\.?\\s+(?:\\d{1,2},?\\s+)?(?:\\d{4}|\\d{2})|\\d{1,2}[/.-]\\d{4}|\\d{4})`;
const endToken = `(?:${dateToken}|Present|Pres\\.?|Current|Currently|Ongoing|To date|Till date)`;
function ranges(value) {
  return [...String(value || '').matchAll(new RegExp(`(?<![\\d/.-])(${dateToken})\\s*(?:[–—-]|to|through|until)\\s*(${endToken})(?![\\d/-]|\\.\\d)`, 'gi'))]
    .map(match => ({start: match[1], end: match[2], quote: match[0]}));
}
function literalSpan(source, value) {
  if (!String(value || '').trim()) return null;
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const left = /^[\p{L}\p{N}]/u.test(value) ? '(?<![\\p{L}\\p{N}])' : '';
  const right = /[\p{L}\p{N}]$/u.test(value) ? '(?![\\p{L}\\p{N}])' : '';
  return new RegExp(left + escaped + right, 'iu').exec(String(source || ''))?.[0] || null;
}
function ownSpan(entry, value) {
  for (const ref of entry.evidence) { const actual = literalSpan(ref.quote, value); if (actual) return {value: actual, ref}; }
  return null;
}
function projected(entry, found, method = 'explicit_value_in_fact_quote') {
  return {...entry, value: found.value, evidence: [{...found.ref}],
    projection: {method, originalStatement: entry.statement, originalFactRef: {id: entry.factId, version: entry.factVersion, approvalRef: entry.approvalRef}}};
}
function dateRange(entry, title) {
  const found = [];
  for (const ref of entry.evidence) {
    let lines = String(ref.quote).split(/\n+/);
    if (title) {
      const selected = [];
      for (let i = 0; i < lines.length; i++) if (literalSpan(lines[i], title)) {
        selected.push(lines[i]);
        if (lines[i + 1] && ranges(lines[i + 1]).some(range => lines[i + 1].trim() === range.quote)) selected.push(lines[i + 1]);
      }
      if (selected.length) lines = selected;
    }
    for (const range of ranges(lines.join('\n'))) found.push({...range, ref});
  }
  const unique = [...new Map(found.map(range => [normalized(range.start + '|' + range.end), range])).values()];
  return unique.length === 1 ? unique[0] : null;
}
const genericScope = /^(?:personal|employment|education|certifications?|skills?|resume|experience|professional experience|academic|unknown|not provided|missing)$/i;
const titleWords = /\b(?:analyst|associate|president|manager|director|officer|engineer|consultant|specialist|lead|head|intern|executive|coordinator|supervisor|administrator|developer|designer|researcher|assistant|partner|counsel)\b/i;
const degreeWords = /\b(?:master|bachelor|doctor|ph\.?d|mba|msc|m\.sc|bsc|b\.sc|degree|diploma|certificate|qualification)\b/i;
function adjacentHeader(entry, documents, scope) {
  if (!scope || genericScope.test(scope)) return null;
  for (const ref of entry.evidence) {
    const document = documents.find(item => item.id === ref.documentId && !item.deleted && ['resume', 'answer'].includes(item.kind));
    const index = document?.segments?.findIndex(segment => segment.id === ref.segmentId) ?? -1;
    const previous = index > 0 ? document.segments[index - 1] : null;
    const current = index >= 0 ? document.segments[index] : null;
    const beforeQuote = current && current.text.indexOf(ref.quote) > 0 ? current.text.slice(0, current.text.indexOf(ref.quote)).trimEnd().split(/\n/).at(-1) : null;
    // Only a single immediate, explicitly matching header. Never walk past a
    // different employment record or across a section looking for a company.
    for (const candidate of [{segment: current, line: beforeQuote}, {segment: previous, line: previous?.text}]) {
      const line = String(candidate.line || '').trim();
      const first = line.split(/\s+[|·•]\s+/)[0].replace(/^(?:company|employer|institution|university)\s*:\s*/i, '').trim();
      if (line.length <= 180 && normalized(first) === normalized(scope)) {
        return {value: first, ref: {documentId: document.id, documentVersion: document.version, segmentId: candidate.segment.id, quote: first}};
      }
    }
  }
  return null;
}

function recordProjections(fact, documents, canonicalSkillFields = new Map()) {
  const original = entryFromFact(fact, documents), category = fact.category, field = fieldName(category, fact.field);
  const metadataScope = String(fact.recordScope || '').trim();
  const scope = metadataScope && (metadataScope === fact.scope || ownSpan(original, metadataScope)) ? metadataScope : String(fact.scope || '').trim();
  const output = [{category, field: fact.field, scope, originalScope: String(fact.scope || ''), entry: original}];
  if (original.evidenceStatus !== 'matched_source') return output;
  if (['employment', 'education'].includes(category)) {
    const isLegacyTitle = !field && (category === 'employment' ? titleWords : degreeWords).test(String(fact.field));
    let title = isLegacyTitle ? ownSpan(original, String(fact.field)) : null;
    if (field === (category === 'employment' ? 'jobTitle' : 'qualification')) {
      title = ownSpan(original, original.value);
      if (!title) {
        for (const ref of original.evidence) {
          const label = category === 'employment' ? /(?:job title|role title|position|title)\s*:\s*([^\n;]+)/i : /(?:qualification|degree)\s*:\s*([^\n;]+)/i;
          const match = label.exec(ref.quote); if (match) { title = {value: match[1].trim(), ref}; break; }
        }
      }
    }
    const range = dateRange(original, title?.value);
    if (isLegacyTitle && title) {
      // A complete old sentence represents one explicit stint. Keep repeated
      // employers separate by the literal role/qualification and date range.
      const suffix = [title.value, range?.start, range?.end].filter(Boolean).join(' | ');
      for (const item of output) item.scope = [scope, suffix].filter(Boolean).join(' | ');
      output.push({category, field: category === 'employment' ? 'job_title' : 'qualification', scope: output[0].scope,
        originalScope: String(fact.scope || ''), entry: projected(original, title, 'legacy_record_literal_title')});
    } else if (title && field) output[0].entry = projected(original, title);
    if (range && (!field || ['startDate', 'endDate', 'jobTitle', 'qualification'].includes(field))) {
      if (field === 'startDate') output[0].entry = projected(original, {value: range.start, ref: range.ref});
      else if (field === 'endDate') output[0].entry = projected(original, {value: range.end, ref: range.ref});
      else {
        output.push({category, field: 'start_date', scope: output[0].scope, originalScope: String(fact.scope || ''), entry: projected(original, {value: range.start, ref: range.ref}, 'legacy_record_explicit_date_range')});
        output.push({category, field: 'end_date', scope: output[0].scope, originalScope: String(fact.scope || ''), entry: projected(original, {value: range.end, ref: range.ref}, 'legacy_record_explicit_date_range')});
      }
    } else if (['startDate', 'endDate'].includes(field) && !dateParts(original.value) && !/^(present|current|ongoing)$/i.test(original.value)) {
      const dates = original.evidence.flatMap(ref => [...ref.quote.matchAll(new RegExp(`${field === 'endDate' ? endToken : dateToken}`, 'gi'))].map(match => ({value: match[0], ref})));
      const unique = [...new Map(dates.map(item => [normalized(item.value), item])).values()];
      if (unique.length === 1 && dateParts(unique[0].value)?.precision !== 'year'
        && /\b(?:start|end|began|started|ended|from|until|date)\b/i.test(original.value)) output[0].entry = projected(original, unique[0], 'legacy_date_literal');
    }
    const rawScope = String(fact.scope || '').trim();
    if (!genericScope.test(rawScope) && rawScope && (isLegacyTitle || title)) {
      const own = ownSpan(original, rawScope), context = own || adjacentHeader(original, documents, rawScope);
      if (context) {
        const entry = projected(original, context, own ? 'explicit_scoped_entity_in_fact_quote' : 'adjacent_source_header');
        if (!own) {
          entry.sourceFactApproval = original.approval; entry.sourceFactApprovalRef = original.approvalRef;
          entry.approval = 'pending'; entry.requiresReview = true;
          entry.projection.approvalScope = 'adjacent_context_not_separately_approved';
        }
        output.push({category, field: category === 'employment' ? 'company_name' : 'institution_name', scope: output[0].scope, originalScope: rawScope, entry});
      }
    }
  }
  if (category === 'skills') {
    const bucket = Object.entries(skillFields).find(([, aliases]) => aliases.includes(key(fact.field)))?.[0];
    const literalField = !bucket && ownSpan(original, String(fact.field));
    if (literalField) { output[0].field = 'other_skills'; output[0].entry = projected(original, literalField, 'legacy_skill_literal'); }
    else if (bucket) {
      const sourceList = original.evidence.map(ref => /(?:^|\n)\s*(?:technical tools|tools and technologies|programming languages|other skills|skills|tools)\s*(?:\(skills?\))?\s*:\s*([^\n]+)/i.exec(ref.quote)?.[1]).find(Boolean);
      const raw = (sourceList || original.value).replace(/^(?:technical tools|tools and technologies|programming languages|other skills|skills|tools)\s*(?::|include|are)\s*/i, '');
      const parts = raw.split(/\s*[,;\n]\s*|\s+and\s+/i).map(value => value.trim()).filter(Boolean);
      if (parts.length > 1 && parts.every(value => ownSpan(original, value))) {
        output.length = 0;
        for (const value of parts) output.push({category, field: canonicalSkillFields.get(normalized(value)) || fact.field, scope, originalScope: String(fact.scope || ''), entry: projected(original, ownSpan(original, value), 'explicit_skill_list_item')});
      }
    }
  }
  return output;
}

function cell(entries = []) {
  const nonempty = entries.filter(entry => entry.value && entry.value !== MISSING_FACT_VALUE);
  if (!nonempty.length) return {status: 'missing', value: MISSING_FACT_VALUE, entries: [], approvalStatus: 'none', independentlyVerified: false};
  const values = [...new Map(nonempty.map(entry => [normalized(entry.value), entry.value])).values()];
  const status = nonempty.some(entry => entry.conflict) || values.length > 1 ? 'conflicting'
    : nonempty.some(entry => entry.evidenceStatus !== 'matched_source') ? 'unsupported' : 'provided';
  return {
    status, value: values.length === 1 ? values[0] : null, values, entries: nonempty,
    approvalStatus: approvalStatus(nonempty), independentlyVerified: false
  };
}

function fieldName(category, field) {
  return Object.entries(fields[category] || {}).find(([, aliases]) => aliases.includes(key(field)))?.[0];
}

function dateIdentity(value, isEnd = false) {
  if (isEnd && /^(?:present|pres\.?|current|currently|ongoing|to date|till date|now)$/i.test(String(value || '').trim())) return 'ongoing';
  const parsed = dateParts(value);
  return parsed ? [parsed.precision, parsed.year, parsed.month || '', parsed.day || ''].join(':') : null;
}
function explicitRecordIdentity(record, category) {
  const role = record[category === 'employment' ? 'jobTitle' : 'qualification'];
  if (![role, record.startDate, record.endDate].every(value => value?.status === 'provided' && value.value)) return null;
  const start = dateIdentity(record.startDate.value), end = dateIdentity(record.endDate.value, true);
  return start && end ? JSON.stringify([normalized(role.value), start, end]) : null;
}
function matchingSourceSegments(value, documents) {
  const output = new Map();
  for (const entry of value.entries || []) if (entry.evidenceStatus === 'matched_source') for (const ref of entry.evidence || []) {
    const document = documents.find(document => document.id === ref.documentId && !document.deleted && ['resume', 'answer'].includes(document.kind));
    const segment = document?.segments?.find(segment => segment.id === ref.segmentId);
    if (segment && segment.text.includes(ref.quote) && (ref.documentVersion == null || document.version == null || ref.documentVersion === document.version))
      output.set(JSON.stringify([document.id, document.version || ref.documentVersion || null, segment.id]), segment.text);
  }
  return output;
}
function literalOccurrences(source, value) {
  if (!value) return 0;
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const left = /^[\p{L}\p{N}]/u.test(value) ? '(?<![\\p{L}\\p{N}])' : '';
  const right = /[\p{L}\p{N}]$/u.test(value) ? '(?![\\p{L}\\p{N}])' : '';
  return [...source.matchAll(new RegExp(left + escaped + right, 'giu'))].length;
}
function sameRecordSources(left, right, category, documents) {
  return [category === 'employment' ? 'jobTitle' : 'qualification', 'startDate', 'endDate'].every(field => {
    const first = matchingSourceSegments(left[field], documents), second = matchingSourceSegments(right[field], documents);
    return [...first].some(([id, source]) => second.has(id)
      && literalOccurrences(source, left[field].value) === 1 && literalOccurrences(source, right[field].value) === 1);
  });
}
function recordReferences(record, category) {
  const entries = [...Object.keys(fields[category]).flatMap(field => record[field].entries), ...record.otherFacts];
  record.factRefs = [...new Map(entries.map(entry => [entry.factId + ':' + entry.factVersion,
    {id: entry.factId, version: entry.factVersion, approvalRef: entry.approvalRef}])).values()];
  record.sourceRefs = [...new Map(entries.flatMap(entry => entry.evidence).map(ref => [JSON.stringify(ref), ref])).values()];
}
function mergedRecordCell(first, second, field) {
  const entries = [...first.entries, ...second.entries], result = cell(entries);
  if (['startDate', 'endDate'].includes(field) && !entries.some(entry => entry.conflict)
    && entries.every(entry => entry.evidenceStatus === 'matched_source')) {
    const dates = new Set(entries.map(entry => dateIdentity(entry.value, field === 'endDate')));
    if (dates.size === 1 && !dates.has(null)) {
      result.status = 'provided'; result.value = entries[0].value;
      result.equivalentDateValues = [...new Set(entries.map(entry => entry.value))];
    }
  }
  return result;
}
function dedupePhysicalRecords(records, category, documents, possibleDuplicates) {
  const output = [];
  for (const record of records) {
    const signature = explicitRecordIdentity(record, category);
    let merged = false;
    for (const prior of output) {
      if (!signature || explicitRecordIdentity(prior, category) !== signature) continue;
      const entityField = category === 'employment' ? 'companyName' : 'institutionName';
      const first = prior[entityField], second = record[entityField];
      const entityConflict = first.status === 'provided' && second.status === 'provided' && normalized(first.value) !== normalized(second.value);
      const entityUnresolved = [first, second].some(value => ['conflicting', 'unsupported'].includes(value.status));
      const sourcesMatch = sameRecordSources(prior, record, category, documents);
      if (!sourcesMatch || entityConflict || entityUnresolved) {
        // Different explicit employers in different source records are distinct
        // jobs, even if both happen to share a title and dates.
        if (!(entityConflict && !sourcesMatch)) {
          possibleDuplicates.push({category, recordIds: [prior.id, record.id], reason: entityConflict || entityUnresolved ? 'entity_requires_review' : 'source_identity_not_established'});
          prior.possibleDuplicate = true; record.possibleDuplicate = true;
        }
        continue;
      }
      for (const field of Object.keys(fields[category])) prior[field] = mergedRecordCell(prior[field], record[field], field);
      prior.originalScopes = [...new Set([...prior.originalScopes, ...record.originalScopes])];
      prior.scopes = [...new Set([...(prior.scopes || [prior.scope]), ...(record.scopes || [record.scope])])];
      prior.mergedRecordIds = [...new Set([...(prior.mergedRecordIds || [prior.id]), ...(record.mergedRecordIds || [record.id])])];
      prior.otherFacts.push(...record.otherFacts);
      prior.duplicateResolution = 'same_explicit_record_sources';
      recordReferences(prior, category); merged = true; break;
    }
    if (!merged) output.push(record);
  }
  return output;
}

/**
 * Derive a full Fact review from current flat fact proposals. No state mutation.
 * Optional fact.value must be an exact substring of its matched source quote.
 * `scope` must identify one employment/education/certification record; company
 * names or qualifications must never be inferred from an unrelated scope label.
 */
export function buildFactReview(state, {asOf} = {}) {
  const documents = Array.isArray(state?.documents) ? state.documents : [];
  const facts = (Array.isArray(state?.facts) ? state.facts : []).filter(available);
  const personal = Object.fromEntries(Object.keys(fields.personal).map(field => [field, []]));
  const groups = {employment: new Map(), education: new Map(), certifications: new Map()};
  const skills = Object.fromEntries(Object.keys(skillFields).map(field => [field, []]));
  const otherFacts = [];
  const canonicalSkillFields = new Map();
  for (const fact of facts.filter(fact => fact.category === 'skills' && ['programming_languages','tools_technologies','other_skills'].includes(key(fact.field)))) {
    const entry = entryFromFact(fact, documents);
    if (entry.evidenceStatus === 'matched_source' && ownSpan(entry, entry.value)) canonicalSkillFields.set(normalized(entry.value), fact.field);
  }
  for (const fact of facts.flatMap(fact => recordProjections(fact, documents, canonicalSkillFields))) {
    const entry = fact.entry, field = fieldName(fact.category, fact.field);
    if (fact.category === 'personal' && field) personal[field].push(entry);
    else if (Object.hasOwn(groups, fact.category)) {
      const scope = String(fact.scope ?? '').trim();
      // Unscoped fields are kept together and conflicts remain explicit. No
      // record associations are invented from statement order or employer names.
      const groupId = normalized(scope) || '__unscoped__';
      let record = groups[fact.category].get(groupId);
      if (!record) {
        record = {id: `${fact.category}:${groupId}`, scope, originalScopes: [], fields: Object.fromEntries(Object.keys(fields[fact.category]).map(name => [name, []])), otherFacts: []};
        groups[fact.category].set(groupId, record);
      }
      if (fact.originalScope && !record.originalScopes.includes(fact.originalScope)) record.originalScopes.push(fact.originalScope);
      if (field) record.fields[field].push(entry); else record.otherFacts.push(entry);
    } else if (fact.category === 'skills') {
      const bucket = Object.entries(skillFields).find(([, aliases]) => aliases.includes(key(fact.field)))?.[0];
      if (bucket) skills[bucket].push(entry); else otherFacts.push({...entry, category: fact.category, field: fact.field, scope: fact.scope});
    } else otherFacts.push({...entry, category: fact.category, field: fact.field, scope: fact.scope});
  }
  const review = {
    schemaVersion: 1,
    personal: Object.fromEntries(Object.entries(personal).map(([field, entries]) => [field, cell(entries)])),
    employment: [], education: [], certifications: [], skills: {}, otherFacts,
    missingInformation: [], conflicts: [], possibleDuplicates: [], independentlyVerified: false
  };
  for (const category of Object.keys(groups)) {
    review[category] = [...groups[category].values()].map(record => ({
      id: record.id, scope: record.scope, originalScopes: record.originalScopes, associationStatus: record.scope ? 'source_scope' : 'requires_review',
      ...Object.fromEntries(Object.entries(record.fields).map(([field, entries]) => [field, cell(entries)])), otherFacts: record.otherFacts
    }));
    for (const record of review[category]) {
      recordReferences(record, category);
    }
    if (['employment', 'education'].includes(category)) review[category] = dedupePhysicalRecords(review[category], category, documents, review.possibleDuplicates);
  }
  // Case/whitespace duplicates share their source references. The source's
  // explicit bucket is preserved; no skill type is guessed from its name.
  const seenSkills = new Map();
  for (const [bucket, entries] of Object.entries(skills)) {
    review.skills[bucket] = [];
    for (const entry of entries) {
      const identity = normalized(entry.value);
      if (!identity || entry.value === MISSING_FACT_VALUE) continue;
      if (seenSkills.has(identity)) seenSkills.get(identity).entries.push(entry);
      else {
        const item = {value: entry.value, entries: [entry], independentlyVerified: false};
        seenSkills.set(identity, item); review.skills[bucket].push(item);
      }
    }
  }
  for (const items of Object.values(review.skills)) for (const item of items) {
    item.approvalStatus = approvalStatus(item.entries);
    item.evidenceStatus = item.entries.every(entry => entry.evidenceStatus === 'matched_source') ? 'matched_source' : 'requires_review';
  }
  const inspect = (category, recordId, values) => {
    for (const [field, value] of Object.entries(values)) {
      if (value?.status === 'missing') review.missingInformation.push({category, recordId, field, value: MISSING_FACT_VALUE});
      if (value?.status === 'conflicting') review.conflicts.push({category, recordId, field, values: value.values});
    }
  };
  inspect('personal', null, review.personal);
  for (const category of Object.keys(groups)) {
    if (!review[category].length) review.missingInformation.push({category, recordId: null, field: 'records', value: MISSING_FACT_VALUE});
    for (const record of review[category]) inspect(category, record.id, record);
  }
  for (const [bucket, items] of Object.entries(review.skills)) if (!items.length) review.missingInformation.push({category: 'skills', recordId: null, field: bucket, value: MISSING_FACT_VALUE});
  review.professionalExperience = calculateProfessionalExperience(review.employment, {documents, asOf});
  return review;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function validDate(year, month, day = 1) {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function dateParts(raw) {
  const value = String(raw ?? '').trim();
  let match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (match) {
    const year = Number(match[1]), month = Number(match[2]), day = match[3] ? Number(match[3]) : null;
    return validDate(year, month, day || 1) ? {year, month, day, precision: day ? 'day' : 'month'} : null;
  }
  // A four-digit year plus a month is unambiguous in either order. Three-part
  // numeric dates still require ISO order; DD/MM/YYYY is deliberately rejected.
  match = /^(\d{4})[/.](\d{1,2})$/.exec(value);
  if (match && validDate(Number(match[1]), Number(match[2]))) return {year: Number(match[1]), month: Number(match[2]), day: null, precision: 'month'};
  match = /^(\d{1,2})[/.\-](\d{4})$/.exec(value);
  if (match && validDate(Number(match[2]), Number(match[1]))) return {year: Number(match[2]), month: Number(match[1]), day: null, precision: 'month'};
  // Never use Date.parse: locale-dependent numeric dates and incomplete years
  // must not silently acquire a month or day.
  match = /^([A-Za-z]+)\.?[\s-]+(?:(\d{1,2}),?\s+)?(\d{4})$/.exec(value);
  if (!match) {
    const reversed = /^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/.exec(value);
    if (reversed) match = [reversed[0], reversed[2], reversed[1], reversed[3]];
  }
  if (match) {
    const monthName = match[1].toLowerCase();
    const month = MONTHS.findIndex(name => name === monthName || (monthName.length === 3 && name.startsWith(monthName)) || (monthName === 'sept' && name === 'september')) + 1;
    const year = Number(match[3]), day = match[2] ? Number(match[2]) : null;
    if (month && validDate(year, month, day || 1)) return {year, month, day, precision: day ? 'day' : 'month'};
  }
  if (/^\d{4}$/.test(value)) return {year: Number(value), precision: 'year'};
  return null;
}

function dateCell(value, documents, asOf, isEnd) {
  if (!value || value.status === 'missing' || !value.entries?.length) return {reason: 'missing_date'};
  if (value.status === 'conflicting' || value.entries.some(entry => entry.conflict)) return {reason: 'conflicting_date'};
  if (value.status !== 'provided' || value.entries.some(entry => !matchedEvidence(entry.evidence, documents))) return {reason: 'unmatched_source'};
  const raw = value.value;
  if (typeof raw !== 'string' || value.entries.some(entry => {
    const ownValue = typeof entry.value === 'string' ? entry.value : raw;
    return !entry.evidence.some(ref => ref.quote.includes(ownValue)) || dateIdentity(ownValue, isEnd) !== dateIdentity(raw, isEnd);
  })) return {reason: 'date_not_explicit_in_source'};
  const ongoing = /^(present|pres\.?|current|currently|ongoing|to date|till date|now)$/i.test(raw);
  if (ongoing && !isEnd) return {reason: 'invalid_start_date'};
  if (ongoing && !asOf) return {reason: 'ongoing_requires_explicit_as_of'};
  const parts = dateParts(ongoing ? asOf : raw);
  if (!parts) return {reason: ongoing ? 'invalid_as_of' : 'invalid_or_ambiguous_date'};
  if (parts.precision === 'year') return {reason: 'insufficient_date_precision'};
  return {...parts, raw, ongoing};
}

const DAY = 86400000;
const ordinal = date => date.precision === 'month' ? date.year * 12 + date.month - 1 : Math.round(Date.UTC(date.year, date.month - 1, date.day) / DAY);
const iso = (position, precision) => precision === 'month'
  ? `${Math.floor(position / 12)}-${String(position % 12 + 1).padStart(2, '0')}`
  : new Date(position * DAY).toISOString().slice(0, 10);
function duration(start, end, precision) {
  if (precision === 'month') return {totalMonths: end - start + 1, residualDays: 0};
  // Exact end dates are inclusive. Calendar months are computed before summing
  // separate periods; residual days are shown, never converted using 30 days.
  const first = new Date(start * DAY), exclusiveEnd = new Date((end + 1) * DAY);
  let months = (exclusiveEnd.getUTCFullYear() - first.getUTCFullYear()) * 12 + exclusiveEnd.getUTCMonth() - first.getUTCMonth();
  const anchorAt = count => {
    const month = first.getUTCMonth() + count;
    const last = new Date(Date.UTC(first.getUTCFullYear(), month + 1, 0)).getUTCDate();
    return Date.UTC(first.getUTCFullYear(), month, Math.min(first.getUTCDate(), last));
  };
  if (anchorAt(months) > exclusiveEnd.getTime()) months--;
  return {totalMonths: months, residualDays: Math.round((exclusiveEnd.getTime() - anchorAt(months)) / DAY), totalDays: end - start + 1};
}
function describedDuration(totalMonths, residualDays = 0) {
  const years = Math.floor(totalMonths / 12), months = totalMonths % 12;
  return {years, months, totalMonths, residualDays, label: `${years} years ${months} months${residualDays ? ` + ${residualDays} days` : ''}`};
}

/**
 * Union explicit, evidence-matched employment dates without double counting.
 * Month precision: inclusive calendar-month coverage, not day-exact tenure.
 * Day precision: inclusive days with completed calendar months + residual days.
 * Precision is never invented or mixed; missing/conflicting records block the
 * aggregate even if other records have individually calculable durations.
 */
export function calculateProfessionalExperience(records, {documents = [], asOf} = {}) {
  const sourceRecords = Array.isArray(records) ? records : [];
  const result = {
    status: 'unavailable', label: UNAVAILABLE_EXPERIENCE,
    basis: 'source_stated_dates', independentlyVerified: false,
    approvalStatus: 'none', evidenceStatus: 'incomplete', precision: null,
    totalMonths: null, years: null, months: null, residualDays: null,
    records: [], mergedPeriods: [], issues: [], asOf: asOf || null
  };
  const entries = sourceRecords.flatMap(record => [...(record.startDate?.entries || []), ...(record.endDate?.entries || [])]);
  result.approvalStatus = approvalStatus(entries);
  if (!sourceRecords.length) { result.issues.push({reason: 'no_employment_records'}); return result; }
  const intervals = [];
  for (const record of sourceRecords) {
    const start = dateCell(record.startDate, documents, asOf, false), end = dateCell(record.endDate, documents, asOf, true);
    let reason = start.reason || end.reason;
    // Present has no stated end-date precision. For a source month-precision
    // start, an explicitly supplied review day identifies the current calendar
    // month without inventing a source day. Explicit dated ends remain strict.
    if (!reason && end.ongoing && start.precision === 'month' && end.precision === 'day') {
      end.day = null; end.precision = 'month';
    }
    if (!reason && start.precision !== end.precision) reason = 'mixed_date_precision';
    if (!reason && ordinal(start) > ordinal(end)) reason = 'end_precedes_start';
    if (record.associationStatus === 'requires_review') reason = 'unresolved_record_association';
    const row = {id: record.id, scope: record.scope, companyName: record.companyName?.value || MISSING_FACT_VALUE,
      status: reason ? 'unavailable' : 'calculated', label: UNAVAILABLE_EXPERIENCE,
      approvalStatus: approvalStatus([...(record.startDate?.entries || []), ...(record.endDate?.entries || [])]), independentlyVerified: false};
    if (reason) { row.reason = reason; result.issues.push({recordId: record.id, reason}); }
    else {
      const interval = {start: ordinal(start), end: ordinal(end), precision: start.precision, recordIds: [record.id]};
      const calculated = duration(interval.start, interval.end, interval.precision);
      Object.assign(row, describedDuration(calculated.totalMonths, calculated.residualDays), {
        precision: interval.precision, start: iso(interval.start, interval.precision), end: iso(interval.end, interval.precision),
        usesAsOf: end.ongoing, ...(calculated.totalDays == null ? {} : {totalDays: calculated.totalDays})
      });
      intervals.push(interval);
    }
    result.records.push(row);
  }
  const precisions = [...new Set(intervals.map(interval => interval.precision))];
  if (precisions.length > 1) result.issues.push({reason: 'mixed_record_precision'});
  if (result.issues.length || !intervals.length) return result;
  const precision = precisions[0], merged = [];
  for (const interval of intervals.sort((left, right) => left.start - right.start || left.end - right.end)) {
    const last = merged.at(-1);
    // Adjacent non-overlapping records remain distinct. Only actual overlap is
    // merged; summing consecutive periods yields the same month/day coverage.
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end); last.recordIds.push(...interval.recordIds);
    } else merged.push({...interval, recordIds: [...interval.recordIds]});
  }
  let totalMonths = 0, residualDays = 0, totalDays = 0;
  for (const period of merged) {
    const calculated = duration(period.start, period.end, precision);
    totalMonths += calculated.totalMonths; residualDays += calculated.residualDays; totalDays += calculated.totalDays || 0;
    result.mergedPeriods.push({start: iso(period.start, precision), end: iso(period.end, precision), recordIds: period.recordIds,
      ...describedDuration(calculated.totalMonths, calculated.residualDays), ...(precision === 'day' ? {totalDays: calculated.totalDays} : {})});
  }
  Object.assign(result, describedDuration(totalMonths, residualDays), {
    status: 'calculated', evidenceStatus: 'matched_source', precision,
    countingConvention: precision === 'month' ? 'Inclusive calendar-month coverage at source precision; not day-exact tenure.'
      : 'Inclusive source dates; completed calendar months plus residual days, with no fixed days-per-month conversion.',
    ...(precision === 'day' ? {totalDays} : {})
  });
  if (result.records.some(record => record.usesAsOf)) {
    const supplied = dateParts(asOf);
    result.asOfPrecision = supplied.precision;
    result.asOfCoverage = precision === 'month' ? `${supplied.year}-${String(supplied.month).padStart(2, '0')}` : iso(ordinal(supplied), 'day');
    result.asOfLabel = precision === 'month'
      ? `Source-stated ongoing employment counted through calendar month ${result.asOfCoverage}, using supplied review date ${asOf}.`
      : `Source-stated ongoing employment counted through supplied review date ${asOf}.`;
    result.countingConvention += ' ' + result.asOfLabel;
  }
  return result;
}
