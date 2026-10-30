import {redirect} from 'next/navigation';
export const dynamic='force-dynamic';
export default function LegacyPage(){redirect('/?view=workflow');}
