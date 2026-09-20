export function championPage(history, requestedPage=1) {
  const events=history.filter(e=>!e.deleted).sort((a,b)=>Number(b.number)-Number(a.number));
  const pages=Math.max(1,Math.ceil(events.length/10));
  const page=Math.min(pages,Math.max(1,Number(requestedPage)||1));
  return {events:events.slice((page-1)*10,page*10),page,pages,total:events.length};
}

export function championLeaders(history) {
  const wins=new Map();
  for(const event of history.filter(e=>!e.deleted)) {
    const winner=event.standings?.find(t=>Number(t.rank)===1) || event.standings?.[0];
    for(const name of new Set(winner?.members||[])) {
      if(typeof name==='string'&&name.trim())wins.set(name,(wins.get(name)||0)+1);
    }
  }
  const leaders=[...wins].map(([name,wins])=>({name,wins})).sort((a,b)=>b.wins-a.wins||a.name.localeCompare(b.name,'ko'));
  let rank=0;
  return leaders.slice(0,10).map((p,i)=>{if(!i||p.wins!==leaders[i-1].wins)rank=i+1;return {...p,rank};});
}
