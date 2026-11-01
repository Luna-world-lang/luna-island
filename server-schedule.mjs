import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {scheduledAction,inMaintenance} from './maintenance-clock.mjs';
const permanent=message=>Object.assign(new Error(message),{permanent:true});
export async function runSchedule({config,token,mode='check',now=()=>new Date(),request=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
  if(!['check','auto','restore'].includes(mode))throw Error('Invalid mode.');
  if(mode==='auto'&&!config.enabled){console.log('Schedule disabled; no server changes.');return;}
  const action=mode==='check'?'check':mode==='restore'?'restore':scheduledAction(now());
  if(action==='none'){console.log('Outside schedule window; skipping.');return;}
  if(!token)throw Error('SUPABASE_ACCESS_TOKEN secret is missing.');
  if(config.projectRef!=='jwydeimcxnwpvzsgnwzp')throw Error('Unexpected project.');
  const base='https://api.supabase.com/v1/projects/'+config.projectRef;
  async function api(path='',method='GET'){
    const r=await request(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{}),signal:AbortSignal.timeout(10000)});
    if(!r.ok){const message='Supabase management request failed: HTTP '+r.status;if(r.status<500&&r.status!==429&&r.status!==408)throw permanent(message);throw Error(message);}
    const t=await r.text();return t?JSON.parse(t):{};
  }
  async function publicHealth(){
    const r=await request('https://'+config.projectRef+'.supabase.co/rest/v1/luna_streamers?select=id&limit=1',{headers:{apikey:'sb_publishable_6H41jkUkfFrqGQu9mMl5fw_3ln5Ajhj'},cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!r.ok){if(r.status<500&&r.status!==429&&r.status!==408)throw permanent('Public data API configuration error: HTTP '+r.status);return false;}
    if(!Array.isArray(await r.json()))throw permanent('Unexpected public data API response.');
    return true;
  }
  async function initialProject(){
    for(let i=0;i<3;i++){try{return await api();}catch(e){if(e.permanent||i===2)throw e;console.log('Management connection unavailable; retrying.');await sleep(5000);}}
  }
  let project=await initialProject();console.log('Project status:',project.status);
  if(action==='check'){
    if(project.status!=='ACTIVE_HEALTHY')throw Error('Project is not healthy: '+project.status);
    for(let i=0;i<3;i++){try{if(await publicHealth()){console.log('Read-only check passed: management and public data API healthy. No server changes.');return;}}catch(e){if(e.permanent)throw e;}await sleep(5000);}
    throw Error('Public data API unavailable. No server changes.');
  }
  if(action==='pause'){
    if(['INACTIVE','GOING_DOWN'].includes(project.status))return;
    if(project.status!=='ACTIVE_HEALTHY')throw Error('Refusing to pause an unhealthy project.');
    if(scheduledAction(now())!=='pause')return;
    await api('/pause','POST');console.log('Pause requested.');
    for(let i=0;i<24;i++){await sleep(15000);try{project=await api();if(project.status==='INACTIVE'){console.log('Pause confirmed.');return;}}catch(e){if(e.permanent)throw e;console.log('Waiting for pause status.');}}
    throw Error('Pause was not confirmed in time; inspect project status.');
  }
  let requested=false,restarted=false,failedChecks=0;
  // At most 24 polls (under 15-minute workflow limit), one restore and one restart.
  for(let i=0;i<24;i++){
    // A queued recovery must never open the project during the next maintenance window.
    if(mode==='auto'&&inMaintenance(now())){console.log('Maintenance window reached; stopping recovery.');return;}
    try{
      if(i>0)project=await api();
      console.log('Recovery poll',i+1,project.status);
      if(project.status==='INACTIVE'&&!requested){requested=true;await api('/restore','POST');console.log('Restore requested.');}
      else if(['ACTIVE_HEALTHY','ACTIVE_UNHEALTHY'].includes(project.status)){
        let healthy=false;
        try{healthy=await publicHealth();}catch(e){if(e.permanent)throw e;console.log('Public data connection timed out; retrying.');}
        if(healthy){console.log('Public data API healthy. Recovery confirmed.');return;}
        failedChecks++;
        if(failedChecks>=8&&!restarted){
          restarted=true;failedChecks=0;
          // Mark before requesting: a lost HTTP response must not cause duplicate restarts.
          await api('/restart','POST');console.log('Persistent data outage: one restart requested.');
        }
      }else{failedChecks=0;}
    }catch(e){if(e.permanent)throw e;console.log('Temporary recovery request failure; checking status again.');}
    await sleep(15000);
  }
  throw Error('Server not ready after bounded recovery; next scheduled run will retry.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await runSchedule({config:JSON.parse(await readFile(new URL('./maintenance-config.json',import.meta.url),'utf8')),token:process.env.SUPABASE_ACCESS_TOKEN,mode:process.env.RUN_MODE||'check'});}catch(e){console.error(e.message);process.exitCode=1;}
}
