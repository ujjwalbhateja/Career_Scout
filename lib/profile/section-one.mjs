// Section 1 only: literal resume records, with no model calls or approvals.
export const SECTION_ONE_PARSER_VERSION = 'section-one-source-v3';
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const normal = value => text(value).toLowerCase().replace(/\s+/g, ' ');
const fieldKey = value => normal(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const jobWords = /\b(?:analyst|associate|manager|director|president|officer|engineer|consultant|specialist|lead|head|intern|executive|coordinator|supervisor|administrator|developer|designer|researcher|assistant|partner|counsel)\b/i;
const qualificationWords = /\b(?:bachelor|master|doctor|ph\.?d|mba|m\.?sc|b\.?sc|degree|diploma|qualification)\b/i;
const genericEntity = /^(?:employment|experience|education|qualifications?|skills?|personal|resume|professional experience|unknown|missing|not provided)$/i;
const actionSentence = /^(?:I\b|we\b|managed\b|manage\b|prepared\b|prepare\b|delivered\b|built\b|developed\b|supported\b|worked\b|collaborated\b|supervised\b|led\b|responsible\b)/i;
const programmingLanguages = new Set(['sql', 'python', 'vba', 'javascript', 'typescript', 'java', 'c', 'c++', 'c#', 'r', 'go', 'rust', 'scala', 'julia', 'ruby', 'perl', 'swift', 'kotlin', 'php', 'bash', 'powershell']);
const phone = '(?:\\+?\\d|\\(\\d{2,4}\\))[\\d ()+.-]{5,}\\d';
const month = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)';
const date = `(?:\\d{4}-\\d{2}(?:-\\d{2})?|\\d{1,2}[/.-]\\d{4}|${month}\\.?\\s*\\d{2}(?:\\d{2})?|\\d{4})`;
const endDate = `(?:Present|Currently|Current|Ongoing|Pres\\.?|To date|Till date|${date})`;
const rangePattern = () => new RegExp(`(?<![\\p{L}\\p{N}/.-])(${date})\\s*(?:[–—−‐‑-]|to|through|until)\\s*(${endDate})(?![\\p{L}\\p{N}/-]|\\.\\d)`, 'giu');

function literal(source, value) {
  if (!text(value)) return null;
  const left = /^[\p{L}\p{N}]/u.test(value) ? '(?<![\\p{L}\\p{N}])' : '';
  const right = /[\p{L}\p{N}]$/u.test(value) ? '(?![\\p{L}\\p{N}])' : '';
  const match = new RegExp(left + escaped(value) + right, 'iu').exec(source);
  return match ? {value: match[0], index: match.index, end: match.index + match[0].length} : null;
}
function rangeIn(line) {
  const matches = [...line.matchAll(rangePattern())].filter(match => !/^\d{4}-\d{2}(?:-\d{2})?$/.test(match[0]));
  if (matches.length !== 1) return null;
  const match = matches[0];
  return {start: match[1], end: match[2], index: match.index, raw: match[0]};
}
function columns(value) { return value.split(/\t+|[ \u00a0]{2,}|\s+[|·•]\s+/).map(text).filter(Boolean); }
function locationLike(value, allowPlain = false) {
  return !!text(value) && value.length <= 100 && !/@|https?:|\d/.test(value)
    && (/^[\p{L} .'-]+(?:,\s*[\p{L} .'-]+){1,3}$/u.test(value)
      || allowPlain && /^[\p{L} .'-]+$/u.test(value) && value.split(/\s+/).length <= 4 && !jobWords.test(value) && !qualificationWords.test(value) && !genericEntity.test(value));
}
function placeBeforeTitle(value) {
  const cleaned = value.trim().replace(/^[|·•,;\s]+|[|·•;\s]+$/g, '');
  return locationLike(cleaned, true) ? cleaned : null;
}
function knownValues(document, facts, category, type) {
  const candidates = [];
  for (const fact of facts.filter(fact => fact.category === category && fact.lifecycle !== 'superseded' && !['rejected', 'withdrawn'].includes(fact.approval))) {
    const key = fieldKey(fact.field);
    if (type === 'entity') {
      if (['company_name', 'employer', 'employer_name', 'institution_name', 'university_name', 'institution', 'university'].includes(key)) candidates.push(fact.value || fact.statement);
      if (!genericEntity.test(text(fact.scope)) && !/[|/]/.test(text(fact.scope))) candidates.push(fact.scope);
    } else if (type === 'title') {
      if (['job_title', 'role_title', 'position_title', 'designation', 'qualification', 'degree', 'degree_name', 'qualification_name'].includes(key)) candidates.push(fact.value || fact.statement);
      else if ((category === 'employment' ? jobWords : qualificationWords).test(text(fact.field))) candidates.push(fact.field);
    } else if (type === 'name' && ['name', 'full_name', 'candidate_name'].includes(key)) {
      candidates.push(fact.value || fact.statement);
      for (const ref of list(fact.evidence).filter(ref => ref.documentId === document.id)) candidates.push(ref.quote);
    }
  }
  return [...new Map(candidates.map(text).filter(value => value && value.length <= 180
    && document.segments.some(segment => literal(segment.text, value))).map(value => [normal(value), value])).values()]
    .sort((a, b) => b.length - a.length);
}
function firstKnown(line, values) {
  const matches = values.map(value => literal(line, value)).filter(Boolean);
  return matches.sort((a, b) => a.index - b.index || b.value.length - a.value.length)[0] || null;
}

/**
 * Extract literal factual-record proposals; never writes or approves anything.
 * Short years remain short years. Source headings establish bounded record
 * context, not new work, projects, degree completion or professional tenure.
 * @param {any} document
 * @param {{knownFacts?:any[]}} [options]
 */
export function extractSectionOneFacts(document, {knownFacts = []} = {}) {
  const result = {parserVersion: SECTION_ONE_PARSER_VERSION, facts: [], unresolved: [], coverage: {sourceSegments: 0, sectionOneSegmentIds: [], untouchedSegmentIds: []}};
  if (!document || document.kind !== 'resume' || document.deleted || !text(document.id) || !Array.isArray(document.segments)) {
    result.unresolved.push({field: 'document', reason: 'A surviving resume document with source segments is required.'}); return result;
  }
  result.coverage.sourceSegments = document.segments.length;
  const employers = knownValues(document, knownFacts, 'employment', 'entity');
  const positions = knownValues(document, knownFacts, 'employment', 'title');
  const institutions = knownValues(document, knownFacts, 'education', 'entity');
  const qualifications = knownValues(document, knownFacts, 'education', 'title');
  const names = knownValues(document, knownFacts, 'personal', 'name');
  const seen = new Set(), touched = new Set();
  const ref = (segment, quote) => ({documentId: document.id, segmentId: segment.id, quote});
  const emit = (category, field, scope, value, segment, context = []) => {
    const statement = text(value);
    if (!statement || !segment.text.includes(statement)) return;
    const signature = JSON.stringify([category, field, normal(scope), normal(statement)]);
    if (seen.has(signature)) return;
    const evidence = [...new Map([ref(segment, statement), ...context].filter(source => source.quote
      && document.segments.some(part => part.id === source.segmentId && part.text.includes(source.quote))).map(source => [JSON.stringify(source), source])).values()].slice(0, 8);
    result.facts.push({category, field, scope, statement, evidence}); seen.add(signature);
    for (const source of evidence) touched.add(source.segmentId);
  };
  const issue = (segment, field, reason) => result.unresolved.push({segmentId: segment.id, field, reason});
  const lines = document.segments.flatMap(segment => String(segment.text || '').split(/\r?\n/).map(raw => ({segment, raw, line: raw.trim()})).filter(item => item.line));
  const sectionHeading = /^(?:professional experience|work experience|employment history|education|academic qualifications?|certifications?|core competencies|skills|technical skills|technical tools|tools and technologies|programming languages|projects?|publications?|awards?|interests?|references?|volunteer experience)\s*:?$/i;
  const nonRecordHeading = /^(?:projects?|personal projects?|academic projects?|selected projects?|publications?|awards?|interests?|references?|volunteer experience|(?:professional |career )?summary|(?:career )?objective|profile)\s*:?$/i;
  const titleAndLocation = line => {
    const parts = line.split(/\s*\|\s*/).map(text);
    return parts.length === 2 && jobWords.test(parts[0]) && !actionSentence.test(parts[0]) && locationLike(parts[1]) ? {title: parts[0], location: parts[1]} : null;
  };
  const skillBoundary = line => sectionHeading.test(line) || !!rangeIn(line) || !!titleAndLocation(line)
    || /^[\p{L}][\p{L} &/()'-]{0,60}:\s*/u.test(line) || /^[•*\-–—]\s*/.test(line) || actionSentence.test(line)
    || /^[A-Z][A-Z &/ -]{3,}$/.test(line) && !programmingLanguages.has(normal(line));
  const emitSkillList = (index, content, field) => {
    const parts = [{segment: lines[index].segment, content}], firstHasList = /[,;]/.test(content);
    let next = index + 1;
    while (firstHasList && next < lines.length && !/[.!?]\s*$/.test(parts.at(-1).content)
      && !skillBoundary(lines[next].line) && lines[next].line.length <= 400
      && (/[,;]/.test(lines[next].line) || /[,;]\s*$/.test(parts.at(-1).content))) {
      parts.push({segment: lines[next].segment, content: lines[next].line}); next++;
    }
    const joined = parts.map(part => part.content).join(' ');
    for (const match of joined.split(/[,;]|\s+and\s+/i)) {
      const value = match.trim().replace(/\.$/, '').trim();
      if (!value || value.length > 100 || value.split(/\s+/).length > 12) continue;
      const own = parts.find(part => part.content.includes(value));
      if (own) emit('skills', programmingLanguages.has(normal(value)) ? 'programming_languages' : field, 'Explicitly listed skills', value, own.segment);
      else issue(parts[0].segment, field, 'A listed skill spans source lines; an exact contiguous source quote is required before proposing the complete term.');
    }
    return next - 1;
  };
  const emitLayoutRecord = ({category, entity, title, titleSegment, titleLine, range, dateSegment, dateLine, location}) => {
    const scope = [entity.name, title, range.start, range.end].join(' | ');
    const context = [ref(dateSegment, dateLine), ref(titleSegment, titleLine)];
    emit(category, category === 'education' ? 'institution_name' : 'company_name', scope, entity.name, entity.segment, context);
    emit(category, category === 'education' ? 'qualification' : 'job_title', scope, title, titleSegment, context);
    emit(category, 'start_date', scope, range.start, dateSegment, context);
    emit(category, 'end_date', scope, range.end, dateSegment, context);
    if (location) emit(category, 'location', scope, location, titleSegment, context);
    for (const [field, value] of [['start_date', range.start], ['end_date', range.end]]) if (new RegExp(`^${month}\\.?\\s*\\d{2}$`, 'i').test(value))
      issue(dateSegment, field, 'Literal two-digit year preserved; no century was assumed for duration calculation.');
  };
  let mode = 'personal', employer = null, institution = null, skillField = 'other_skills';
  let personName = null;
  for (let i = 0; i < lines.length; i++) {
    const {segment, line} = lines[i];
    if (/^(?:professional |work |employment )?experience\s*:?$/i.test(line) || /^employment history\s*:?$/i.test(line)) { mode = 'employment'; employer = null; continue; }
    if (/^(?:education|academic qualifications?)(?:\s+(?:and|&)\s+certifications?)?\s*:?$/i.test(line)) { mode = 'education'; employer = null; institution = null; continue; }
    if (/^certifications?\s*:?$/i.test(line)) { mode = 'certifications'; employer = null; institution = null; continue; }
    if (/^(?:skills|technical skills|technical tools|tools and technologies|programming languages|core competencies)\s*:?$/i.test(line)) {
      mode = 'skills'; skillField = /programming/i.test(line) ? 'programming_languages' : /tools/i.test(line) ? 'tools_technologies' : 'other_skills';
      employer = null; institution = null; continue;
    }
    if (nonRecordHeading.test(line)) { mode = 'outside'; employer = null; institution = null; continue; }

    if (mode === 'skills' && skillBoundary(line) && !/^[\p{L}][\p{L} &/()'-]{0,60}:\s*/u.test(line)) {
      mode = 'outside'; employer = null; institution = null;
      if (sectionHeading.test(line) || /^[A-Z][A-Z &/ -]{3,}$/.test(line)) continue;
    }
    const skill = /^(programming languages|technical tools(?:\s*\(skills\))?|tools and technologies|tools|other skills|skills(?: and competencies)?)\s*:\s*(.+)$/i.exec(line)
      || mode === 'skills' && /^([\p{L}][\p{L} &/()'-]{0,60})\s*:\s*(.+)$/u.exec(line);
    if (skill) {
      if (/^(?:employer|company|job title|role title|location|dates?|period)$/i.test(skill[1]) || actionSentence.test(skill[2])) { mode = 'outside'; continue; }
      const field = /^programming/i.test(skill[1]) ? 'programming_languages' : /tools/i.test(skill[1]) ? 'tools_technologies' : 'other_skills';
      i = emitSkillList(i, skill[2], field);
      mode = 'skills'; employer = null; institution = null; continue;
    }
    if (mode === 'skills' && !actionSentence.test(line) && line.length <= 400) {
      const values = line.split(/\s*[,;|]\s*|\s+and\s+/i).map(value => value.replace(/^[•*\-\s]+/, '').trim()).filter(Boolean);
      if (values.length && values.every(value => value.length <= 100 && value.split(/\s+/).length <= 8))
        for (const value of values) emit('skills', programmingLanguages.has(normal(value)) ? 'programming_languages' : skillField, 'Explicitly listed skills', value, segment);
      continue;
    }
    if (mode === 'outside' || mode === 'employment' && /^[•*\-–—−]\s*/.test(line)) continue;
    const range = rangeIn(line);
    const category = mode === 'education' ? 'education' : 'employment';
    const candidateTitles = category === 'education' ? qualifications : positions;
    const candidateEntities = category === 'education' ? institutions : employers;
    const knownTitle = range && firstKnown(line.slice(0, range.index), candidateTitles);
    const knownEntity = firstKnown(line, candidateEntities);

    // Some PDF layouts put the employer and dates on one line, followed by an
    // explicit title/location pair. Only this immediately adjacent pair binds.
    if (mode === 'employment' && range && !actionSentence.test(line)) {
      const prefix = line.slice(0, range.index).trim().replace(/[|;\s]+$/, '');
      const following = lines[i + 1], nextTitle = following && titleAndLocation(following.line);
      if (prefix && prefix.length <= 180 && !jobWords.test(prefix) && !genericEntity.test(prefix) && nextTitle) {
        const entity = {name: prefix, segment, quote: line, location: nextTitle.location};
        const title = firstKnown(nextTitle.title, positions)?.value || nextTitle.title;
        emitLayoutRecord({category: 'employment', entity, title, titleSegment: following.segment, titleLine: following.line,
          range, dateSegment: segment, dateLine: line, location: nextTitle.location});
        employer = entity; i++; continue;
      }
    }
    // Degree-first pipe columns are an explicit education record, rather than
    // the institution-first columns handled by the older layouts below.
    if (mode === 'education' && range && !actionSentence.test(line)) {
      const parts = line.slice(0, range.index).trim().split(/\s*\|\s*/).map(text);
      if (parts.length === 2 && qualificationWords.test(parts[0])
        && (/\b(?:university|college|institute|institution|school|academy|polytechnic)\b/i.test(parts[1]) || firstKnown(parts[1], institutions)?.index === 0)) {
        const entity = {name: firstKnown(parts[1], institutions)?.value || parts[1], segment, quote: line, location: null};
        const title = firstKnown(parts[0], qualifications)?.value || parts[0];
        emitLayoutRecord({category: 'education', entity, title, titleSegment: segment, titleLine: line, range, dateSegment: segment, dateLine: line});
        institution = entity; continue;
      }
    }

    if (mode === 'personal' && !range && !knownEntity) {
      const knownName = firstKnown(line, names);
      if (!personName && knownName) { personName = knownName.value; emit('personal', 'full_name', 'personal', personName, segment); }
      if (!personName && i === 0) {
        const boundaries = [line.search(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i), line.search(new RegExp(phone)), line.search(/https?:|www\./i), line.indexOf('|')].filter(index => index >= 0);
        const head = line.slice(0, boundaries.length ? Math.min(...boundaries) : line.length).trim().replace(/[|·•,;\s]+$/, '');
        const label = /^(?:full name|name)\s*:\s*(.+)$/i.exec(head);
        const first = label?.[1]?.trim() || columns(head)[0];
        if (first && first.length <= 100 && /^[\p{L} .'-]+$/u.test(first) && first.split(/\s+/).length >= 2 && first.split(/\s+/).length <= 6
          && !/experience|education|resume|curriculum|skills|certification|summary|professional|objective|profile/i.test(first) && !jobWords.test(first)) {
          personName = first; emit('personal', 'full_name', 'personal', first, segment);
        }
      }
      for (const match of line.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) emit('personal', 'email', 'personal', match[0], segment);
      for (const match of line.matchAll(new RegExp(phone, 'g'))) if (match[0].replace(/\D/g, '').length >= 8 && match[0].replace(/\D/g, '').length <= 15)
        emit('personal', 'mobile', 'personal', match[0], segment);
      const address = /(?:^|[|;])\s*(?:residential address|home address|address)\s*:\s*([^|;]+)/i.exec(line);
      if (address) emit('personal', 'address', 'personal', address[1].trim(), segment);
      const possibleHeader = columns(line);
      if (!(possibleHeader.length === 2 && locationLike(possibleHeader[1]))) continue;
    }

    if (range && !actionSentence.test(line) && mode !== 'skills' && mode !== 'certifications') {
      let entity = null, location = null, title = knownTitle?.value || null;
      const prefix = line.slice(0, range.index).trim();
      const parts = columns(prefix);
      if (knownEntity?.index === 0 && (parts.length >= 2 || knownTitle && knownTitle.index > knownEntity.end)) {
        entity = {name: knownEntity.value, segment, quote: line, location: null};
        if (knownTitle && knownTitle.index > knownEntity.end) location = placeBeforeTitle(line.slice(knownEntity.end, knownTitle.index));
      } else if (parts.length >= 2 && !(category === 'education' ? qualificationWords : jobWords).test(parts[0])) {
        const first = parts[0], rest = parts.slice(1).join(' ');
        if (category === 'employment' || /university|college|institute|school|academy/i.test(first)) {
          entity = {name: first, segment, quote: line, location: null};
          if (knownTitle) location = placeBeforeTitle(line.slice(line.indexOf(first) + first.length, knownTitle.index));
          if (!title) {
            const locationPrefix = /^([\p{L} .'-]+,\s*[A-Z]{2})\s+(?=[\p{L}])/u.exec(rest);
            if (locationPrefix) { location = locationPrefix[1]; title = rest.slice(locationPrefix[0].length).trim(); }
            else title = rest;
          }
        }
      }
      if (!title) title = parts.length === 1 ? prefix : parts.at(-1);
      if (!title || !(category === 'education' ? qualificationWords : jobWords).test(title)) continue;
      if (knownTitle && knownTitle.index > 0 && !entity) continue;
      if (title === prefix && parts.length > 1) continue;
      if (entity) { entity.location = location; if (category === 'education') institution = entity; else employer = entity; }
      const current = entity || (category === 'education' ? institution : employer);
      const scope = [current?.name || (category === 'education' ? 'Education record' : 'Employment record'), title, range.start, range.end].join(' | ');
      const context = [ref(segment, line), ...(current ? [ref(current.segment, current.quote)] : [])];
      if (current) {
        emit(category, category === 'education' ? 'institution_name' : 'company_name', scope, current.name, current.segment, context);
        if (current.location) emit(category, 'location', scope, current.location, current.segment, context);
      } else issue(segment, category === 'education' ? 'institution_name' : 'company_name', 'No unambiguous source header establishes this record entity.');
      emit(category, category === 'education' ? 'qualification' : 'job_title', scope, title, segment, context);
      emit(category, 'start_date', scope, range.start, segment, context);
      emit(category, 'end_date', scope, range.end, segment, context);
      for (const [field, value] of [['start_date', range.start], ['end_date', range.end]]) if (new RegExp(`^${month}\\.?\\s*\\d{2}$`, 'i').test(value))
        issue(segment, field, 'Literal two-digit year preserved; no century was assumed for duration calculation.');
      if (mode === 'personal') mode = 'employment';
      continue;
    }

    // Explicit entity/location columns create context for all following role
    // headers until the next entity or section; work paragraphs create no facts.
    const parts = columns(line);
    if (!range && parts.length === 2 && locationLike(parts[1], !!knownEntity) && !actionSentence.test(parts[0])) {
      const kind = mode === 'education' ? 'education' : 'employment';
      const literalKnown = firstKnown(parts[0], kind === 'education' ? institutions : employers);
      const name = literalKnown?.index === 0 ? literalKnown.value : parts[0];
      if (normal(name) === normal(parts[0]) && !genericEntity.test(name)) {
        const context = {name, location: parts[1], segment, quote: line};
        if (kind === 'education') institution = context; else { employer = context; mode = 'employment'; }
        continue;
      }
    }
    const certificate = /^(?:certification|certificate)\s*:\s*(.+)$/i.exec(line);
    if (certificate && ['education', 'certifications'].includes(mode)) {
      const explicitDate = new RegExp(`^(.*?)(?:\\s*[|;]\\s*)(?:issued|issue date|completed|completion date)\\s*:\\s*(${date})(?![\\p{L}\\p{N}])\\s*$`, 'iu').exec(certificate[1]);
      const name = text(explicitDate?.[1] || certificate[1]);
      emit('certifications', 'certification_name', name, name, segment);
      if (explicitDate) emit('certifications', 'issue_date', name, explicitDate[2], segment, [ref(segment, line)]);
    }
  }
  result.coverage.sectionOneSegmentIds = [...touched];
  result.coverage.untouchedSegmentIds = document.segments.filter(segment => !touched.has(segment.id)).map(segment => segment.id);
  return result;
}
