import {requireChatGPTUser} from './chatgpt-auth';
import ProfileWorkspace from './profile/workspace';
import './profile/profile.css';
import './profile/architecture/structure.css';
import './workspace.css';
export const dynamic='force-dynamic';
export default async function CareerScoutPage(){await requireChatGPTUser('/');return <ProfileWorkspace/>;}
