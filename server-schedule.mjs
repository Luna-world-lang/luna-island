import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {scheduledAction} from './maintenance-clock.mjs';
export async function runSchedule({config,token,mode='check',now=()=>new Date(),request=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
  if(mode!=='check'&&mode!=='restore'&&!config.enabled){console.log('Schedule disabled; no server changes.');return;}
  if(!['check','auto','restore'].includes(mode))throw Error('Invalid mode.');
  if(!token)throw Error('SUPABASE_ACCESS_TOKEN secret is missing.');
  if(config.projectRef!=='jwydeimcxnwpvzsgnwzp')throw Error('Unexpected project.');
  const base='https://api.supabase.com/v1/projects/'+config.projectRef;
  async function api(path='',method='GET'){
    const r=await request(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{}),signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw Error('Supabase management request failed: HTTP '+r.status);
    const t=await r.text();return t?JSON.parse(t):{};
  }
  let project=await api();console.log('Project status:',project.status);
  if(mode==='check'){console.log('Read-only token check passed. No server changes.');return;}
  const action=mode==='restore'?'restore':scheduledAction(now());
  if(action==='none'){console.log('Outside schedule window; skipping.');return;}
  if(action==='pause'){
    if(['INACTIVE','GOING_DOWN'].includes(project.status))return;
    if(project.status!=='ACTIVE_HEALTHY')throw Error('Refusing to pause an unhealthy project.');
    if(scheduledAction(now())!=='pause')return;
    await api('/pause','POST');console.log('Pause requested.');
    for(let i=0;i<30;i++){await sleep(15000);project=await api();if(project.status==='INACTIVE'){console.log('Pause confirmed.');return;}}
    throw Error('Pause was not confirmed in time; inspect project status.');
  }
  let requested=false;
  for(let i=0;i<40;i++){
    if(project.status==='INACTIVE'&&!requested){await api('/restore','POST');requested=true;console.log('Restore requested.');}
    if(project.status==='ACTIVE_HEALTHY'){
      const r=await request('https://'+config.projectRef+'.supabase.co/rest/v1/luna_streamers?select=id&limit=1',{headers:{apikey:'sb_publishable_6H41jkUkfFrqGQu9mMl5fw_3ln5Ajhj'},signal:AbortSignal.timeout(15000)});
      if(r.ok&&Array.isArray(await r.json())){console.log('Public data API healthy.');return;}
    }
    await sleep(15000);project=await api();
  }
  throw Error('Server not ready; scheduled recovery will retry.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await runSchedule({config:JSON.parse(await readFile(new URL('./maintenance-config.json',import.meta.url),'utf8')),token:process.env.SUPABASE_ACCESS_TOKEN,mode:process.env.RUN_MODE||'check'});}catch(e){console.error(e.message);process.exitCode=1;}
}
