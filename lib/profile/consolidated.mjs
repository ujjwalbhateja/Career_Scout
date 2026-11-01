import {buildFactReview} from './fact-review.mjs';
import {finalizationReadiness} from './domain.mjs';
import {buildValidatedSearchProfile} from './search-profile.mjs';
import {buildExperienceBank} from './experience-bank.mjs';

const array = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const normal = value => text(value).toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim();
const identity = record => `${record.id}:${record.version}`;
const active = fact => fact.lifecycle === 'active';
const professional = fact => !['personal', 'preferences'].includes(fact.category);
const clone = value => structuredClone(value);
const refOf = fact => ({id: fact.id, version: fact.version, approvalRef: fact.approvalRef || null});
const incompleteSupport = mapping => ['partial','missing','not_established','unassessed'].includes(mapping.evidenceStatus)
  || ['partial_support','not_established','unassessed'].includes(mapping.assessment);

export const CONSOLIDATED_SECTION_LABELS = Object.freeze({
  subjectMatterExpertise: 'Subject-matter expertise',
  skillsCompetencies: 'Skills and competencies',
  toolsTechnologies: 'Tools, systems, platforms and technologies',
  industryFunctionalKnowledge: 'Industry and functional knowledge',
  relevantExperience: 'Relevant employment and experience',
  managementLeadership: 'Management and leadership experience',
  clientStakeholder: 'Client-facing and stakeholder experience',
  educationCertifications: 'Education and certifications',
  responsibilities: 'Responsibilities and types of work performed',
  achievements: 'Source-stated accomplishments and measurable outcomes'
});

function sourceStatus(state, fact) {
  const refs = array(fact.evidence);
  if (!refs.length) return 'missing_source';
  return refs.every(ref => {
    const document = array(state.documents).find(item => item.id === ref.documentId && !item.deleted && ['resume', 'answer'].includes(item.kind));
    const segment = array(document?.segments).find(item => item.id === ref.segmentId);
    return segment && text(ref.quote) && segment.text.includes(ref.quote)
      && (ref.documentVersion == null || document.version == null || ref.documentVersion === document.version);
  }) ? 'matched_source' : 'source_requires_review';
}

function approvalStatus(state, record, kind) {
  return array(state.approvals).some(approval => approval.id === record.approvalRef && approval.kind === kind
    && approval.recordId === record.id && approval.recordVersion === record.version && approval.decision === 'approved')
    ? 'matched_approval' : 'approval_requires_review';
}

function claim(state, fact) {
  return {
    id: fact.id, version: fact.version, category: fact.category, field: fact.field, scope: fact.scope,
    statement: fact.statement, factRefs: [refOf(fact)], approvalStatus: fact.approval,
    approvalRef: fact.approvalRef || null, approvalReceiptStatus: approvalStatus(state, fact, 'fact'),
    sourceStatus: sourceStatus(state, fact), evidence: clone(array(fact.evidence)),
    confirmation: fact.confirmation || 'source_stated', independentlyVerified: false,
    conflict: fact.conflict === true
  };
}

function sectionsFor(fact) {
  const field = normal(fact.field), statement = text(fact.statement), sections = [];
  if (/\b(?:expertise|subject matter|specialist knowledge|specialization|specialisation)\b/.test(field)) sections.push('subjectMatterExpertise');
  if (fact.category === 'skills') {
    sections.push(/\b(?:tool|tools|system|systems|platform|platforms|technology|technologies|software)\b/.test(field) ? 'toolsTechnologies' : 'skillsCompetencies');
  }
  if (/\b(?:industry|sector|domain knowledge|functional knowledge|function)\b/.test(field)) sections.push('industryFunctionalKnowledge');
  if (['employment', 'experience_claims'].includes(fact.category)) sections.push('relevantExperience');
  if (/\b(?:management|leadership|supervision|team size|direct reports|people management)\b/.test(field)
      || /\b(?:led|managed|supervised|mentored|coached)\s+(?:a\s+)?(?:team|teams|people|staff|employees|analysts|engineers)\b/i.test(statement)) sections.push('managementLeadership');
  if (fact.category === 'client_relationships' || /\b(?:client|clients|stakeholder|stakeholders|customer|customers|relationship management)\b/.test(field)) sections.push('clientStakeholder');
  if (['education', 'certifications'].includes(fact.category)) sections.push('educationCertifications');
  if (fact.category === 'experience_claims' || /\b(?:responsibility|responsibilities|duties|task|tasks|work performed|deliverables)\b/.test(field)) sections.push('responsibilities');
  if (fact.category === 'quantitative_claims' || /\b(?:achievement|achievements|accomplishment|accomplishments|outcome|outcomes|measurable result|measurable results)\b/.test(field)) sections.push('achievements');
  return [...new Set(sections)];
}

function snapshotDate(snapshot, asOf) {
  const saved = text(snapshot?.consolidated?.asOf) || text(snapshot?.consolidatedProfile?.asOf) || text(snapshot?.profileAsOf);
  if (saved) return saved;
  const timestamp = text(snapshot?.createdAt);
  if (/^\d{4}-\d{2}-\d{2}T/.test(timestamp)) return timestamp.slice(0, 10);
  return asOf || null;
}

function reviewScope(state, snapshot) {
  const requirements = array(state.requirements);
  if (snapshot?.reviewScope) {
    const scope = snapshot.reviewScope;
    const ids = new Set(array(scope.requirementIds)), questionIds = new Set(array(scope.questionIds));
    return {
      frozen: true, requirements: requirements.filter(item => ids.has(item.id)),
      questions: array(state.questions).filter(item => questionIds.has(item.id)),
      answers: array(scope.answerRefs).flatMap(ref => {
        const answer = array(state.answers).find(item => item.id === ref.id && item.questionId === ref.questionId);
        return answer ? [{...clone(answer), status: ref.status, ...(ref.documentId ? {documentId: ref.documentId} : {})}] : [];
      })
    };
  }
  const documentIds = new Set(snapshot ? array(snapshot.reviewScope?.documentIds)
    : array(state.documents).filter(document => document.kind === 'jd' && document.selected && !document.deleted).map(document => document.id));
  const selected = requirements.filter(requirement => documentIds.has(requirement.documentId));
  if (snapshot) return {frozen: false, requirements: selected, questions: [], answers: []};
  const ids = new Set(selected.map(requirement => requirement.id));
  const questions = array(state.questions).filter(question => {
    const refs = array(question.requirementIds).length ? question.requirementIds : [question.requirementId].filter(Boolean);
    return !refs.length || refs.some(id => ids.has(id));
  });
  const latest = new Map();
  for (const answer of array(state.answers)) if (questions.some(question => question.id === answer.questionId)) latest.set(answer.questionId, answer);
  return {frozen: false, requirements: selected, questions, answers: [...latest.values()]};
}

function answerReviews(state, scope, facts, snapshot, assessments, validatedFacts) {
  const latest = new Map(scope.answers.map(answer => [answer.questionId, answer]));
  const boundFacts = new Set(validatedFacts.map(identity));
  const supportedRequirements = new Set(assessments.filter(mapping => !incompleteSupport(mapping) && array(mapping.factRefs).length
    && array(mapping.factRefs).every(ref => boundFacts.has(identity(ref)))).map(mapping => mapping.requirementId));
  const questions = scope.questions.map(question => {
    const answer = latest.get(question.id);
    const requirementIds = array(question.requirementIds).length ? question.requirementIds : [question.requirementId].filter(Boolean);
    return {
      id: question.id, question: question.question, scope: question.scope,
      status: answer?.status || (snapshot ? 'unresolved' : question.status),
      required: question.required === true, priority: question.priority || null,
      requirementIds: clone(requirementIds),
      coveredByApprovedFacts: snapshot ? requirementIds.length > 0 && requirementIds.every(id => supportedRequirements.has(id)) : question.coveredByApprovedFacts === true,
      answerId: answer?.id || null
    };
  });
  const answers = scope.answers.map(answer => {
    const document = array(state.documents).find(item => item.id === answer.documentId && !item.deleted && item.kind === 'answer');
    const linked = facts.filter(fact => array(answer.confirmedFactRefs).some(ref => identity(ref) === identity(fact))
      || array(fact.evidence).some(ref => ref.documentId === answer.documentId && (!answer.sourceSegmentId || ref.segmentId === answer.sourceSegmentId)));
    let stage = 'not_required';
    if (answer.status === 'needs_details') stage = 'needs_details';
    else if (answer.status === 'answered') stage = !document ? 'source_requires_review'
      : document.analysis !== 'complete' ? 'pending_extraction'
        : linked.some(fact => fact.conflict) ? 'conflicting_facts'
          : linked.some(fact => fact.approval === 'pending') ? 'pending_approval'
            : linked.some(fact => fact.approval === 'approved' && !fact.conflict) ? 'approved_facts'
              : 'no_approved_facts';
    return {
      id: answer.id, questionId: answer.questionId, status: answer.status, text: answer.text || '',
      documentId: answer.documentId || null, stage, factRefs: linked.map(refOf),
      independentlyVerified: false, requiresConsistencyReview: answer.requiresConsistencyReview === true
    };
  });
  return {questions, answers, pendingAnswers: answers.filter(answer => ['needs_details', 'source_requires_review', 'pending_extraction', 'pending_approval', 'conflicting_facts'].includes(answer.stage))};
}

/**
 * A pure, source-backed professional-profile projection. It approves nothing.
 * Snapshot mode binds facts, review scope and preferences to saved refs;
 * no newly approved records can be added by rebuilding an older projection.
 * @param {any} state
 * @param {{snapshot?:any, asOf?:string|null, scoutContexts?:any}} [options]
 */
export function buildConsolidatedProfile(state, {snapshot, asOf, scoutContexts = {}} = {}) {
  const allFacts = array(state.facts), issues = [];
  const factRefs = snapshot ? array(snapshot.factRefs) : allFacts.filter(fact => active(fact) && fact.approval === 'approved' && !fact.conflict).map(refOf);
  const scopedFacts = factRefs.flatMap(ref => {
    const fact = allFacts.find(item => item.id === ref.id && item.version === ref.version);
    const valid = fact && active(fact) && fact.approval === 'approved' && !fact.conflict
      && (!ref.approvalRef || ref.approvalRef === fact.approvalRef)
      && sourceStatus(state, fact) === 'matched_source' && approvalStatus(state, fact, 'fact') === 'matched_approval';
    if (!valid) { issues.push({code: 'fact_requires_review', factId: ref.id, version: ref.version}); return []; }
    return [fact];
  });
  const byFact = new Map(scopedFacts.map(fact => [identity(fact), fact]));
  if (snapshot?.stale) issues.push({code: 'snapshot_stale'});
  const professionalFacts = scopedFacts.filter(professional), scope = reviewScope(state, snapshot);
  const assessments = snapshot ? array(snapshot.reviewScope?.assessments)
    : array(array(state.builderReviews).filter(review => review.basis === 'analysis').at(-1)?.mappings);
  // An old snapshot lacking frozen review scope never borrows current answers.
  const reviewFacts = snapshot
    ? allFacts.filter(fact => factRefs.some(ref => ref.id === fact.id && ref.version === fact.version))
    : allFacts.filter(active);
  const review = answerReviews(state, scope, reviewFacts, snapshot, assessments, scopedFacts);
  const sections = Object.fromEntries(Object.keys(CONSOLIDATED_SECTION_LABELS).map(section => [section, []])), otherApprovedFacts = [];
  const claims = professionalFacts.map(fact => claim(state, fact));
  for (const item of claims) {
    const destinations = sectionsFor(item);
    if (!destinations.length) otherApprovedFacts.push(item);
    for (const destination of destinations) sections[destination].push(item);
  }
  const explicitSummary = claims.filter(item => /^(?:professional summary|summary)$/.test(normal(item.field)));
  const summaryClaims = explicitSummary.length ? explicitSummary : claims.filter(item => ['experience_claims', 'client_relationships', 'skills'].includes(item.category)
    || /\b(?:responsibilities|duties|tasks|expertise|industry|function)\b/.test(normal(item.field)));
  const professionalSummary = {
    kind: 'approved_professional_statements', label: 'Professional summary — approved source statements',
    independentlyVerified: false,
    items: summaryClaims.slice(0, 8).map(item => clone(item))
  };
  // Legacy approved AI role objects and externally supplied role contexts are
  // deliberately ignored. Only the exact saved source-only artifact is used.
  const searchProfile = buildValidatedSearchProfile(state, {snapshot, asOf});
  const targetTitles = clone(searchProfile.titles);
  const searchTerms = Object.fromEntries(['responsibilities', 'industries', 'skills', 'qualifications', 'functions'].map(kind => [kind, clone(searchProfile[kind])]));
  const searchKeywords = Object.entries(searchTerms).flatMap(([kind, terms]) => terms.map(term => ({...clone(term), kind})));
  const requirements = {all: [], supported: [], missing: [], conflicting: [], unverified: []};
  for (const requirement of scope.requirements) {
    const mappings = assessments.filter(mapping => mapping.requirementId === requirement.id);
    const mappedRefs = mappings.flatMap(mapping => array(mapping.factRefs));
    const uniqueRefs = [...new Map(mappedRefs.map(ref => [identity(ref), ref])).values()];
    const linked = uniqueRefs.map(ref => allFacts.find(fact => identity(fact) === identity(ref)));
    const conflict = linked.some(fact => fact?.conflict);
    const validMappings = mappings.filter(mapping => !incompleteSupport(mapping) && array(mapping.factRefs).length && array(mapping.factRefs).every(ref => byFact.has(identity(ref))));
    const partial = mappings.some(incompleteSupport);
    const status = conflict ? 'conflicting' : partial ? 'missing' : validMappings.length ? 'supported' : uniqueRefs.length ? 'unverified' : 'missing';
    const item = {id: requirement.id, documentId: requirement.documentId, category: requirement.category,
      text: requirement.text, importance: requirement.importance, status, supportAssessment: status === 'supported' ? 'candidate_support' : 'not_established',
      factRefs: uniqueRefs.map(ref => ({id: ref.id, version: ref.version, approvalRef: byFact.get(identity(ref))?.approvalRef || null})),
      mappings: mappings.map(mapping => ({assessment: mapping.assessment, evidenceStatus: mapping.evidenceStatus, missingScope: mapping.missingScope || '', explanation: mapping.explanation, factRefs: clone(array(mapping.factRefs))})),
      evidence: clone(array(requirement.evidence)), sourceStatus: 'employer_requirement', independentlyVerified: false};
    requirements.all.push(item); requirements[status].push(item);
  }
  const effectiveAsOf = snapshot ? snapshotDate(snapshot, asOf) : asOf || null;
  const factReview = buildFactReview({...state, facts: scopedFacts}, {asOf: effectiveAsOf});
  const experienceBank = buildExperienceBank({...state, facts: scopedFacts}, {snapshot, asOf: effectiveAsOf});
  // Extraction diagnostics belong in the editable review. The saved master
  // profile contains approved claims and their citations, not uncited source
  // paragraphs or unrelated documents added after this snapshot.
  experienceBank.coverage = {documents: [], unrepresentedSegmentCount: 0, note: 'Source-passage extraction review is available in Facts. This consolidated bank contains approved claims and their citations.'};
  const currentReadiness = finalizationReadiness(state);
  const binding = {mode: snapshot ? 'snapshot' : 'preview', version: snapshot?.version || null,
    snapshotId: snapshot?.id || null, approvalRef: snapshot?.approvalRef || null, valid: !issues.length,
    factRefs: clone(factRefs), roleRefs: [], reviewScopeFrozen: scope.frozen, issues};
  const blockers = [...array(currentReadiness.blockers), ...issues.map(issue => ({...issue, message: 'A saved profile reference requires review.'}))];
  return {
    schemaVersion: 1, mode: binding.mode, version: binding.version, asOf: effectiveAsOf, binding,
    professionalSummary, sectionLabels: CONSOLIDATED_SECTION_LABELS, sections, otherApprovedFacts,
    roles: [], searchProfile, targetTitles, searchKeywords, searchTerms, requirements, factReview,
    experienceBank,
    professionalExperience: factReview.professionalExperience,
    review: {...review, unansweredQuestions: review.questions.filter(question => ['unresolved', 'deferred', 'needs_details'].includes(question.status) && !question.coveredByApprovedFacts),
      pendingFacts: reviewFacts.filter(fact => active(fact) && fact.approval === 'pending').map(fact => claim(state, fact)),
      conflicts: reviewFacts.filter(fact => active(fact) && fact.conflict).map(fact => claim(state, fact)),
      sourceIssues: reviewFacts.filter(fact => active(fact) && sourceStatus(state, fact) !== 'matched_source').map(fact => claim(state, fact)),
      missingFields: factReview.missingInformation,
      verificationNote: 'Approved source-stated or user-confirmed claims remain distinct from independently verified information.'},
    preferences: clone(snapshot?.searchPreferences || (!snapshot ? state.preferences?.search : {}) || {}),
    readiness: {...currentReadiness, scope: 'current_state_save_guard', ready: currentReadiness.ready === true && !issues.length, blockers},
    counts: {approvedFacts: scopedFacts.length, professionalFacts: professionalFacts.length, approvedRoles: 0, sourcedTitles: targetTitles.length,
      supportedRequirements: requirements.supported.length, missingRequirements: requirements.missing.length,
      conflictingRequirements: requirements.conflicting.length, unverifiedRequirements: requirements.unverified.length}
  };
}
