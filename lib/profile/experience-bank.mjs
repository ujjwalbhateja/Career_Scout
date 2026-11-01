import {buildFactReview, factReviewEntry} from './fact-review.mjs';

const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const normal = value => text(value).toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim();
const clone = value => structuredClone(value);
const active = fact => fact.lifecycle === 'active' || !fact.lifecycle;
const usable = fact => active(fact) && !['rejected', 'withdrawn'].includes(fact.approval);
const identity = value => `${value.id}:${value.version}`;
const refOf = fact => ({id: fact.id, version: fact.version, approvalRef: fact.approvalRef || null});
const workField = /\b(?:responsibilit(?:y|ies)|duties|tasks?|work performed|projects?|deliverables?|ownership|leadership|client work|stakeholder work|achievements?|accomplishments?|outcomes?|processes?)\b/i;
const isWork = fact => ['experience_claims', 'client_relationships', 'quantitative_claims'].includes(fact.category)
  || fact.category === 'employment' && workField.test(normal(fact.field));
const sectionHeader = /^(?:education|academic qualifications?|certifications?|skills(?: and technologies)?|technical skills|professional experience|employment history|work experience|projects|personal details)\s*:?$/i;

function evidenceContains(fact, value) {
  if (!text(value)) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return list(fact.evidence).some(ref => new RegExp(escaped, 'iu').test(ref.quote));
}
function explicitAffiliation(fact, value) {
  if (!evidenceContains(fact, value)) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:\\bas\\s+(?:(?:a|an|the)\\s+)?|\\bat\\s+|\\b(?:employed|worked|working|served)\\s+(?:by|at|for)\\s+)${escaped}(?![\\p{L}\\p{N}])`, 'iu');
  return list(fact.evidence).some(ref => pattern.test(ref.quote));
}
function areaFor(fact) {
  const supplied = text(fact.experienceArea);
  if (supplied && supplied.length <= 100 && !/@|https?:|\n/.test(supplied)) return {label: supplied, basis: 'organizational_category', factualClaim: false};
  const content = normal(fact.field + ' ' + fact.statement);
  let label = fact.category === 'quantitative_claims' ? 'Achievements and measurable outcomes'
    : fact.category === 'client_relationships' ? 'Client and stakeholder work'
      : /\b(?:report|reports|reporting|reconciliation|reconciliations)\b/.test(content) ? 'Reporting and reconciliation'
        : /\b(?:team|leadership|supervised|mentored|managed people)\b/.test(content) ? 'Leadership and teamwork'
          : /\b(?:research|analysis|analyzed|analysed|analytics)\b/.test(content) ? 'Research and analysis'
            : /\b(?:process|processes|operations|operational|delivery)\b/.test(content) ? 'Processes and delivery'
              : 'Responsibilities and work performed';
  return {label, basis: 'organizational_category', factualClaim: false};
}

function recordSections(records, documents) {
  const output = [];
  for (const record of records) for (const document of documents.filter(document => document.kind === 'resume' && !document.deleted)) {
    const indices = list(record.sourceRefs).filter(ref => ref.documentId === document.id).map(ref => document.segments.findIndex(segment => segment.id === ref.segmentId)).filter(index => index >= 0);
    if (indices.length) output.push({record, document, start: Math.min(...indices)});
  }
  for (const section of output) {
    const next = output.filter(other => other.document.id === section.document.id && other.start > section.start).map(other => other.start);
    section.end = next.length ? Math.min(...next) : section.document.segments.length;
    for (let i = section.start + 1; i < section.end; i++) if (sectionHeader.test(section.document.segments[i].text.trim())) { section.end = i; break; }
  }
  return output;
}

function associationFor(fact, records, sections) {
  const supplied = text(fact.employerRole);
  if (supplied && explicitAffiliation(fact, supplied)) return {recordId: null, employerRole: supplied, recordScope: null, basis: 'explicit_claim_source', sourceRefs: clone(fact.evidence)};
  const candidates = [];
  for (const section of sections) if (list(fact.evidence).some(ref => {
    if (ref.documentId !== section.document.id) return false;
    const index = section.document.segments.findIndex(segment => segment.id === ref.segmentId);
    return index >= section.start && index < section.end;
  })) candidates.push(section);
  const unique = [...new Map(candidates.map(section => [section.record.id, section])).values()];
  if (unique.length === 1) {
    const record = unique[0].record;
    const employer = record.companyName.status === 'provided' ? record.companyName.value : null;
    const role = record.jobTitle.status === 'provided' ? record.jobTitle.value : null;
    return {recordId: record.id, employerRole: [employer, role].filter(Boolean).join(' · ') || null,
      recordScope: record.scope, basis: 'same_resume_record_section', sourceRefs: clone(record.sourceRefs),
      contextRequiresReview: Object.values(record).some(value => Array.isArray(value?.entries) && value.entries.some(entry => entry.requiresReview))};
  }
  // An answer without an employer/role does not inherit one from the question,
  // a JD, its scope label, or the last employer in the resume.
  return {recordId: null, employerRole: null, recordScope: null, basis: unique.length > 1 ? 'ambiguous_record_section' : 'not_provided', sourceRefs: []};
}

/**
 * Source-linked views for Section 1 factual records and Section 2 actual work.
 * Organizational area labels never establish a qualification or employer link.
 * Unrepresented source paragraphs are review flags, never generated facts.
 * @param {any} state
 * @param {{snapshot?:any,asOf?:string|null}} [options]
 */
export function buildExperienceBank(state, {snapshot, asOf} = {}) {
  const allDocuments = list(state.documents), allFacts = list(state.facts);
  const selected = snapshot ? allFacts.filter(fact => list(snapshot.factRefs).some(ref => identity(ref) === identity(fact))) : allFacts;
  const sourceIds = new Set(selected.flatMap(fact => list(fact.evidence).map(ref => ref.documentId)));
  const documents = snapshot ? allDocuments.filter(document => sourceIds.has(document.id)) : allDocuments;
  const facts = selected.filter(usable), factualRecords = buildFactReview({...state, documents, facts}, {asOf});
  const sections = recordSections(factualRecords.employment, documents), groups = new Map(), unscoped = [], sourceIssues = [];
  for (const fact of facts.filter(isWork)) {
    const entry = factReviewEntry(fact, documents), association = associationFor(fact, factualRecords.employment, sections), area = areaFor(fact);
    const item = {id: fact.id, version: fact.version, factId: fact.id, factVersion: fact.version,
      category: fact.category, field: fact.field, scope: fact.scope, statement: fact.statement,
      approvalStatus: fact.approval || 'pending', approvalRef: fact.approvalRef || null,
      approvalReceiptStatus: list(state.approvals).some(approval => approval.id === fact.approvalRef && approval.recordId === fact.id
        && approval.recordVersion === fact.version && approval.kind === 'fact' && approval.decision === 'approved') ? 'matched_approval' : 'not_approved',
      confirmation: fact.confirmation || 'source_stated', origin: fact.origin || null,
      experienceDecision: fact.experienceDecision || null, experienceReviewId: fact.experienceReviewId || null,
      experienceRowId: fact.experienceRowId || null, originatingRequirements: clone(list(fact.originatingRequirements)),
      requirementEvidenceStatus: fact.experienceDecision === 'somewhat' ? 'partial_support' : null,
      evidence: clone(list(fact.evidence)), sourceRefs: clone(list(fact.evidence)), sourceStatus: entry.evidenceStatus,
      factRefs: [refOf(fact)], conflict: fact.conflict === true, independentlyVerified: false,
      canApprove: entry.evidenceStatus === 'matched_source' && !fact.conflict && fact.approval === 'pending',
      experienceArea: area.label, area, employerRole: association.employerRole, association};
    if (entry.evidenceStatus !== 'matched_source') { sourceIssues.push(item); continue; }
    const groupId = `${association.recordId || (association.employerRole ? 'explicit:' + normal(association.employerRole) : 'unscoped')}|${normal(area.label)}`;
    if (!groups.has(groupId)) groups.set(groupId, {id: groupId, scope: association.recordScope || null,
      recordId: association.recordId, employerRole: association.employerRole, experienceArea: area.label,
      area, associationBasis: association.basis, items: []});
    groups.get(groupId).items.push(item);
    if (!association.employerRole) unscoped.push(item);
  }
  const coverageDocuments = documents.filter(document => document.kind === 'resume' && !document.deleted).map(document => {
    const passageReview = new Map(list(document.coverage?.passageReview)
      .filter(review => text(review.segmentId) && text(review.reason))
      .map(review => [review.segmentId, text(review.reason)]));
    const explicitlyUnreviewed = new Set(list(document.coverage?.unreviewedPassages));
    const segments = list(document.segments).map(segment => {
      const linked = selected.filter(fact => active(fact) && list(fact.evidence).some(ref => ref.documentId === document.id && ref.segmentId === segment.id));
      const work = linked.filter(isWork);
      const reason = passageReview.get(segment.id) || null;
      // A stored no-claim review is paragraph accountability, not independent
      // proof of semantic completeness. A declared omission/failure stays open.
      const reviewedNoClaim = !!reason && !explicitlyUnreviewed.has(segment.id)
        && !/\b(?:omitted|skipped|unprocessed|not (?:analy[sz]ed|processed|reviewed)|truncated|output limit|token limit|too long)\b/i.test(reason);
      return {segmentId: segment.id, locator: segment.locator || '', text: segment.text, linkedFactIds: linked.map(fact => fact.id),
        linkedExperienceFactIds: work.map(fact => fact.id), reviewReason: reason,
        status: work.length ? 'linked_experience_claim' : linked.length ? 'linked_factual_record' : reviewedNoClaim ? 'reviewed_no_claim' : 'needs_extraction_review'};
    });
    return {documentId: document.id, title: document.title, totalSegments: segments.length,
      representedSegments: segments.filter(segment => segment.linkedFactIds.length).length,
      experienceRepresentedSegments: segments.filter(segment => segment.linkedExperienceFactIds.length).length,
      reviewedNoClaimSegments: segments.filter(segment => segment.status === 'reviewed_no_claim'),
      unrepresentedSegments: segments.filter(segment => segment.status === 'needs_extraction_review'), segments,
      completeness: 'not_established_by_link_counts'};
  });
  const items = [...groups.values()].flatMap(group => group.items);
  return {schemaVersion: 1, factualRecords,
    experienceGained: {groups: [...groups.values()], unscoped, sourceIssues,
      listedSkills: clone(factualRecords.skills),
      note: 'These claims describe source-stated work. Listed skills alone do not establish projects, employer usage or tenure; area labels only organize the claims.'},
    coverage: {documents: coverageDocuments,
      unrepresentedSegmentCount: coverageDocuments.reduce((sum, document) => sum + document.unrepresentedSegments.length, 0),
      reviewedNoClaimSegmentCount: coverageDocuments.reduce((sum, document) => sum + document.reviewedNoClaimSegments.length, 0),
      note: 'An unreviewed passage needs extraction review; it is not an approved fact or proof of missing experience. A stored no-claim reason records paragraph review. Neither a linked passage nor a no-claim classification proves that every atomic claim was extracted.'},
    counts: {experienceClaims: items.length, approvedExperienceClaims: items.filter(item => item.approvalStatus === 'approved').length,
      pendingExperienceClaims: items.filter(item => item.approvalStatus === 'pending').length, unscopedExperienceClaims: unscoped.length,
      sourceIssueClaims: sourceIssues.length, factualEmploymentRecords: factualRecords.employment.length}};
}
