import record from '@/data/scout-progress.json';
import ProgressTracker from './tracker';
import type { ProgressRecord } from '@/lib/progress-types';

export const metadata={title:'Scout progress — Career Scout',description:'Implemented capabilities, remaining work and dependencies for your daily job agent.'};
export default function ProgressPage(){return <ProgressTracker initialRecord={record as ProgressRecord}/>;}
