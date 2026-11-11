import {requireChatGPTUser} from './chatgpt-auth';
import {getProfileEnvironment} from '@/lib/profile-runtime';
import {publicDemoEnabled} from '@/lib/profile/visitor-access.mjs';
import ProfileWorkspace from './profile/workspace';
import './profile/profile.css';
import './profile/architecture/structure.css';
import './workspace.css';
export const dynamic='force-dynamic';
export default async function CareerScoutPage(){const publicDemo=publicDemoEnabled(getProfileEnvironment());if(!publicDemo)await requireChatGPTUser('/');return <ProfileWorkspace publicDemo={publicDemo}/>;}
