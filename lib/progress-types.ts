export type ProgressStatus='not_started'|'in_progress'|'blocked'|'in_review'|'complete';
export type ProgressTask={id:string;owner:string;stage:string;title:string;status:ProgressStatus;detail:string;evidence?:string;source?:string;dependsOn:string[];inputs?:string[];acceptance:string;notes:string[];blockers:string[];outputLinks:{label:string;url:string}[];legacy?:boolean;originalOwner?:string;originalStatus?:string;legacyStage?:string;ownerHistory?:{owner:string;date:string;reason:string}[]};
export type ProgressStage={id:string;title:string;description:string;next:string};
export type ProgressAgent={id:string;title:string;kind:string;parent?:string;description:string;next:string;outputs:string};
export type ProgressRecord={schemaVersion:number;revision:string;reviewedOn:string;summary:string;agents:ProgressAgent[];stages:ProgressStage[];tasks:ProgressTask[];communication:{from:string;to:string}[];framework:{name:string;version:string;mode:string;note:string;documentation:string};validation:{date:string;title:string;detail:string}[]};
export type ProgressResponse={record:ProgressRecord;servedAt:string;pollIntervalSeconds:number;connection:{keenableConfigured:boolean}};
