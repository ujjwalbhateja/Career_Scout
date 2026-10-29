import { requireChatGPTUser } from '@/app/chatgpt-auth';
import ProfileWorkspace from './workspace';
import './profile.css';
export const dynamic='force-dynamic';
export default async function ProfilePage(){
  await requireChatGPTUser('/profile');
  return <ProfileWorkspace/>;
}
