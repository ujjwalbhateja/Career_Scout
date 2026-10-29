import {requireChatGPTUser} from '@/app/chatgpt-auth';
import record from '@/data/scout-progress.json';
import type {ProgressRecord} from '@/lib/progress-types';
import ProfileArchitecture from './structure';
import '../profile.css';
import './structure.css';
export const dynamic='force-dynamic';
export const metadata={title:'Profile architecture and progress — Career Scout'};
export default async function ProfileArchitecturePage(){
  await requireChatGPTUser('/profile/architecture');
  return <ProfileArchitecture initialRecord={record as ProgressRecord}/>;
}
