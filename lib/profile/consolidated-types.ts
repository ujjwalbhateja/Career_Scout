export type ConsolidatedClaim={id:string;version:number;statement:string;scope:string;confirmation:string;sourceStatus:string;approvalReceiptStatus:string;evidence:{quote:string;documentId:string;segmentId:string}[]};
export type ConsolidatedAnswer={id:string;questionId:string;status:string;text:string;documentId:string|null;stage:string;factRefs:{id:string;version:number}[]};
export type ConsolidatedProfileData={
  experienceBank?:{factualRecords:unknown;[key:string]:unknown};
  version:string|null;professionalSummary:{items:{statement:string}[]};
  sections:Record<string,ConsolidatedClaim[]>;sectionLabels:Record<string,string>;otherApprovedFacts:ConsolidatedClaim[];
  targetTitles:{title:string;kind:string}[];professionalExperience:{label:string;countingConvention?:string};
  counts:{professionalFacts:number;approvedRoles:number;supportedRequirements:number;missingRequirements:number;conflictingRequirements:number;unverifiedRequirements:number};
  requirements:{all:{id:string;text:string;status:string;importance:string;mappings:{explanation:string}[]}[]};
  review:{answers:ConsolidatedAnswer[];questions:{id:string;question:string}[];pendingAnswers:ConsolidatedAnswer[];pendingFacts:ConsolidatedClaim[];unansweredQuestions:{id:string}[];verificationNote:string};
};
