type Snapshot={version:string;createdAt:string;stale:boolean};

export default function FinalProfileSaveStatus({loaded,latest,currentVersion}:{loaded:boolean;latest?:Snapshot;currentVersion?:string}){
  if(!loaded)return <p>Loading Final Profile save status…</p>;
  if(!latest)return <p>No Final Profile saved yet.</p>;
  const date=new Date(latest.createdAt);
  const validDate=!!latest.createdAt&&Number.isFinite(date.getTime());
  const current=!latest.stale&&currentVersion===latest.version;
  return <div aria-label="Final Profile save status">
    <p><strong>Last successful Final Profile save: </strong>{validDate?<time dateTime={latest.createdAt}>{new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'long',timeStyle:'long'}).format(date)} (New York)</time>:'Save time unavailable'} · {latest.version}</p>
    <p>{current?'Up to date with your saved profile information.':'Outdated — save an updated Final Profile to include your latest information.'}</p>
  </div>;
}
