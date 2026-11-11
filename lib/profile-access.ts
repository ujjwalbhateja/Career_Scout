import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getProfileEnvironment} from '@/lib/profile-runtime';
import {ProfileError} from '@/lib/profile/domain.mjs';
import {publicDemoEnabled,resolveVisitor,reserveVisitorUsage} from '@/lib/profile/visitor-access.mjs';

export type ProfileAccess={owner:string;visitor:boolean;expiresAt?:number;setCookie?:string};
export async function profileAccess(request:Request,{create=false}={}):Promise<ProfileAccess>{
  const env=getProfileEnvironment();
  if(publicDemoEnabled(env)){
    // Public browsing always uses an isolated anonymous namespace, even when
    // the browser happens to carry a signed-in Site identity.
    const access=await resolveVisitor(request,env,{create});
    await reserveVisitorUsage(env,access.owner,'request');
    return access;
  }
  const user=await getChatGPTUser();
  if(!user)throw new ProfileError('Sign in to access your private profile.',401);
  return {owner:user.userId,visitor:false};
}
export function accessHeaders(base:Record<string,string>,access?:ProfileAccess){
  return {...base,...(access?.setCookie?{'Set-Cookie':access.setCookie}:{})};
}
