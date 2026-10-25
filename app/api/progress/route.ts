import record from '@/data/scout-progress.json';
import { validateProgress, PROGRESS_POLL_SECONDS } from '@/lib/project-progress.mjs';
import { getSearchKey } from '@/lib/search-runtime';

export const dynamic='force-dynamic';
export function GET(){
  // Owner-private Sites access applies to this route; it never calls a paid provider.
  return Response.json({record:validateProgress(record),servedAt:new Date().toISOString(),pollIntervalSeconds:PROGRESS_POLL_SECONDS,connection:{keenableConfigured:!!getSearchKey()}},{headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
