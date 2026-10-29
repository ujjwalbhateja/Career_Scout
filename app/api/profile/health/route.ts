import {getProfileEnvironment} from '@/lib/profile-runtime';
import {ProfileMemory} from '@/lib/profile/providers.mjs';
import {ProfileError} from '@/lib/profile/domain.mjs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
// Metadata-only diagnostics behind the existing private Sites access gate,
// like /api/scout. This does not grant access to any visitor's profile.
export async function GET(){
  try{
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
