import {inMaintenance} from './maintenance-clock.mjs?v=maintenance-31';
const config=await fetch('./maintenance-config.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).catch(()=>({enabled:false}));
if(!config.enabled){await import('./app.js?v=cost-38');}else{
  const panel=document.createElement('section');panel.id='maintenance-screen';panel.setAttribute('role','status');
  panel.innerHTML='<div><p>☾ LUNA ISLAND</p><h1>루나섬 정기 점검</h1><p>매일 오전 5:00–6:00 · 한국 시간</p><p id="maintenance-message"></p><p>서버가 정상 연결되면 자동으로 열립니다.</p></div>';
  const style=document.createElement('style');style.textContent='#maintenance-screen{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:radial-gradient(ellipse at top,#292348,#090b22 70%);color:#f1ebff;text-align:center;padding:24px}#maintenance-screen div{max-width:560px;border:1px solid #655280;border-radius:24px;padding:40px}#maintenance-screen h1{font-size:32px}#maintenance-screen p{line-height:1.8}body.maintenance-active{overflow:hidden}body.maintenance-active>*:not(#maintenance-screen):not(style):not(script){visibility:hidden}';document.head.append(style);
  let started=false,checking=false;
  const show=(text,scheduled=false)=>{panel.querySelector('h1').textContent=scheduled?'루나섬 정기 점검':'서버 연결 대기';panel.querySelector('h1 + p').hidden=!scheduled;if(!panel.isConnected)document.body.append(panel);document.body.classList.add('maintenance-active');panel.querySelector('#maintenance-message').textContent=text;};
  async function tick(){if(checking)return;checking=true;try{
    if(inMaintenance()){if(started){location.reload();return;}show('서버 점검 중입니다. 오전 6시부터 재연결을 확인합니다.',true);return;}
    if(started)return;
    const cfg=window.LUNA_SUPABASE;
    const r=await fetch(cfg.url+'/rest/v1/luna_streamers?select=id&limit=1',{headers:{apikey:cfg.publishableKey},cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!r.ok||!Array.isArray(await r.json())){show('서버에 연결할 수 없습니다. 잠시 후 자동으로 다시 확인합니다.');return;}
    await import('./app.js?v=cost-38');started=true;panel.remove();document.body.classList.remove('maintenance-active');
  }catch{show('서버 연결을 기다리고 있습니다. 잠시 후 자동으로 다시 확인합니다.');}finally{checking=false;}}
  await tick();setInterval(tick,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
}
