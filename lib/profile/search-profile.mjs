// Pure projection for Profile/Memory. Search terms are literal source spans;
// generated role proposals, summaries and alternate titles are never consulted.
import {resumeSourceRecord} from './source-records.mjs';
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const key = value => text(value).toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim();
const identity = value => `${value.id}:${value.version}`;
const clone = value => structuredClone(value);
const refOf = fact => ({id: fact.id, version: fact.version, approvalRef: fact.approvalRef || null});
const kinds = ['responsibilities', 'industries', 'skills', 'qualifications', 'functions'];
const titleFields = new Set(['job title', 'role title', 'position title', 'employment title', 'designation', 'current title', 'previous title', 'title']);
const privateFields = /\b(?:email|phone|mobile|contact|address|location|city|country|employer|company|institution|university|college|school|issuer|start|end|date|duration|salary|compensation)\b/;
const dateOrContact = /@|https?:|www\.|\b(?:19|20)\d{2}\b|\b\d[\d ()+.-]{6,}\d\b/i;
const generic = /^(?:skills?|tools?|responsibilities|experience|professional experience|industry|sector|qualifications?|certifications?|missing|not provided|missing not provided|unknown)$/i;

function span(source, value) {
  if (!text(value) || typeof source !== 'string') return null;
  const exact = source.indexOf(value);
  if (exact >= 0) return source.slice(exact, exact + value.length);
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'iu').exec(source)?.[0] || null;
}

function sourceMatches(state, refs, allowedKinds) {
  return list(refs).length > 0 && refs.every(ref => {
    const document = list(state.documents).find(item => item.id === ref.documentId && !item.deleted && allowedKinds.includes(item.kind));
    const segment = list(document?.segments).find(item => item.id === ref.segmentId);
    return segment && text(ref.quote) && segment.text.includes(ref.quote)
      && (ref.documentVersion == null || document.version == null || ref.documentVersion === document.version);
  });
}

function approvedSourceFact(state, fact) {
  return fact.lifecycle === 'active' && fact.approval === 'approved' && !fact.conflict
    && !['personal', 'preferences'].includes(fact.category)
    && sourceMatches(state, fact.evidence, ['resume', 'answer'])
    && list(state.approvals).some(approval => approval.id === fact.approvalRef && approval.kind === 'fact'
      && approval.recordId === fact.id && approval.recordVersion === fact.version && approval.decision === 'approved');
}

function safe(value, privateValues) {
  const term = text(value);
  return term && term.length <= 120 && !dateOrContact.test(term) && !generic.test(term)
    && !privateValues.some(value => value && (` ${key(term)} `).includes(` ${value} `)) ? term : null;
}

function explicitTerm(fact, value) {
  for (const evidence of list(fact.evidence)) {
    const found = span(evidence.quote, value);
    if (found) return found;
  }
  return null;
}

function termFromFact(fact, term) {
  const resumeOnly=fact.approval!=='approved';
  return {
    term, factIds: [fact.id], factRefs: [refOf(fact)], evidence: clone(fact.evidence), sourceRefs: clone(fact.evidence),
    sourceKind: resumeOnly?'resume_source_fact':'approved_professional_fact', basis: 'explicit_source_statement',
    approvalStatus: resumeOnly?'resume_stated':'approved', approvalReceiptStatus: resumeOnly?'not_required_for_resume_source':'matched_approval', sourceStatus: 'matched_source',
    confirmation: fact.confirmation || 'source_stated', independentlyVerified: false
  };
}

function addUnique(items, value) {
  const existing = items.find(item => key(item.term) === key(value.term) && item.sourceKind === value.sourceKind);
  if (!existing) { items.push(value); return; }
  for (const factId of list(value.factIds)) if (!existing.factIds.includes(factId)) existing.factIds.push(factId);
  for (const ref of list(value.factRefs)) if (!existing.factRefs.some(item => identity(item) === identity(ref))) existing.factRefs.push(ref);
  for (const source of list(value.sourceRefs)) if (!existing.sourceRefs.some(item => JSON.stringify(item) === JSON.stringify(source))) {
    existing.sourceRefs.push(source); existing.evidence.push(clone(source));
  }
}

function categoryFor(fact) {
  const field = key(fact.field);
  if (privateFields.test(field)) return null;
  if (['function', 'functional area', 'business function', 'job family', 'functional knowledge'].includes(field)) return 'functions';
  if (/\b(?:industry|sector|domain knowledge)\b/.test(field)) return 'industries';
  if (fact.category === 'skills' || /\b(?:subject matter expertise|specialist knowledge|competencies)\b/.test(field)) return 'skills';
  if (fact.category === 'certifications' || fact.category === 'education' && /\b(?:degree|qualification|qualification name|credential|diploma)\b/.test(field)) return 'qualifications';
  if (['experience_claims', 'client_relationships'].includes(fact.category) || fact.category === 'employment' && /\b(?:responsibilities|responsibility|duties|tasks|work performed)\b/.test(field)) return 'responsibilities';
  return null;
}

function skillValues(value) {
  // Remove an example-list wrapper, not meaningful parentheses inside a skill.
  const wrapped=/^\(\s*(?:e\.g\.|for example|such as)\s*[,\s:]+/i.test(value);
  let input=value.replace(/^(?:\(\s*)?(?:e\.g\.|for example|such as)\s*[,\s:]+/i,'');
  if(wrapped&&input.endsWith(')'))input=input.slice(0,-1);
  const out=[];let current='',depth=0;
  for(let i=0;i<input.length;i++){
    const c=input[i];if(c==='(')depth++;if(c===')')depth=Math.max(0,depth-1);
    const conjunction=depth===0&&/^\s+and\s+/i.exec(input.slice(i));
    if(depth===0&&/[,;\n]/.test(c)||conjunction){out.push(current.trim());current='';if(conjunction)i+=conjunction[0].length-1;}
    else current+=c;
  }
  out.push(current.trim());return out.filter(value=>value&&!/^\(?e\.g\.?\)?$/i.test(value));
}

function valuesFor(fact, kind, includeResumeSources=false) {
  const literal = text(fact.value) || text(fact.statement);
  const chunks = kind === 'skills' ? skillValues(literal) : literal.split(includeResumeSources&&kind==='responsibilities'?/\n+|;|,\s+|\s+and\s+/i:/\n+|;/);
  return chunks.slice(0, 12).map(value => value.replace(/^[*•\-\s]+/, '').replace(/[.!?]+$/, '')
    .replace(/^(?:job title|role title|position title|designation|technical skills|skills|tools|industry|sector|function|degree|certification)\s*:\s*/i, '')
    .split(/\s+(?:at|for|from|on behalf of|in partnership with)\s+/i)[0].trim());
}

function frozenItem(state, item, facts, allowedDocumentIds, isTitle, expectedKind = null) {
  if (!text(item?.term)) return null;
  const sourceRefs = list(item.sourceRefs).length ? item.sourceRefs : list(item.evidence);
  if (isTitle && item.sourceKind === 'selected_jd_title') {
    if (!sourceRefs.length || sourceRefs.some(ref => !allowedDocumentIds.has(ref.documentId))
      || !sourceMatches(state, sourceRefs, ['jd']) || !sourceRefs.some(ref => span(ref.quote, item.term) === item.term)) return null;
    return {...clone(item), term: item.term, title: item.term, factIds: [], factRefs: [], evidence: clone(sourceRefs), sourceRefs: clone(sourceRefs)};
  }
  const refs = list(item.factRefs), linked = refs.map(ref => facts.find(fact => identity(fact) === identity(ref) && (!ref.approvalRef || ref.approvalRef === fact.approvalRef)));
  if (!refs.length || linked.some(fact => !fact || !explicitTerm(fact, item.term))) return null;
  if (isTitle && (item.sourceKind !== 'employment_title' || linked.some(fact => fact.category !== 'employment' || !titleFields.has(key(fact.field))))) return null;
  if (!isTitle && linked.some(fact => categoryFor(fact) !== expectedKind)) return null;
  return {...clone(item), factIds: linked.map(fact => fact.id), factRefs: linked.map(refOf),
    evidence: clone(linked.flatMap(fact => fact.evidence)), sourceRefs: clone(linked.flatMap(fact => fact.evidence))};
}

/**
 * Construct source-only search context. Selected JD titles are employer targets,
 * never user experience. Snapshot mode revalidates frozen terms and exact refs.
 * @param {any} state
 * @param {{snapshot?:any,asOf?:string|null,includeResumeSources?:boolean}} [options]
 */
export function buildValidatedSearchProfile(state, {snapshot, asOf,includeResumeSources=false} = {}) {
  const boundRefs = snapshot ? list(snapshot.factRefs) : null;
  const selectedFacts = list(state.facts).filter(fact => !boundRefs || boundRefs.some(ref => identity(ref) === identity(fact) && (!ref.approvalRef || ref.approvalRef === fact.approvalRef)));
  const facts = selectedFacts.filter(fact => approvedSourceFact(state, fact)||includeResumeSources&&resumeSourceRecord(state,fact)&&!['personal','preferences'].includes(fact.category));
  const privateValues = list(state.facts).filter(fact => fact.lifecycle === 'active' && (fact.approval === 'approved'||includeResumeSources&&resumeSourceRecord(state,fact))
    && (fact.category === 'personal' || privateFields.test(key(fact.field))))
    .map(fact => key(text(fact.value) || text(fact.statement))).filter(value => value.length >= 3);
  const documentIds = new Set(snapshot ? list(snapshot.reviewScope?.documentIds) : list(state.documents)
    .filter(document => document.kind === 'jd' && document.selected && !document.deleted).map(document => document.id));
  // Legacy frozen scopes can recover only title sources already saved in the
  // artifact, never a newly selected JD or a generated role proposal.
  if (snapshot?.searchProfile && !snapshot.reviewScope?.documentIds) for (const title of list(snapshot.searchProfile.titles))
    for (const ref of list(title.sourceRefs)) documentIds.add(ref.documentId);
  const titles = [], terms = Object.fromEntries(kinds.map(kind => [kind, []])), excludedFacts = [];
  if (snapshot?.searchProfile) {
    const saved = snapshot.searchProfile;
    for (const item of list(saved.titles)) {
      const validated = frozenItem(state, item, facts, documentIds, true);
      if (validated && safe(validated.term, privateValues)) addUnique(titles, validated);
    }
    for (const kind of kinds) for (const item of list(saved[kind])) {
      const validated = frozenItem(state, item, facts, documentIds, false, kind);
      if (validated && safe(validated.term, privateValues)) addUnique(terms[kind], validated);
    }
  } else {
    for (const fact of facts) {
      const title = fact.category === 'employment' && titleFields.has(key(fact.field));
      const kind = title ? 'titles' : categoryFor(fact);
      if (!kind) continue;
      for (const value of valuesFor(fact, kind,includeResumeSources)) {
        const literal = explicitTerm(fact, value), term = literal && safe(literal, privateValues);
        if (!term) continue;
        const item = termFromFact(fact, term);
        if (title) addUnique(titles, {...item, title: term, kind: 'employment_title', sourceKind: 'employment_title', basis: 'explicit_employment_title'});
        else addUnique(terms[kind], item);
      }
    }
    for (const document of list(state.documents).filter(document => documentIds.has(document.id) && document.kind === 'jd' && !document.deleted)) {
      const proposed = text(document.roleName) || text(document.jobTitle);
      if (!proposed) continue;
      for (const segment of list(document.segments)) {
        const literal = span(segment.text, proposed), term = literal && safe(literal, privateValues);
        if (!term) continue;
        const refs = [{documentId: document.id, documentVersion: document.version, segmentId: segment.id, quote: term}];
        addUnique(titles, {term, title: term, kind: 'selected_jd_title', sourceKind: 'selected_jd_title', basis: 'selected_employer_requirement',
          factIds: [], factRefs: [], evidence: clone(refs), sourceRefs: refs, approvalStatus: 'selected_jd_context', sourceStatus: 'matched_jd_source',
          userExperience: false, independentlyVerified: false});
        break;
      }
    }
  }
  for (const fact of selectedFacts) if (!facts.includes(fact) && !['personal', 'preferences'].includes(fact.category))
    excludedFacts.push({id: fact.id, version: fact.version, reason: fact.conflict ? 'conflicting' : fact.approval !== 'approved' ? 'not_approved' : 'source_or_approval_requires_review'});
  const missingContext = [];
  if (!titles.length) missingContext.push({code: 'title_not_provided', message: 'No explicit employment or selected-JD title is available. Responsibility and skill routes can still be used.'});
  for (const kind of kinds) if (!terms[kind].length) missingContext.push({code: `${kind}_not_provided`, message: `No approved source terms are available for ${kind}.`});
  const approvedFactIds = facts.filter(fact=>fact.approval==='approved').map(fact => fact.id);
  const resumeFactIds = facts.filter(fact=>fact.approval!=='approved').map(fact=>fact.id);
  const contextTerms = Object.fromEntries(kinds.map(kind => [kind, terms[kind].map(item => ({term: item.term, factIds: [...item.factIds]}))]));
  const contextTitles = titles.map(item => ({term: item.term, title: item.term, sourceKind: item.sourceKind,
    factIds: [...item.factIds], factRefs: clone(item.factRefs), approvalStatus: item.approvalStatus,
    sourceRefs: item.sourceRefs.map(ref => ({...ref, quote: item.term}))}));
  const context = {profileId: 'master-profile', roleName: titles[0]?.term || '', titles: contextTitles, alternativeTitles: [],
    functionName: terms.functions[0]?.term || '', ...contextTerms, approvedFactIds: [...approvedFactIds], ...(includeResumeSources?{resumeFactIds}:{}), requiresSponsorship: false};
  return {schemaVersion: 1, id: 'master-profile', label: 'Validated professional profile', basis: 'validated_source_data',
    version: snapshot?.version || null, asOf: snapshot?.searchProfile?.asOf || asOf || null,
    titles, ...terms, approvedFactIds, ...(includeResumeSources?{resumeFactIds}:{}), factRefs: facts.map(refOf), context, missingContext, excludedFacts,
    hasSearchableContext: !!(titles.length || terms.responsibilities.length || terms.skills.length), independentlyVerified: false};
}
