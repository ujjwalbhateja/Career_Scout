import {auditRoute} from './policy.mjs';
// The authenticated API resolves the owner, then Master dispatches a scoped
// operation to Profile. Existing Profile/Fact/Builder/Memory boundaries remain.
export async function dispatchProfileOperation(service,operation){
  const {file,body}=operation;
  const audit=[auditRoute('user','master','profile-intake'),auditRoute('master','profile',file?'document-upload':body.action)];
  const result=file?await service.upload(file,body):await service.action(body);
  audit.push(auditRoute('profile','master','profile-result'));
  return {...result,dispatch:audit};
}
