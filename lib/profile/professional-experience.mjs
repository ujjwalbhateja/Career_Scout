import {extractSectionOneFacts} from './section-one.mjs';

const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const plain = value => text(value).replace(/^[•*\-]\s*/, '').replace(/\s+/g, ' ');
const normalized = value => plain(value).toLowerCase();
const clone = value => structuredClone(value);
const uniqueRefs = refs => [...new Map(refs.map(ref => [JSON.stringify([ref.documentId, ref.documentVersion, ref.segmentId, ref.quote]), ref])).values()];
const identity = value => `${value.id}:${value.version}`;
const refOf = fact => ({id: fact.id, version: fact.version, approvalRef: fact.approvalRef || null});
const workField = /^(?:responsibilit(?:y|ies)|duties|tasks?|work performed|projects?|project work|deliverables?|ownership|leadership|client work|stakeholder work|achievements?|accomplishments?|outcomes?|processes?)(?: scope| details)?$/i;
const workFact = fact => ['experience_claims', 'quantitative_claims', 'client_relationships'].includes(fact.category)
  || fact.category === 'employment' && workField.test(String(fact.field || '').replaceAll('_', ' '));
const active = fact => (!fact.lifecycle || fact.lifecycle === 'active') && !fact.conflict;
const action = /\b(?:manage[ds]?|managing|led|lead(?:ing)?|supervis\w*|mentor\w*|coordinat\w*|partner\w*|build|built|building|develop\w*|design\w*|deliver\w*|execut\w*|implement\w*|automat\w*|prepar\w*|produc\w*|analy[sz]\w*|evaluat\w*|research\w*|investigat\w*|forecast\w*|reconcil\w*|support\w*|assist\w*|monitor\w*|improv\w*|reduc\w*|increas\w*|negotiat\w*|price[ds]?|train\w*|teach\w*|taught|treat\w*|care\w*|administer\w*|assess\w*|document\w*|maintain\w*|creat\w*|collaborat\w*|perform\w*|handl\w*|facilitat\w*|resolv\w*|investigat\w*|install\w*|repair\w*|plan\w*|test\w*|validat\w*|deploy\w*|responsible\s+for)\b/i;
const excludedHeading = /^(?:education(?:\s+(?:and|&|\/)\s+(?:professional\s+)?(?:certifications?|qualifications?|training))?|academic(?: qualifications?| projects?)?|qualifications?|certifications?|courses?|coursework|relevant coursework|skills(?:\s+(?:and|&)\s+(?:competencies|technologies|tools))?|technical skills|technical tools(?:\s*\(skills\))?|programming languages|languages|tools and technologies|technology stack|toolset|core competencies|competencies|personal details|contact(?: details)?|references?|interests?|hobbies)\s*:?$/i;
const workHeading = /^(?:(?:(?:professional|work|employment|earlier|previous|clinical|nursing|teaching|research|volunteer|relevant)\s+)?experience|employment history|work history|projects?|selected projects|research projects|achievements|accomplishments)\s*:?$/i;
const metadataHeading = /^(?:responsibilities|key responsibilities|duties|selected achievements|professional summary|summary|profile|objective|career objective|curriculum vitae|resume)\s*:?$/i;
const datedHeader = /(?:\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s*\d{2,4}|\b\d{4})\s*[-–—−‐‑]\s*(?:Pres(?:ent)?\.?|Current|[A-Za-z]+\.?\s*\d{2,4}|\d{4})/i;

function sourceFor(document, segment, quote) {
  return {documentId: document.id, documentVersion: document.version, segmentId: segment.id, quote, locator: segment.locator || ''};
}
function validEvidence(state, fact) {
  return list(fact.evidence).length > 0 && fact.evidence.every(ref => {
    const document = list(state.documents).find(document => document.id === ref.documentId && !document.deleted && ['resume', 'answer'].includes(document.kind));
    const segment = list(document?.segments).find(segment => segment.id === ref.segmentId);
    return segment && text(ref.quote) && segment.text.includes(ref.quote)
      && (ref.documentVersion == null || document.version == null || ref.documentVersion === document.version);
  });
}
function validApproval(state, fact) {
  return active(fact) && fact.approval === 'approved' && validEvidence(state, fact)
    && list(state.approvals).some(approval => approval.id === fact.approvalRef && approval.kind === 'fact'
      && approval.recordId === fact.id && approval.recordVersion === fact.version && approval.decision === 'approved');
}
function approvalFor(state, facts, document, segment, statement) {
  const approvedClaims = [], pendingFactRefs = [];
  for (const fact of facts.filter(fact => active(fact) && workFact(fact) && validEvidence(state, fact))) {
    const linked = list(fact.evidence).filter(ref => ref.documentId === document.id && ref.segmentId === segment.id
      && (ref.quote.includes(statement) || statement.includes(ref.quote)));
    if (!linked.length) continue;
    // A broad evidence quote cannot spread a literal narrower approved claim
    // into another line of that same source segment.
    const literalClaim = segment.text.includes(text(fact.statement));
    if (literalClaim && !normalized(statement).includes(normalized(fact.statement)) && !normalized(fact.statement).includes(normalized(statement))) continue;
    if (!validApproval(state, fact)) {
      if (fact.approval === 'pending') pendingFactRefs.push(refOf(fact));
      continue;
    }
    const full = normalized(fact.statement) === normalized(statement) && linked.some(ref => ref.quote.includes(statement));
    const coveredQuotes = linked.flatMap(ref => statement.includes(ref.quote) && ref.quote.length < statement.length ? [ref.quote]
      : statement.includes(text(fact.statement)) ? [text(fact.statement)] : []);
    approvedClaims.push({factId: fact.id, version: fact.version, approvalRef: fact.approvalRef,
      statement: fact.statement, evidence: clone(linked), coverage: full ? 'full' : 'partial', coveredQuotes,
      confirmation: fact.confirmation || 'source_stated', independentlyVerified: false});
  }
  const approvalStatus = approvedClaims.some(claim => claim.coverage === 'full') ? 'approved' : approvedClaims.length ? 'partial' : 'needs_review';
  return {approvalStatus, approvedClaims, approvedFactRefs: approvedClaims.map(claim => ({id: claim.factId, version: claim.version, approvalRef: claim.approvalRef})),
    pendingFactRefs, coveredQuotes: [...new Set(approvedClaims.flatMap(claim => claim.coveredQuotes))],
    reviewNote: approvalStatus === 'approved' ? 'This complete statement matches an approved fact version.'
      : approvalStatus === 'partial' ? 'Only the linked existing claim(s) are approved. Other details in this source passage need their own review.'
        : 'Resume-stated work; this complete passage has not been approved as a fact.'};
}

function wrappedApproval(state, facts, document, fragments, statement) {
  const portions = fragments.map(fragment => approvalFor(state, facts, document, fragment.segment, fragment.quote));
  const claims = [...new Map(portions.flatMap(portion => portion.approvedClaims).map(claim => [identity({id: claim.factId, version: claim.version}), claim])).values()];
  const approvedClaims = claims.map(claim => {
    const fact = facts.find(fact => fact.id === claim.factId && fact.version === claim.version);
    const full = normalized(claim.statement) === normalized(statement) && fragments.every(fragment => list(fact?.evidence).some(ref => ref.documentId === document.id && ref.segmentId === fragment.segment.id && ref.quote.includes(fragment.quote)));
    return {...claim, coverage: full ? 'full' : 'partial', coveredQuotes: full ? fragments.map(fragment => fragment.quote)
      : [...new Set(portions.flatMap(portion => portion.approvedClaims.filter(value => value.factId === claim.factId && value.version === claim.version).flatMap(value => value.coveredQuotes)))],
      evidence: uniqueRefs(portions.flatMap(portion => portion.approvedClaims.filter(value => value.factId === claim.factId && value.version === claim.version).flatMap(value => value.evidence)))};
  });
  const approvalStatus = approvedClaims.some(claim => claim.coverage === 'full') ? 'approved' : approvedClaims.length ? 'partial' : 'needs_review';
  return {approvalStatus, approvedClaims, approvedFactRefs: approvedClaims.map(claim => ({id: claim.factId, version: claim.version, approvalRef: claim.approvalRef})),
    pendingFactRefs: [...new Map(portions.flatMap(portion => portion.pendingFactRefs).map(ref => [identity(ref), ref])).values()],
    coveredQuotes: [...new Set(approvedClaims.flatMap(claim => claim.coveredQuotes))],
    reviewNote: approvalStatus === 'approved' ? 'The complete wrapped statement and every original source fragment match an approved fact version.'
      : approvalStatus === 'partial' ? 'Only the linked claim(s) are approved; the rest of this wrapped source statement still needs review.'
        : 'PDF-wrapped source statement; original fragment quotes are preserved and the complete statement needs review.'};
}

const areaRules = [
  ['Leadership and team management', value => /\b(?:manage[ds]?|managing|led|lead(?:ing)?|supervis\w*|mentor\w*|coordinat\w*)\b[\s\S]{0,70}\b(?:team|teams|people|staff|employees|analysts|engineers|nurses)\b/i.test(value)],
  ['Clinical and patient care', value => /\b(?:patient|patients|clinical|nursing|medication|treatment|diagnos\w*|bedside|triage)\b/i.test(value)],
  ['Teaching and training', value => /\b(?:taught|teaching|curriculum|classroom|students|instruction|training sessions)\b/i.test(value)],
  ['Software and systems engineering', value => /\b(?:software|APIs?|microservices|backend|frontend|front.end|back.end|application code|distributed systems|codebase)\b/i.test(value)],
  ['Private-market reporting', value => /\b(?:MOIC|DPI|RVPI)\b/i.test(value) || /\bprivate market\w*\b[\s\S]{0,100}\b(?:report\w*|IRR)\b/i.test(value) || /\bIRR\b[\s\S]{0,100}\bprivate market\w*\b/i.test(value)],
  ['Commercial and client work', value => /\b(?:contracts?|negotiat\w*|commercial|sales agreements?|business development)\b/i.test(value)],
  ['Applied technology and automation', value => /\b(?:using|used|with|in)\s+(?:SQL|Python|VBA|Java(?:Script)?|TypeScript|Power BI|Excel|R\b|Tableau)\b/i.test(value)
    || /\b(?:automat\w*|interactive dashboards?|data pipelines?|spreadsheet models?)\b/i.test(value)],
  ['Trading and exposure', value => /\b(?:trading books?|trades?|trading exposure|OTC|futures|options|derivative trading)\b/i.test(value)],
  ['Risk analytics', value => /\b(?:risk|valuation|VaR|stress testing|scenario analysis|sensitivities|pricing models?|risk models?)\b/i.test(value)],
  ['Quality and validation', value => /\b(?:quality assurance|testing|unit tests?|integration tests?|defects?|validation|audit\w*)\b/i.test(value)],
  ['Supply chain and production', value => /\b(?:inventory|logistics|manufacturing|production line|assembly|procurement|suppliers?|warehouse)\b/i.test(value)],
  ['Marketing and sales', value => /\b(?:marketing|campaigns?|advertising|brand|sales|conversion|lead generation)\b/i.test(value)],
  ['Client and stakeholder work', value => /\b(?:clients?|customers?|stakeholders?|external parties)\b/i.test(value)],
  ['Research and analysis', value => /\b(?:research|analy[sz]\w*|analytics|forecast\w*|investigat\w*|evaluat\w*)\b/i.test(value)],
  ['Operations and work delivery', value => /\b(?:operations?|process\w*|reconcil\w*|workflow|controls?|deliver\w*|deadlines?|coordination)\b/i.test(value)]
];
function areaFor(statement) { return areaRules.find(([, matches]) => matches(statement))?.[0] || 'Professional work and delivery'; }
function concise(statement, area) {
  const cuts = [];
  for (const pattern of [/;\s+/g, /[-–—]\s+(?=[A-Z])/g, /\s+(?:to enable|in order to|so that|which enabled|thereby)\b/gi, /[.!?]\s+(?=[A-Z])/g])
    for (const match of statement.matchAll(pattern)) if (match.index >= 55) cuts.push(match.index);
  if (/Leadership/.test(area)) {
    const scale = /\s+(?:with|representing|totalling|totaling)\s+(?:AUM|assets under management|client assets|client revenue)\b/i.exec(statement);
    if (scale && scale.index >= 35) cuts.push(scale.index);
  }
  const eligible = cuts.filter(index => index <= 320).sort((a, b) => a - b);
  // Never cut at an arbitrary character/word count or paraphrase source scope.
  return eligible.length ? statement.slice(0, eligible[0]).trim() : statement;
}

function recordContext(document, facts) {
  const parsed = extractSectionOneFacts(document, {knownFacts: facts}), records = new Map();
  const sourceLines = document.segments.flatMap((segment, segmentIndex) => segment.text.split(/\r?\n/).map((line, lineIndex) => ({segmentIndex, lineIndex, segmentId: segment.id, line}))).filter(entry => text(entry.line));
  for (const fact of parsed.facts.filter(fact => fact.category === 'employment')) {
    if (!records.has(fact.scope)) records.set(fact.scope, {scope: fact.scope, fields: {}, evidence: []});
    records.get(fact.scope).fields[fact.field] = fact;
    records.get(fact.scope).evidence.push(...fact.evidence);
  }
  const anchors = [];
  for (const record of records.values()) {
    const role = record.fields.job_title, first = record.fields.start_date, last = record.fields.end_date;
    if (!role || !first || !last) continue;
    const quoted = (entry, refs) => list(refs).some(ref => ref.segmentId === entry.segmentId && text(ref.quote) === text(entry.line));
    const hasDates = entry => entry.line.includes(first.statement) && entry.line.includes(last.statement);
    const roleLines = sourceLines.filter(entry => {
      if (entry.segmentId !== role.evidence[0]?.segmentId || !entry.line.includes(role.statement) || !quoted(entry, role.evidence)) return false;
      const company = record.fields.company_name?.statement, companyStart = company ? entry.line.indexOf(company) : -1;
      for (let at = entry.line.indexOf(role.statement); at >= 0; at = entry.line.indexOf(role.statement, at + 1))
        if (companyStart < 0 || at < companyStart || at >= companyStart + company.length) return true;
      return false;
    });
    const sameLine = roleLines.filter(hasDates);
    let chosen = sameLine.length === 1 ? sameLine[0] : null;
    if (!sameLine.length) {
      const dateLines = new Set(sourceLines.filter(entry => hasDates(entry) && quoted(entry, [...first.evidence, ...last.evidence])).map(entry => sourceLines.indexOf(entry)));
      const split = roleLines.filter(entry => !hasDates(entry) && entry.line.includes('|') && dateLines.has(sourceLines.indexOf(entry) - 1));
      if (split.length === 1) chosen = split[0];
    }
    if (!chosen) continue; // Ambiguous repeated titles/dates remain unbound.
    const sameLineDates = hasDates(chosen), dateStart = chosen.line.indexOf(first.statement) + first.statement.length;
    anchors.push({segmentIndex: chosen.segmentIndex, lineIndex: chosen.lineIndex, line: chosen.line.trim(),
      endOffset: sameLineDates ? chosen.line.indexOf(last.statement, dateStart) + last.statement.length : chosen.line.length,
      employerRole: [record.fields.company_name?.statement, role.statement].filter(Boolean).join(' · ') || null,
      period: record.fields.start_date && last ? {start: record.fields.start_date.statement, end: last.statement} : null,
      contextRefs: uniqueRefs(record.evidence)});
  }
  return {anchors, metadata: new Set(parsed.facts.flatMap(fact => fact.evidence.map(ref => text(ref.quote))))};
}

/**
 * Read-only work-area projection for the Professional experience subsection.
 * Full passages remain available; concise highlights are exact source clauses.
 * No projected passage is saved, approved or sent to a provider.
 * @param {any} state
 * @param {{snapshot?:any}} [options]
 */
export function buildProfessionalExperience(state, {snapshot} = {}) {
  const allFacts = list(state?.facts), facts = snapshot ? allFacts.filter(fact => list(snapshot.factRefs).some(ref => identity(ref) === identity(fact))) : allFacts;
  const sourceIds = new Set(facts.flatMap(fact => list(fact.evidence).map(ref => ref.documentId)));
  const documents = list(state?.documents).filter(document => document.kind === 'resume' && !document.deleted && (!snapshot || sourceIds.has(document.id)));
  const items = [], excludedMetadataSegments = new Set(), includedSegments = new Set();
  for (const document of documents) {
    const {anchors, metadata} = recordContext(document, facts);
    const entries = document.segments.flatMap((segment, segmentIndex) => segment.text.split(/\r?\n/).map((raw, lineIndex) => ({segment, segmentIndex, lineIndex, raw, line: text(raw)})));
    const pdf = document.mime === 'application/pdf';
    let mode = 'outside', current = null, localHeading = null;
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        const {segment, segmentIndex, lineIndex, raw, line} = entries[entryIndex], statement = line.replace(/^[•*\-]\s*/, '');
        if (!line) continue;
        const sourceKey = `${document.id}:${segment.id}`;
        if (excludedHeading.test(line) || /^(?:technical tools|technical skills|skills|programming languages|languages|tools and technologies|technology stack|core competencies)(?:\s*\([^)]*\))?\s*:/i.test(line)) {
          mode = 'excluded'; current = null; excludedMetadataSegments.add(sourceKey); continue;
        }
        if (workHeading.test(line)) { mode = 'work'; localHeading = line.replace(/:$/, ''); current = null; excludedMetadataSegments.add(sourceKey); continue; }
        if (metadataHeading.test(line)) { if (/summary|profile|objective|curriculum|resume/i.test(line)) { current = null; mode = 'outside'; localHeading = null; } excludedMetadataSegments.add(sourceKey); continue; }
        const anchor = anchors.find(anchor => anchor.segmentIndex === segmentIndex && anchor.lineIndex === lineIndex);
        let body = statement;
        if (anchor) {
          current = anchor; mode = 'work';
          body = raw.slice(anchor.endOffset).replace(/^[.;|\s]+/, '').trim();
          if (!body || !action.test(body)) { excludedMetadataSegments.add(sourceKey); continue; }
        } else if (metadata.has(line) || !action.test(line) && (datedHeader.test(line)
          || /\s{2,}|\t/.test(line) && line.length < 180 || /@|https?:|www\./i.test(line))) {
          current = null; excludedMetadataSegments.add(sourceKey); continue;
        }
        if (mode === 'excluded') continue;
        const fragments = [{segment, quote: body}];
        if (pdf && /^[•*\-]\s*/.test(line)) {
          while (fragments.length < 12 && entryIndex + 1 < entries.length && !/[.!?]\s*$/.test(fragments.at(-1).quote)) {
            const next = entries[entryIndex + 1], previous = fragments.at(-1).quote;
            if (!next.line || /^[•*\-]\s*/.test(next.line) || next.line.includes('|') || metadata.has(next.line)
              || excludedHeading.test(next.line) || workHeading.test(next.line) || metadataHeading.test(next.line) || datedHeader.test(next.line)
              || anchors.some(anchor => anchor.segmentIndex === next.segmentIndex && anchor.lineIndex === next.lineIndex)) break;
            if (!/^[a-z]/.test(next.line) && !/\b(?:and|or|with|for|to|of|in|using|including|across|through|by)\s*$/i.test(previous)) break;
            fragments.push({segment: next.segment, quote: next.line}); entryIndex++;
          }
          if (fragments.length > 1) body = fragments.map(fragment => fragment.quote).join(' ');
        }
        if (body.length < 18 || (!action.test(body) && mode !== 'work')) continue;
        if (!action.test(body) && body.length < 45) continue;
        const approval = fragments.length > 1 ? wrappedApproval(state, facts, document, fragments, body) : approvalFor(state, facts, document, segment, body);
        const item = {id: `resume:${document.id}:${segment.id}:${lineIndex}`, statement: body,
          sourceRefs: fragments.map(fragment => sourceFor(document, fragment.segment, fragment.quote)), origin: 'resume', sourceStatus: 'resume_stated',
          employerRole: current?.employerRole || null, period: current?.period || null, contextRefs: clone(current?.contextRefs || []),
          sourceHeading: localHeading, area: areaFor(body), ...approval, independentlyVerified: false};
        items.push(item); for (const fragment of fragments) includedSegments.add(`${document.id}:${fragment.segment.id}`);
    }
  }
  for (const fact of facts.filter(fact => workFact(fact) && validApproval(state, fact))) {
    const refs = fact.evidence.filter(ref => list(state.documents).some(document => document.id === ref.documentId && document.kind === 'answer' && !document.deleted));
    if (!refs.length || !text(fact.statement) || /^(?:no\b|I (?:have not|haven't|never|do not|did not)|not experienced)/i.test(text(fact.statement))) continue;
    const statement = text(fact.statement);
    const coveredQuotes = [...new Set(refs.flatMap(ref => ref.quote.includes(statement) ? [statement] : []))];
    items.push({id: `answer:${fact.id}:${fact.version}`, statement, sourceRefs: clone(refs), origin: 'user_answer', sourceStatus: 'user_confirmed',
      employerRole: null, period: null, contextRefs: [], sourceHeading: null, area: areaFor(statement),
      approvalStatus: 'approved', approvedFactRefs: [refOf(fact)], pendingFactRefs: [],
      approvedClaims: [{factId: fact.id, version: fact.version, approvalRef: fact.approvalRef, statement, evidence: clone(refs), coveredQuotes, coverage: 'full', confirmation: fact.confirmation || 'user_confirmed', independentlyVerified: false}],
      coveredQuotes, reviewNote: 'Approved user-answer claim only; employer and period are not inferred from the question or a JD.', independentlyVerified: false});
  }
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.area)) grouped.set(item.area, {id: normalized(item.area).replace(/[^a-z0-9]+/g, '-'), area: item.area, areaBasis: 'organizational_label', items: []});
    grouped.get(item.area).items.push(item);
  }
  const rows = [...grouped.values()].map(row => {
    const candidates = new Map();
    // Newly confirmed answer claims stay visible in the concise view; the full
    // resume passages remain in source details and still affect row status.
    const representative = [...row.items].sort((left, right) => Number(right.origin === 'user_answer') - Number(left.origin === 'user_answer'));
    for (const item of representative) {
      const statement = concise(item.statement, row.area), existing = candidates.get(normalized(statement));
      if (existing) { existing.sourceRefs = uniqueRefs([...existing.sourceRefs, ...item.sourceRefs]); existing.sourceItemIds.push(item.id); existing.statuses.push(item.approvalStatus); }
      else candidates.set(normalized(statement), {statement, sourceItemId: item.id, sourceItemIds: [item.id], sourceRefs: clone(item.sourceRefs), statuses: [item.approvalStatus]});
    }
    const highlights = [...candidates.values()].slice(0, 2).map(({statuses, ...highlight}) => ({...highlight,
      approvalStatus: statuses.every(status => status === 'approved') ? 'approved' : statuses.some(status => status !== 'needs_review') ? 'partial' : 'needs_review'}));
    return {...row, highlights, sourceRefs: uniqueRefs(row.items.flatMap(item => item.sourceRefs)),
      approvalStatus: row.items.every(item => item.approvalStatus === 'approved') ? 'approved' : row.items.some(item => item.approvalStatus !== 'needs_review') ? 'partial' : 'needs_review',
      independentlyVerified: false};
  });
  return {schemaVersion: 1, rows, coverage: {resumeWorkSegments: includedSegments.size, includedSegments: [...includedSegments],
    excludedMetadataSegments: [...excludedMetadataSegments], sourceDocuments: documents.length, approvedAnswerClaims: items.filter(item => item.origin === 'user_answer').length},
    note: 'Area labels organize exact source-stated work. Narrow approvals cover only the linked claims; other details need their own review. Listed skills do not establish applied work, employers or tenure. Source matching and user confirmation are not independent verification.'};
}
