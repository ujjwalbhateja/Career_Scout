export type ProgressStatus='done'|'partial'|'pending';
export type ProgressTask={id:string;stage:string;title:string;status:ProgressStatus;detail:string;evidence?:string;source?:string;dependsOn:string[];inputs?:string[];acceptance:string};
export type ProgressStage={id:string;title:string;description:string;next:string};
export type ProgressRecord={schemaVersion:number;revision:string;reviewedOn:string;summary:string;stages:ProgressStage[];tasks:ProgressTask[];validation:{date:string;title:string;detail:string}[]};
export type ProgressResponse={record:ProgressRecord;servedAt:string;pollIntervalSeconds:number;connection:{keenableConfigured:boolean}};
