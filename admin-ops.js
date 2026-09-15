import {balance, tiers, tierCost, parseCSV, aggregate} from './ops-core.js?v=game-13';
export function initAdminOps(backend, refresh) {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button=document.createElement('button'); button.id='open-admin-ops'; button.className='admin-button';button.hidden=true;button.textContent='팀 편성 · 집계 · 백업';
  document.querySelector('.site-header').append(button);
  const dialog=document.createElement('dialog');dialog.id='admin-ops';dialog.setAttribute('aria-labelledby','ops-title');
  dialog.innerHTML=`<div class="drawer-header"><div><p class="eyebrow">LUNA ADMIN</p><h2 id="ops-title">대회 운영실</h2></div><button type="button" class="icon-button" id="ops-close" aria-label="운영실 닫기">×</button></div>
  <p id="ops-feedback" role="status"></p><div class="ops-tabs"><button data-tab="roster">출석 · 팀 편성</button><button data-tab="import">결과 가져오기</button><button data-tab="backup">백업 · 복원</button></div>
  <section data-panel="roster"><p>출석자를 드래그해 팀에 놓거나 카드의 팀 선택을 이용하세요. 변경한 편성은 저장 후 공개 대시보드에 반영됩니다.</p>
  <div class="ops-toolbar"><label>사용할 팀 수<input id="ops-team-count" type="number" min="1" max="8" value="8"></label><label>팀당 정원<input id="ops-capacity" type="number" min="1" max="20" value="3"></label><button id="ops-auto">균형 자동 분배</button><button id="ops-all-present">전체 출석</button><button id="ops-all-absent">전체 결석</button><button id="ops-save" class="primary-button">출석·편성 저장</button><button id="ops-reload">저장 상태 다시 읽기</button></div>
  <p class="drawer-help">티어별 기본 코스트는 SSS 10 → SS 9 → S 8 → A 7 → B 6 → C 5 → D 4 → F 3 → 닭 2 → 나뭇가지 1입니다. 코스트를 직접 조정할 수 있으며, 자동 분배는 인원수와 코스트 합계를 균형 있게 맞춥니다.</p><p id="ops-count"></p><div id="ops-board"></div></section>
  <section data-panel="import" hidden><h3>게임 ID로 결과 불러오기</h3><div class="ops-toolbar"><label>게임 ID<input id="ops-game-id" inputmode="numeric" maxlength="12" placeholder="예: 64894800"></label><button id="ops-game-lookup">경기 조회</button></div><p>공식 경기 결과를 조회한 뒤 게임 속 팀과 루나섬 팀을 연결합니다. 등록된 게임 닉네임을 기준으로 팀을 제안하며, 저장 전 직접 확인할 수 있습니다.</p><div id="ops-game-teams"></div><button id="ops-game-apply" hidden>연결한 팀으로 집계 준비</button><hr><h3>또는 결과 파일 가져오기</h3><p>CSV/TSV 파일의 열을 연결해 미리보기한 뒤 저장합니다.</p>
  <label>결과 파일<input id="ops-file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values"></label><div id="ops-mapping" hidden>
  <div class="ops-toolbar"><label>행 기준<select id="ops-mode"><option value="player">선수별 개인 킬</option><option value="team">팀별 팀 킬</option></select></label><label>닉네임 / 팀 이름 열<select id="ops-col-name"></select></label><label>순위 열<select id="ops-col-rank"></select></label><label>킬 열<select id="ops-col-kills"></select></label><label>라운드<input id="ops-round" type="number" min="1" max="4" value="1"></label><label>킬당 점수<input id="ops-kill-point" type="number" min="0" max="9999" value="1"></label></div>
  <p>선수별 파일은 등록한 게임 닉네임과 정확히 일치해야 합니다. 같은 팀의 개인 킬을 합산합니다. 팀 킬이 선수마다 반복된 파일은 선수별 방식으로 넣지 마세요.</p><div class="ops-toolbar">${Array.from({length:8},(_,i)=>`<label>${i+1}위 점수<input data-placement="${i+1}" type="number" min="0" max="999999" placeholder="입력 필요"></label>`).join('')}</div>
  <button id="ops-preview">집계 미리보기</button></div><div id="ops-import-preview"></div><button id="ops-import-save" class="primary-button" hidden>확인한 결과 저장</button><p class="drawer-help">동일 라운드·팀의 기존 점수는 교체합니다. 저장 전에 자동 백업하며, 대회 결과 확정은 점수 입력 화면에서 별도로 진행합니다.</p></section>
  <section data-panel="backup" hidden><h3>기록을 안전하게 보관하세요</h3><p>현재 점수, 우승 기록, 스트리머 명단, 팀 이름, 출석·코스트·편성을 서버에 백업하고 JSON 파일로 내려받습니다. 프로필 사진은 주소만 포함됩니다.</p><button id="ops-backup" class="primary-button">현재 상태 백업 · 내려받기</button><p>복원하면 해당 시점의 전체 상태로 돌아갑니다. 복원 직전 상태도 자동 백업되어 되돌릴 수 있습니다. 서버 백업은 최근 50개를 표시합니다.</p><div id="ops-backups"></div></section>`;
  document.body.append(dialog);
  const $=s=>dialog.querySelector(s), $$=s=>[...dialog.querySelectorAll(s)];
  let draft=[], data, revision, backups=[], busy=false, dirty=false, csv=null, preview=null, dragged=null, match=null, sourceGameId=null;
  const say=t=>{$('#ops-feedback').textContent=t;};
  const download=(obj,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);};
  function auth() {button.hidden=!backend.isAdmin;button.disabled=busy||!backend.ready;if(!backend.isAdmin){dialog.close();draft=[];data=null;csv=null;preview=null;match=null;sourceGameId=null;$('#ops-game-teams').replaceChildren();$('#ops-game-apply').hidden=true;$('#ops-board').replaceChildren();$('#ops-backups').replaceChildren();$('#ops-import-preview').replaceChildren();$('#ops-file').value='';$('#ops-mapping').hidden=true;$('#ops-import-save').hidden=true;}}
  function setBusy(value){busy=value;$$('button,input,select').forEach(e=>e.disabled=value);auth();}
  async function action(fn){if(busy||!backend.isAdmin)return;setBusy(true);try{await fn();}catch(e){say(e.message);}finally{setBusy(false);}}
  function invalidate(){dirty=true;preview=null;$('#ops-import-save').hidden=true;$('#ops-import-preview').replaceChildren();say('저장하지 않은 변경사항이 있습니다.');}
  async function load(){
    const ops=await backend.ops('read'); const current=await backend.read();
    if(ops.revision!==current.revision)throw Error('다른 화면에서 변경되었습니다. 다시 읽기를 눌러 주세요.');
    data=current;revision=ops.revision;backups=ops.backups;
    draft=data.streamers.map(p=>{const old=ops.data.players?.find(x=>x.id===p.id);const attendance=old?.attendance || (p.team_id?'present':'pending');return {id:p.id,name:p.name,tier:p.tier||'',cost:old?.cost??tierCost(p.tier),attendance,team:attendance==='present'?(p.team_id||''):''};});
    $('#ops-team-count').value=ops.data.teamCount||8;$('#ops-capacity').value=ops.data.capacity||3;
    dirty=false;preview=null;$('#ops-import-save').hidden=true;$('#ops-import-preview').replaceChildren();renderBoard();renderBackups();
  }
  function renderBackups(){$('#ops-backups').innerHTML=backups.map(b=>`<article class="ops-backup-row"><span>${esc(new Date(b.created_at).toLocaleString('ko-KR'))} · ${esc(b.label)}</span><button data-download="${esc(b.id)}">내려받기</button><button data-restore="${esc(b.id)}">이 백업으로 복원</button></article>`).join('')||'<p>아직 백업이 없습니다.</p>';}
  function renderBoard(){
    const attending=draft.filter(p=>p.attendance==='present');
    $('#ops-count').textContent=`출석 ${attending.length}명 · 결석 ${draft.filter(p=>p.attendance==='absent').length}명 · 미확인 ${draft.filter(p=>p.attendance==='pending').length}명 · 출석자 미배정 ${attending.filter(p=>!p.team).length}명`;
    const card=p=>`<article class="ops-player" draggable="${p.attendance==='present'}" data-player-id="${esc(p.id)}"><strong>${esc(p.name)}</strong><div class="ops-player-fields"><label>출석<select data-edit="attendance"><option value="pending" ${p.attendance==='pending'?'selected':''}>미확인</option><option value="present" ${p.attendance==='present'?'selected':''}>출석</option><option value="absent" ${p.attendance==='absent'?'selected':''}>결석</option></select></label><label>티어<select data-edit="tier">${tiers.map(t=>`<option value="${esc(t)}" ${p.tier===t?'selected':''}>${esc(t||'미등록')}</option>`).join('')}</select></label><label>코스트<input data-edit="cost" type="number" min="0" max="999" step="0.1" value="${p.cost}"></label><label>팀 선택<select data-edit="team"><option value="">미배정</option>${data.teams.map(t=>`<option value="${esc(t.id)}" ${p.team===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label></div></article>`;
    const zones=[{id:'',name:'대기 명단 · 미배정'},...data.teams];
    $('#ops-board').innerHTML=zones.map(t=>{const people=draft.filter(p=>p.team===t.id);return `<section class="ops-zone" data-drop-team="${esc(t.id)}"><h3>${esc(t.name)} <small>${people.length}명 · ${people.reduce((a,p)=>a+p.cost,0).toFixed(1)} 코스트</small></h3>${people.map(card).join('')||'<p class="drawer-help">출석자를 여기에 놓으세요.</p>'}</section>`;}).join('');
  }
  function move(id,team){const p=draft.find(p=>p.id===id);if(!p)return;if(p.attendance!=='present'&&team)throw Error('출석으로 표시한 사람만 팀에 배정할 수 있습니다.');const cap=Number($('#ops-capacity').value);if(team&&draft.filter(p=>p.team===team&&p.id!==id).length>=cap)throw Error('팀 정원이 찼습니다. 정원을 조정하거나 다른 팀에 배정하세요.');p.team=team;invalidate();renderBoard();}
  $('#ops-board').addEventListener('change',e=>{const row=e.target.closest('[data-player-id]');if(!row||busy||!backend.isAdmin)return;const p=draft.find(p=>p.id===row.dataset.playerId),field=e.target.dataset.edit;try{if(field==='team'){move(p.id,e.target.value);return;}if(field==='cost'){const n=Number(e.target.value);if(e.target.value===''||!Number.isFinite(n)||n<0||n>999)throw Error('코스트는 0~999로 입력하세요.');p.cost=n;}else if(field==='attendance'){p.attendance=e.target.value;if(p.attendance!=='present')p.team='';}else if(field==='tier'){p.tier=e.target.value;p.cost=tierCost(p.tier);}invalidate();renderBoard();}catch(error){say(error.message);renderBoard();}});
  $('#ops-board').addEventListener('dragstart',e=>{const row=e.target.closest('[data-player-id]');if(!row||busy||!backend.isAdmin){e.preventDefault();return;}dragged=row.dataset.playerId;e.dataTransfer.setData('text/plain',dragged);});
  $('#ops-board').addEventListener('dragover',e=>{if(dragged&&e.target.closest('[data-drop-team]'))e.preventDefault();});
  $('#ops-board').addEventListener('drop',e=>{e.preventDefault();const zone=e.target.closest('[data-drop-team]');if(!zone||!dragged||busy||!backend.isAdmin)return;try{move(dragged,zone.dataset.dropTeam);}catch(err){say(err.message);}dragged=null;});
  $('#ops-board').addEventListener('dragend',()=>{dragged=null;});
  $('#ops-auto').onclick=()=>{try{const count=Number($('#ops-team-count').value),cap=Number($('#ops-capacity').value);if(!Number.isInteger(count)||count<1||count>8||!Number.isInteger(cap)||cap<1||cap>20)throw Error('팀 수는 1~8, 정원은 1~20으로 입력하세요.');draft=balance(draft,data.teams.slice(0,count).map(t=>t.id),cap);invalidate();renderBoard();}catch(e){say(e.message);}};
  for(const [id,status] of [['ops-all-present','present'],['ops-all-absent','absent']])$('#'+id).onclick=()=>{draft.forEach(p=>{p.attendance=status;if(status!=='present')p.team='';});invalidate();renderBoard();};
  $('#ops-save').onclick=()=>action(async()=>{
    const capacity=Number($('#ops-capacity').value),teamCount=Number($('#ops-team-count').value);
    if(!Number.isInteger(capacity)||capacity<1||capacity>20||!Number.isInteger(teamCount)||teamCount<1||teamCount>8)throw Error('팀 수·정원을 확인해 주세요.');
    if(data.teams.some(t=>draft.filter(p=>p.team===t.id).length>capacity))throw Error('정원을 초과한 팀이 있습니다.');
    await backend.ops('save',{players:draft.map(({id,tier,cost,attendance,team})=>({id,tier,cost,attendance,team})),capacity,teamCount},revision);await load();await refresh();say('출석·티어·코스트·팀 편성을 저장했습니다.');
  });
  $('#ops-reload').onclick=()=>action(async()=>{if(dirty&&!confirm('저장하지 않은 편성을 버리고 다시 읽을까요?'))return;await load();say('저장된 상태를 불러왔습니다.');});
  for(const input of [$('#ops-team-count'),$('#ops-capacity')])input.onchange=invalidate;
  const clearPreview=()=>{preview=null;$('#ops-import-save').hidden=true;$('#ops-import-preview').replaceChildren();};
  const clearMatch=()=>{match=null;sourceGameId=null;csv=null;clearPreview();$('#ops-game-teams').replaceChildren();$('#ops-game-apply').hidden=true;$('#ops-mapping').hidden=true;};
  $('#ops-game-id').oninput=clearMatch;
  $('#ops-game-lookup').onclick=()=>action(async()=>{
    clearMatch();if(dirty)throw Error('팀 편성을 먼저 저장하세요.');
    const id=$('#ops-game-id').value.trim();if(!/^[1-9][0-9]{0,11}$/.test(id))throw Error('게임 ID를 숫자로 입력하세요.');
    say('공식 경기 결과를 조회하는 중…');match=await backend.lookupGame(id);
    $('#ops-game-teams').innerHTML=`<p>게임 ${esc(match.gameId)} · ${esc(match.startDtm)} · ${match.teams.length}팀</p>`+match.teams.map((t,i)=>{
      const linked=t.members.map(m=>{const found=data.streamers.filter(s=>s.game_nickname===m.nickname);return found.length===1?found[0].team_id:null;});
      const suggested=linked.length&&linked.every(id=>id&&id===linked[0])?linked[0]:'';
      return `<article class="ops-backup-row"><span><strong>게임 팀 ${t.number} · ${t.rank}위 · ${t.kills}킬</strong><br>${t.members.map(m=>esc(m.nickname)+' ('+m.kills+'킬)').join(' · ')}</span><label>루나섬 팀 연결<select data-game-team="${i}"><option value="">팀을 선택하세요</option>${data.teams.map(team=>`<option value="${esc(team.id)}" ${suggested===team.id?'selected':''}>${esc(team.name)}</option>`).join('')}</select></label></article>`;
    }).join('');$('#ops-game-apply').hidden=false;say('게임 속 팀과 루나섬 팀 연결을 확인하세요.');
  });
  $('#ops-game-teams').onchange=()=>{sourceGameId=null;csv=null;clearPreview();$('#ops-mapping').hidden=true;};
  $('#ops-game-apply').onclick=()=>{try{
    if(!match)return;const selected=$$('[data-game-team]').map(s=>s.value);
    if(selected.some(x=>!x)||new Set(selected).size!==selected.length)throw Error('각 게임 팀을 서로 다른 루나섬 팀에 연결하세요.');
    csv=[['team','rank','kills'],...match.teams.map((t,i)=>[selected[i],String(t.rank),String(t.kills)])];sourceGameId=match.gameId;
    for(const [id,index] of [['name',0],['rank',1],['kills',2]]){$('#ops-col-'+id).innerHTML=csv[0].map((c,i)=>`<option value="${i}">${c}</option>`).join('');$('#ops-col-'+id).value=String(index);}
    $('#ops-mode').value='team';$('#ops-mapping').hidden=false;clearPreview();say('팀을 연결했습니다. 라운드와 순위 점수를 입력한 뒤 집계 미리보기를 누르세요.');
  }catch(e){say(e.message);}};
  $('#ops-mapping').addEventListener('change',clearPreview);
  $('#ops-file').onchange=()=>action(async()=>{
    clearMatch();const file=$('#ops-file').files[0];if(!file)return;
    if(file.size>5*1024*1024)throw Error('결과 파일은 5MB 이하로 선택하세요.');
    if(!/\.(csv|tsv)$/i.test(file.name))throw Error('CSV 또는 TSV 파일을 선택하세요. 게임 원본은 샘플 확인 후 연결합니다.');
    csv=parseCSV(await file.text());
    for(const id of ['name','rank','kills'])$('#ops-col-'+id).innerHTML=csv[0].map((c,i)=>`<option value="${i}">${esc(c)} (${i+1}열)</option>`).join('');
    for(const [id,rx,fallback] of [['name',/nickname|닉네임|team|팀|name/i,0],['rank',/rank|순위|placement/i,1],['kills',/kill|킬/i,2]]){const i=csv[0].findIndex(x=>rx.test(x));$('#ops-col-'+id).value=String(i<0?Math.min(fallback,csv[0].length-1):i);}
    $('#ops-mapping').hidden=false;say(`${file.name} · ${csv.length-1}행. 열과 점수 규칙을 확인하세요.`);
  });
  $('#ops-preview').onclick=()=>{try{
    clearPreview();if(dirty)throw Error('팀 편성을 먼저 저장해 주세요.');if(!csv)throw Error('결과 파일을 선택하세요.');
    preview=aggregate(csv,{name:Number($('#ops-col-name').value),rank:Number($('#ops-col-rank').value),kills:Number($('#ops-col-kills').value)},$('#ops-mode').value,data.streamers,data.teams,Number($('#ops-round').value),Object.fromEntries($$('[data-placement]').map(e=>[e.dataset.placement,e.value])),$('#ops-kill-point').value===''?NaN:Number($('#ops-kill-point').value));
    if(sourceGameId){if(data.scores.some(s=>s.sourceGameId===sourceGameId&&s.round!==preview[0].round))throw Error('이 게임은 이미 다른 라운드에 집계되어 있습니다. 기존 점수를 확인하세요.');preview=preview.map(r=>({...r,sourceGameId}));}
    $('#ops-import-preview').innerHTML=`${sourceGameId?'<p>게임 ID '+esc(sourceGameId)+'</p>':''}<div class="table-wrap"><table><thead><tr><th>라운드</th><th>팀</th><th>순위</th><th>킬</th><th>점수</th><th>처리</th></tr></thead><tbody>${preview.map(r=>`<tr><td>${r.round}R</td><td>${esc(data.teams.find(t=>t.id===r.teamId)?.name)}</td><td>${r.placement}</td><td>${r.kills}</td><td>${r.points}</td><td>${data.scores.some(s=>s.round===r.round&&s.teamId===r.teamId)?'기존 점수 교체':'새 점수'}</td></tr>`).join('')}</tbody></table></div>`;
    $('#ops-import-save').hidden=false;say('집계 미리보기입니다. 저장할 팀과 점수를 확인하세요.');
  }catch(e){preview=null;say(e.message);}};
  $('#ops-import-save').onclick=()=>action(async()=>{if(!preview)return;if(!confirm('미리보기의 결과를 저장할까요? 동일 라운드·팀 점수는 교체되며 변경 전 상태는 자동 백업됩니다.'))return;await backend.ops('import',{scores:preview},revision);await load();await refresh();say('결과를 집계해 저장했습니다.');});
  $('#ops-backup').onclick=()=>action(async()=>{if(dirty)throw Error('편성을 먼저 저장해 주세요.');const result=await backend.ops('backup',{},revision);download(result.data,'luna-backup-'+result.id+'.json');await load();say('서버에 백업했습니다. JSON 내려받기도 시작했습니다.');});
  $('#ops-backups').onclick=e=>action(async()=>{const down=e.target.closest('[data-download]'),restore=e.target.closest('[data-restore]');if(down){download(await backend.ops('download',{id:down.dataset.download}),'luna-backup-'+down.dataset.download+'.json');say('백업 파일 내려받기를 시작했습니다.');}if(restore){if(!confirm('이 백업 시점으로 전체 기록·명단·편성을 복원할까요? 현재 상태는 자동 백업되어 되돌릴 수 있습니다.'))return;await backend.ops('restore',{id:restore.dataset.restore},revision);await load();await refresh();say('백업을 복원했습니다. 이전 상태도 자동 백업에 남아 있습니다.');}});
  $$('[data-tab]').forEach(b=>b.onclick=()=>{$$('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==b.dataset.tab);$$('[data-tab]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});
  function close(){if(busy)return;if(dirty&&!confirm('저장하지 않은 변경사항을 버리고 닫을까요?'))return;dirty=false;dialog.close();}
  $('#ops-close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  button.onclick=()=>{if(!backend.isAdmin)return;dialog.showModal();say('운영 정보를 불러오는 중…');action(async()=>{await load();say('저장된 출석·편성을 불러왔습니다.');});};
  return {auth};
}
