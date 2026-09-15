export const tiers = ['', 'SSS','SS','S','A','B','C','D','F','닭','나뭇가지'];
export const tierCost = tier => ({SSS:10,SS:9,S:8,A:7,B:6,C:5,D:4,F:3,'닭':2,'나뭇가지':1}[tier] ?? 1);
export function balance(players, teamIds, capacity) {
  const attending = players.filter(p => p.attendance === 'present');
  if (!teamIds.length || attending.length > teamIds.length * capacity) throw Error('출석 인원에 맞게 팀 수 또는 팀당 정원을 늘려 주세요.');
  const bins = teamIds.map(id => ({id, cost:0, players:[]}));
  for (const p of [...attending].sort((a,b)=>b.cost-a.cost || a.id.localeCompare(b.id))) {
    const bin = [...bins].filter(b=>b.players.length<capacity).sort((a,b)=>a.players.length-b.players.length || a.cost-b.cost || a.id.localeCompare(b.id))[0];
    bin.players.push(p); bin.cost += p.cost;
  }
  // Improve cost balance without changing balanced team sizes.
  for(let pass=0;pass<100;pass++) {
    let best=null, gain=0;
    for(let i=0;i<bins.length;i++) for(let j=i+1;j<bins.length;j++)
      for(const a of bins[i].players) for(const b of bins[j].players) {
        const d=a.cost-b.cost, improvement=2*d*(bins[i].cost-bins[j].cost-d);
        if(improvement>gain+1e-8) {gain=improvement; best={i,j,a,b,d};}
      }
    if(!best) break;
    const {i,j,a,b,d}=best;
    bins[i].players[bins[i].players.indexOf(a)]=b; bins[j].players[bins[j].players.indexOf(b)]=a;
    bins[i].cost-=d; bins[j].cost+=d;
  }
  return players.map(p=>({...p,team:bins.find(b=>b.players.some(x=>x.id===p.id))?.id || ''}));
}
export function parseCSV(text) {
  text=text.replace(/^\uFEFF/,'');
  const delimiter=text.split(/\r?\n/)[0].includes('\t')?'\t':',';
  const rows=[]; let row=[], field='', quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') {if(quoted && text[i+1]==='"') {field+='"';i++;} else quoted=!quoted;}
    else if(c===delimiter && !quoted) {row.push(field.trim());field='';}
    else if((c==='\n'||c==='\r')&&!quoted) {if(c==='\r'&&text[i+1]==='\n')i++; row.push(field.trim()); if(row.some(Boolean))rows.push(row); row=[];field='';}
    else field+=c;
  }
  if(quoted)throw Error('CSV 따옴표가 닫히지 않았습니다.');
  row.push(field.trim());if(row.some(Boolean))rows.push(row);
  if(rows.length<2)throw Error('열 제목과 경기 결과가 있는 CSV 파일을 선택해 주세요.');
  if(rows.some(r=>r.length!==rows[0].length))throw Error('행마다 열 수가 다릅니다. 원본 파일을 확인해 주세요.');
  return rows;
}
export function aggregate(rows, map, mode, streamers, teams, round, placementPoints, killPoint) {
  if(!Number.isInteger(round)||round<1||round>4)throw Error('라운드는 1~4로 지정해 주세요.');
  if(!Number.isFinite(killPoint)||killPoint<0)throw Error('킬당 점수를 입력해 주세요.');
  if(new Set([map.name,map.rank,map.kills]).size!==3)throw Error('대상·순위·킬 열을 각각 다르게 선택해 주세요.');
  const seen=new Set(), grouped=new Map();
  for(const row of rows.slice(1)) {
    const key=row[map.name]?.trim();
    if(!key||seen.has(key))throw Error(`중복되거나 비어 있는 대상: ${key || '(빈 값)'}`);
    seen.add(key);
    const matches=mode==='player'?streamers.filter(p=>p.game_nickname===key):teams.filter(t=>t.name===key||t.id===key);
    if(matches.length!==1)throw Error(`대상을 하나로 연결할 수 없습니다: ${key}`);
    const teamId=mode==='player'?matches[0].team_id:matches[0].id;
    if(!teamId)throw Error(`${key}: 저장된 참가 팀이 없습니다.`);
    const rank=Number(row[map.rank]),kills=Number(row[map.kills]);
    if(!row[map.rank]||!row[map.kills]||!Number.isInteger(rank)||rank<1||rank>8||!Number.isInteger(kills)||kills<0||kills>999999)throw Error(`${key}: 순위 또는 킬 값이 잘못되었습니다.`);
    const old=grouped.get(teamId);
    if(old&&old.placement!==rank)throw Error(`${key}: 같은 팀의 순위가 서로 다릅니다.`);
    grouped.set(teamId,{teamId,round,placement:rank,kills:(old?.kills||0)+kills});
  }
  const result=[...grouped.values()];
  if(mode==='player') for(const r of result) {
    const missing=streamers.filter(p=>p.team_id===r.teamId && (!p.game_nickname || !seen.has(p.game_nickname)));
    if(missing.length)throw Error('같은 팀의 선수 결과가 누락되었습니다: '+missing.map(p=>p.name||p.game_nickname||p.id).join(', '));
  }
  if(new Set(result.map(r=>r.placement)).size!==result.length)throw Error('팀 순위가 중복되었습니다.');
  return result.map(r=>{
    const base=placementPoints[r.placement];
    if(base===''||base==null||!Number.isFinite(Number(base))||Number(base)<0)throw Error(`${r.placement}위의 순위 점수를 입력해 주세요.`);
    const points=Number(base)+r.kills*killPoint;
    if(!Number.isInteger(points)||points>999999||r.kills>999999)throw Error('합계 점수·킬은 999999 이하의 정수여야 합니다.');
    return {...r,points,updatedAt:new Date().toISOString()};
  });
}
