import {getProfileEnvironment} from '@/lib/profile-runtime';
import {ProfileMemory} from '@/lib/profile/providers.mjs';
import {ProfileError} from '@/lib/profile/domain.mjs';
import {profileAccess} from '@/lib/profile-access';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
// Metadata-only diagnostics require a valid, rate-limited workspace session.
export async function GET(request:Request){
  try{
    await profileAccess(request);
    const memory=new ProfileMemory(getProfileEnvironment(),'connection-probe-'+crypto.randomUUID());
    const health=await memory.connectionHealth();
    // Also exercise the exact RPC used by profile loading, with a fresh synthetic
    // ID; it never reads an identified user's data or creates records.
    const probe=await memory.load();
    return Response.json({...health,profileLoadReachable:probe.revision===0},{headers});
  }catch(error){
    return Response.json({connected:false,error:error instanceof ProfileError?error.message:'Profile storage connection check failed.'},{status:error instanceof ProfileError?error.status:503,headers});
  }
}
