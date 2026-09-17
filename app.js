import { backend } from "./supabase-service.js?v=attendance-17";
import { initAdminOps } from "./admin-ops.js?v=attendance-17";
import { tierCost } from "./ops-core.js?v=backup-14";
(() => {
  "use strict";

  const STORAGE_KEY = "luna-island-dashboard-v2";
  const teams = [
    { id: "team-luna", name: "Team Luna", members: [] },
    { id: "team-stella", name: "Team Stella", members: [] },
    { id: "team-eclipse", name: "Team Eclipse", members: [] },
    { id: "team-nova", name: "Team Nova", members: [] },
    { id: "team-orbit", name: "Team Orbit", members: [] },
    { id: "team-comet", name: "Team Comet", members: [] },
    { id: "team-aurora", name: "Team Aurora", members: [] },
    { id: "team-meteor", name: "Team Meteor", members: [] }
  ];

  teams.forEach((team) => { team.members = []; });
  const defaultState = { scores: [], history: [], eventNumber: 1, streamers: [] };
  let state = loadState();
  let busy = false;
  let connected = false;
  let selectedPlayer = null;
  let editingStreamer = null;
  let editingEvent = null, historyRevision = null;
  let editingTeamsRevision = null;
  let teamOptionsSignature = "";
  let attendanceData = null;

  function attendanceControls(record) {
    if (!backend.isAdmin) return "";
    const status=attendanceData?.players?.find(p=>p.id===record.id)?.attendance || (record.team_id?'present':'pending');
    return `<div class="directory-attendance" role="group" aria-label="${escapeHtml(record.name)} 출석 상태"><span>출석 상태</span>${[['pending','미확인'],['present','출석'],['absent','결석']].map(([value,label])=>`<button type="button" data-attendance-id="${escapeHtml(record.id)}" data-attendance="${value}" aria-pressed="${status===value}" ${busy||!attendanceData?'disabled':''}>${label}</button>`).join('')}</div>`;
  }

  async function saveAttendance(id, status) {
    if(!backend.isAdmin||!connected||busy||!['pending','present','absent'].includes(status))return;
    const person=state.streamers.find(p=>p.id===id);if(!person)return;
    if(status!=='present'&&person.team_id&&!confirm(`${person.name} 님을 ${status==='absent'?'결석':'미확인'}으로 변경하면 현재 팀에서 제외됩니다. 변경할까요?`))return;
    busy=true;renderAuth();
    try {
      const ops=await backend.ops('read'), current=await backend.read();
      if(ops.revision!==current.revision)throw Error('다른 화면에서 변경되었습니다. 다시 시도하세요.');
      if(!current.streamers.some(p=>p.id===id))throw Error('명단에서 삭제된 스트리머입니다.');
      const players=current.streamers.map(p=>{
        const old=ops.data.players?.find(x=>x.id===p.id);
        const attendance=p.id===id?status:(old?.attendance||(p.team_id?'present':'pending'));
        return {id:p.id,tier:p.tier||'',cost:old?.cost??tierCost(p.tier),attendance,team:attendance==='present'?(p.team_id||''):''};
      });
      await backend.ops('save',{players,capacity:ops.data.capacity||3,teamCount:ops.data.teamCount||8},ops.revision);
      $('#directory-feedback').textContent=`${person.name} 님을 ${status==='present'?'출석':status==='absent'?'결석':'미확인'}으로 저장했습니다. 팀 편성에도 반영됩니다.`;
    } catch(error){$('#directory-feedback').textContent=error.message;}
    finally{busy=false;await refresh();}
  }

  function renderAuth() {
    opsUI.auth();
    const admin = backend.isAdmin;
    $$('[data-attendance-id]').forEach(el=>{el.hidden=!admin;el.disabled=!admin||!connected||busy||!attendanceData;});
    if(!admin)attendanceData=null;
    if (!admin && $("#history-dialog").open) $("#history-dialog").close();
    $$("[data-history-action], #history-form input, #history-form button[type=submit]").forEach(el => { el.disabled = !admin || !connected || busy; });
    $$("[data-edit-team-names]").forEach((button) => { button.hidden = !admin; button.disabled = !admin || !connected || busy; });
    $$("#team-names-form input, #team-names-form button[type=submit]").forEach((el) => { el.disabled = !admin || !connected || busy; });
    if (!admin && $("#team-names-dialog").open) $("#team-names-dialog").close();
    $("#register-streamer").hidden = !admin;
    $("#register-streamer").disabled = !admin || !connected || busy;
    $("#directory-manage-heading").hidden = !admin;
    $$("[data-edit-streamer], [data-remove-streamer], #registration-form input, #registration-form select, #registration-form button[type=submit]").forEach((el) => { el.disabled = !admin || !connected || busy; });
    if (!admin && $("#registration-dialog").open) $("#registration-dialog").close();
    $("#admin-login").hidden = admin;
    $("#admin-logout").hidden = !admin;
    $("#open-score-panel").hidden = !admin;
    $("#open-score-panel").disabled = !admin || !connected || busy;
    $$("#score-form input, #score-form select, #score-form button, #finalize-event, [data-delete-score]").forEach((el) => { el.disabled = !admin || !connected || busy; });
    if (!admin && $("#score-drawer").classList.contains("is-open")) closeDrawer();
  }

  async function refresh() {
    if (busy) return;
    try {
      state = await backend.read();
      attendanceData = backend.isAdmin ? (await backend.ops('read')).data : null;
      teams.forEach((team) => { team.name = state.teams.find((saved) => saved.id === team.id)?.name ?? team.name; });
      updateTeamOptions();
      teams.forEach((team) => { team.members = state.streamers.filter((streamer) => streamer.team_id === team.id).map((streamer) => streamer.name); });
      connected = true;
      persist();
      renderAll();
      $("#sync-label").textContent = "온라인 동기화 중";
    } catch (error) {
      connected = false;
      $("#sync-label").textContent = error.message;
    }
    renderAuth();
  }

  async function change(action, payload) {
    if (busy || !backend.isAdmin || !connected) return false;
    busy = true;
    renderAuth();
    let success = false;
    try {
      await backend.mutate(action, payload, state.revision);
      success = true;
    } catch (error) { $("#form-feedback").textContent = error.message; }
    finally { busy = false; await refresh(); }
    return success;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function updateTeamOptions() {
    const signature = JSON.stringify(teams.map((team) => [team.id, team.name]));
    if (signature === teamOptionsSignature) return;
    const options = teams.map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join("");
    for (const [selector, first] of [["#leaderboard-team", '<option value="">전체 팀</option>'], ["#score-team", ""]]) {
      const select = $(selector), previous = select.value;
      select.innerHTML = first + options;
      if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    }
    teamOptionsSignature = signature;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return saved && Array.isArray(saved.scores) && Array.isArray(saved.history)
        ? { ...defaultState, ...saved, streamers: [] }
        : structuredClone(defaultState);
    } catch {
      return structuredClone(defaultState);
    }
  }

  function persist() {
    const previous = localStorage.getItem(STORAGE_KEY);
    if (previous && !localStorage.getItem(`${STORAGE_KEY}-before-supabase`)) localStorage.setItem(`${STORAGE_KEY}-before-supabase`, previous);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function getStandings() {
    return teams.map((team) => {
      const entries = state.scores.filter((score) => score.teamId === team.id);
      const points = entries.reduce((sum, score) => sum + Number(score.points || 0), 0);
      const kills = entries.reduce((sum, score) => sum + Number(score.kills || 0), 0);
      const placementSum = entries.reduce((sum, score) => sum + Number(score.placement || 0), 0);
      return { ...team, points, kills, entries: entries.length, averagePlacement: entries.length ? placementSum / entries.length : null };
    }).sort((a, b) => b.points - a.points || b.kills - a.kills || (a.averagePlacement ?? 99) - (b.averagePlacement ?? 99) || a.name.localeCompare(b.name));
  }

  function getIndividualRecords() {
    const recordMap = new Map(state.streamers.map((streamer) => [streamer.name, { ...streamer, appearances: 0, wins: 0, topThree: 0, rankTotal: 0 }]));
    state.history.forEach((event) => {
      event.standings.forEach((teamResult) => {
        teamResult.members.forEach((name) => {
          if (!recordMap.has(name)) return;
          const record = recordMap.get(name);
          record.appearances += 1;
          record.wins += teamResult.rank === 1 ? 1 : 0;
          record.topThree += teamResult.rank <= 3 ? 1 : 0;
          record.rankTotal += teamResult.rank;
        });
      });
    });
    return [...recordMap.values()].map((record) => ({ ...record, averageRank: record.appearances ? record.rankTotal / record.appearances : null }));
  }

  function updateClock() {
    const now = new Date();
    const time = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now);
    const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(now);
    $("#current-time").textContent = time;
    $("#current-date").textContent = date;
  }

  function renderDashboard() {
    const standings = getStandings();
    const leaderPoints = standings[0]?.points ?? 0;
    const roundsEntered = new Set(state.scores.map((score) => score.round)).size;
    $("#round-status").textContent = `입력된 라운드 ${roundsEntered} / 4`;

    $("#top-three").innerHTML = standings.slice(0, 3).map((team, index) => `
      <article class="podium-card">
        <span class="podium-rank">${index + 1}</span>
        <h3>${escapeHtml(team.name)}</h3>
        <p>${team.members.map(escapeHtml).join(" · ")}</p>
        <div class="podium-score">${team.points}<small> 점</small></div>
      </article>`).join("");

    $("#live-ranking-body").innerHTML = standings.map((team, index) => {
      const gap = leaderPoints - team.points;
      return `<tr>
        <td class="rank-cell ${index < 3 ? "is-top" : ""}">${String(index + 1).padStart(2, "0")}</td>
        <td class="team-name">${escapeHtml(team.name)}</td>
        <td class="member-list">${team.members.map(escapeHtml).join(" · ")}</td>
        <td>${team.kills}</td>
        <td class="score-total">${team.points}점</td>
        <td class="score-gap ${index === 0 ? "leader" : ""}">${index === 0 ? "선두" : `-${gap}점`}</td>
      </tr>`;
    }).join("");

    renderSummaryStats();
  }

  function renderSummaryStats() {
    const active = getIndividualRecords().filter((record) => record.appearances > 0);
    if (!active.length) {
      $("#most-wins").textContent = "기록 없음";
      $("#most-wins-detail").textContent = "대회 결과 확정 후 집계";
      $("#most-appearances").textContent = "기록 없음";
      $("#most-appearances-detail").textContent = "대회 결과 확정 후 집계";
      $("#average-rank").textContent = "—";
      return;
    }
    const maxWins = Math.max(...active.map((record) => record.wins));
    const maxAppearances = Math.max(...active.map((record) => record.appearances));
    const winLeaders = active.filter((record) => record.wins === maxWins).map((record) => record.name);
    const appearanceLeaders = active.filter((record) => record.appearances === maxAppearances).map((record) => record.name);
    const rankTotal = active.reduce((sum, record) => sum + record.rankTotal, 0);
    const appearances = active.reduce((sum, record) => sum + record.appearances, 0);
    $("#most-wins").textContent = winLeaders.length > 2 ? `${winLeaders.slice(0, 2).join(", ")} 외` : winLeaders.join(", ");
    $("#most-wins-detail").textContent = `${maxWins}회 우승`;
    $("#most-appearances").textContent = appearanceLeaders.length > 2 ? `${appearanceLeaders.slice(0, 2).join(", ")} 외` : appearanceLeaders.join(", ");
    $("#most-appearances-detail").textContent = `${maxAppearances}회 출전`;
    $("#average-rank").textContent = `${(rankTotal / appearances).toFixed(2)}위`;
  }

  function renderRecords() {
    const championRoot = $("#champion-records");
    if (!state.history.length) {
      championRoot.innerHTML = $("#empty-state-template").innerHTML;
    } else {
      championRoot.innerHTML = [...state.history].reverse().map((event) => {
        const winner = event.standings[0];
        return `<article class="champion-card"><span class="champion-round">제 ${event.number}회 루나섬</span><h3>${escapeHtml(winner.name)}</h3><p>${winner.members.map(escapeHtml).join(" · ")}</p><strong>${winner.points}점 · ${winner.kills}킬</strong><small>${escapeHtml(event.date)}</small>${backend.isAdmin ? `<div class="history-actions"><button type="button" data-history-action="edit" data-number="${event.number}">기록 수정</button><button type="button" data-history-action="delete" data-number="${event.number}">기록 삭제</button></div>` : ""}</article>`;
      }).join("");
    }

    $("#history-trash").hidden = !backend.isAdmin;
    $("#history-trash-list").innerHTML = (state.trash || []).map(event => `<div class="history-trash-item">제 ${Number(event.number)}회 · ${escapeHtml(event.date)} <button type="button" data-history-action="restore" data-number="${Number(event.number)}">복구</button></div>`).join("") || "삭제한 기록이 없습니다.";
    const records = getIndividualRecords();
    const query = $("#player-search").value.trim().toLocaleLowerCase("ko");
    const filtered = records.filter((record) => record.name.toLocaleLowerCase("ko").includes(query));
    $("#personal-record-body").innerHTML = filtered.map((record) => `<tr><td class="team-name">${escapeHtml(record.name)}</td><td>${record.appearances}회</td><td>${record.wins}회</td><td>${record.topThree}회</td><td>${record.averageRank ? `${record.averageRank.toFixed(2)}위` : "—"}</td></tr>`).join("");

    renderLeaderboard(records);
    if (selectedPlayer !== null && $("#player-dialog").open) renderPlayerDetail();
  }

  function safeProfileUrl(value) {
    try { const url = new URL(value); return url.protocol === "https:" ? url.href : ""; } catch { return ""; }
  }

  function renderLeaderboard(records = getIndividualRecords()) {
    const normalize = (text) => String(text ?? "").normalize("NFKC").toLocaleLowerCase("ko").replace(/\s/g, "");
    const query = normalize($("#leaderboard-search").value), teamId = $("#leaderboard-team").value;
    const tierOrder = ["SSS", "SS", "S", "A", "B", "C", "D", "F", "닭", "나뭇가지", ""];
    const mode = $("#leaderboard-sort").value || "tier";
    const sorted = [...records].sort((a,b) => mode === "name" ? a.name.localeCompare(b.name, "ko") : mode === "records" ? b.wins-a.wins || b.topThree-a.topThree || (a.averageRank ?? 99)-(b.averageRank ?? 99) || a.name.localeCompare(b.name, "ko") : tierOrder.indexOf(a.tier || "")-tierOrder.indexOf(b.tier || "") || a.name.localeCompare(b.name, "ko"));
    const filtered = sorted.map(record => ({...record, team: teams.find(team => team.id === record.team_id)})).filter(record => (normalize(record.name).includes(query) || normalize(record.game_nickname).includes(query)) && (!teamId || record.team?.id === teamId));
    $("#leaderboard-count").textContent = `${filtered.length}명 / 전체 ${records.length}명`;
    const card = record => {
      const profile = safeProfileUrl(record.profile_url);
      const image = profile ? `<img class="streamer-avatar" src="${escapeHtml(profile)}" alt="${escapeHtml(record.name)} 프로필" loading="lazy" referrerpolicy="no-referrer">` : "";
      return `<article class="streamer-card" data-tier="${escapeHtml(record.tier || "")}"><div class="streamer-profile"><span class="avatar-fallback" aria-hidden="true">${escapeHtml([...record.name][0] || "☾")} </span>${image}</div><div class="streamer-info"><div class="streamer-title"><h2>${escapeHtml(record.name)}</h2>${record.tier ? `<span class="tier-badge">${escapeHtml(record.tier)}</span>` : ""}</div><p class="game-nickname">${escapeHtml(record.game_nickname || "닉네임 미등록")}</p></div><div class="streamer-card-actions">${record.game_nickname ? `<a class="record-search" href="https://dak.gg/er/players/${encodeURIComponent(record.game_nickname)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(record.name)} 게임 전적 검색">전적 검색 ↗</a>` : '<span class="record-unavailable">닉네임 등록 후 전적 검색</span>'}</div>${attendanceControls(record)}${backend.isAdmin ? `<div class="directory-actions"><button type="button" data-edit-streamer="${escapeHtml(record.id)}">프로필 수정</button><button type="button" data-remove-streamer="${escapeHtml(record.id)}">삭제</button></div>` : ""}</article>`;
    };
    const group = (label, members) => members.length ? `<h2 class="streamer-divider">${escapeHtml(label)} · ${members.length}명</h2>${members.map(card).join("")}` : "";
    $("#streamer-leaderboard-body").innerHTML = !filtered.length ? `<div class="streamer-empty">${records.length ? "검색 결과가 없습니다. 스트리머 이름이나 게임 닉네임을 확인해 주세요." : backend.isAdmin ? "등록된 스트리머가 없습니다. 스트리머 등록 버튼으로 명단을 추가해 주세요." : "아직 등록된 스트리머가 없습니다."}</div>`
      : $("#leaderboard-group").checked ? [...teams, {id:"",name:"미배정"}].map(team => group(team.name, filtered.filter(record => (record.team?.id ?? "") === team.id))).join("")
      : mode === "tier" ? tierOrder.map(tier => group(tier ? tier + " TIER" : "티어 미등록", filtered.filter(record => (record.tier || "") === tier))).join("") : filtered.map(card).join("");
    $$(".streamer-avatar").forEach(image => image.addEventListener("error", () => { image.hidden = true; }));
  }

  function renderPlayerDetail() {
    const record = getIndividualRecords().find((record) => record.name === selectedPlayer);
    if (!record) { $("#player-dialog").close(); return; }
    $("#player-title").textContent = `${record.name} 전적`;
    const current = getStandings().find((team) => team.members.includes(record.name));
    const matches = [...state.history].reverse().flatMap((event) => event.standings.filter((team) => team.members.includes(record.name)).map((team) => ({ event, team })));
    $("#player-detail").innerHTML = `<p class="drawer-help">${escapeHtml(current?.name ?? "현재 팀 미배정")}</p>
      <div class="player-stats"><div><span>출전</span><strong>${record.appearances}회</strong></div><div><span>우승</span><strong>${record.wins}회</strong></div><div><span>TOP 3</span><strong>${record.topThree}회</strong></div><div><span>평균 순위</span><strong>${record.averageRank !== null ? `${record.averageRank.toFixed(2)}위` : "—"}</strong></div></div>
      <h3>현재 경기 · 제 ${state.eventNumber}회</h3><p class="drawer-help">${current ? `${current.entries}개 라운드 입력 · 팀 ${current.points}점 · 팀 ${current.kills}킬` : "현재 팀에 배정되지 않았습니다."}</p>
      <h3>대회별 전적</h3>${matches.length ? `<div class="table-wrap"><table><thead><tr><th>대회</th><th>날짜</th><th>참가 팀</th><th>최종 순위</th><th>팀 점수</th><th>팀 킬</th></tr></thead><tbody>${matches.map(({ event, team }) => `<tr><td>제 ${Number(event.number)}회</td><td>${escapeHtml(event.date)}</td><td>${escapeHtml(team.name)}</td><td>${Number(team.rank)}위</td><td>${Number(team.points)}점</td><td>${Number(team.kills)}킬</td></tr>`).join("")}</tbody></table></div>` : `<p class="drawer-help">아직 확정된 대회 전적이 없습니다.</p>`}`;
  }

  function renderScorePanel() {
    $("#score-count").textContent = `${state.scores.length}건`;
    const sorted = [...state.scores].sort((a, b) => b.round - a.round || a.placement - b.placement);
    $("#score-log").innerHTML = sorted.length ? sorted.map((score) => {
      const team = teams.find((item) => item.id === score.teamId);
      return `<div class="score-log-item"><div><strong>${score.round}R · ${escapeHtml(team?.name || score.teamId)}</strong><small>${score.placement}위 · ${score.kills}킬 · ${score.points}점</small></div>${backend.isAdmin ? `<button type="button" data-delete-score="${score.round}:${score.teamId}" aria-label="점수 삭제">삭제</button>` : ""}</div>`;
    }).join("") : `<p class="drawer-help">아직 입력된 점수가 없습니다.</p>`;
  }

  function renderAll() {
    renderDashboard();
    renderRecords();
    renderScorePanel();
    renderAuth();
  }

  function showPage(page) {
    const standalone = location.pathname.endsWith("/streamers.html");
    if (page === "leaderboard" && !standalone) { location.href = "streamers.html"; return; }
    if (standalone && page !== "leaderboard") { location.href = `index.html#${page}`; return; }
    $$(".page").forEach((section) => section.classList.toggle("is-visible", section.dataset.view === page));
    $$(".nav-link").forEach((button) => button.classList.toggle("is-active", button.dataset.page === page));
    history.replaceState(null, "", `#${page}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openDrawer() {
    if (!backend.isAdmin || !connected || busy) return;
    $("#drawer-backdrop").hidden = false;
    $("#score-drawer").classList.add("is-open");
    $("#score-drawer").setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setTimeout(() => $("#score-round").focus(), 50);
  }

  function closeDrawer() {
    $("#score-drawer").classList.remove("is-open");
    $("#score-drawer").setAttribute("aria-hidden", "true");
    $("#drawer-backdrop").hidden = true;
    document.body.style.overflow = "";
    $("#open-score-panel").focus();
  }

  async function saveScore(event) {
    event.preventDefault();
    const entry = {
      round: Number($("#score-round").value),
      teamId: $("#score-team").value,
      placement: Number($("#score-placement").value),
      kills: Number($("#score-kills").value),
      points: Number($("#score-points").value),
      updatedAt: new Date().toISOString()
    };
    if (!await change("save", entry)) return;
    $("#form-feedback").textContent = `${teams.find((team) => team.id === entry.teamId)?.name} ${entry.round}라운드 점수를 저장했습니다.`;
    window.setTimeout(() => { $("#form-feedback").textContent = ""; }, 2600);
  }

  async function deleteScore(key) {
    const [round, teamId] = key.split(":");
    await change("delete", { round: Number(round), teamId });
  }

  async function finalizeEvent() {
    if (!state.scores.length) {
      $("#form-feedback").textContent = "먼저 경기 점수를 입력해 주세요.";
      return;
    }
    if (!confirm("현재 결과를 확정하고 다음 대회를 시작할까요?")) return;
    if (!await change("finalize", {})) return;
    closeDrawer();
    showPage("champions");
  }

  function init() {
    $("#close-history").addEventListener("click", () => $("#history-dialog").close());
    $("#page-champions").addEventListener("click", async event => {
      const button = event.target.closest("[data-history-action]");
      if (!button || !backend.isAdmin || !connected || busy) return;
      const number = Number(button.dataset.number), action = button.dataset.historyAction;
      const record = [...state.history, ...(state.trash || [])].find(item => item.number === number);
      if (!record) return;
      if (action === "edit") {
        editingEvent = structuredClone(record); historyRevision = state.revision;
        $("#history-title").textContent = '제 ' + number + '회 기록 수정';
        $("#history-date").value = record.date;
        $("#history-fields").innerHTML = record.standings.map((team,i) => `<fieldset data-history-row="${i}"><legend>${escapeHtml(team.name)}</legend><label>팀 이름<input data-field="name" value="${escapeHtml(team.name)}" maxlength="40" required></label><label>참가자 (쉼표로 구분)<input data-field="members" value="${escapeHtml(team.members.join(', '))}"></label><div class="form-row three"><label>최종 순위<input data-field="rank" type="number" min="1" max="${record.standings.length}" value="${team.rank}" required></label><label>팀 점수<input data-field="points" type="number" min="0" max="999999" value="${team.points}" required></label><label>팀 킬<input data-field="kills" type="number" min="0" max="999999" value="${team.kills}" required></label></div></fieldset>`).join("");
        $("#history-form-feedback").textContent = ""; $("#history-dialog").showModal(); return;
      }
      if (action === "delete" && !confirm('제 ' + number + '회 기록을 삭제할까요? 우승·개인 기록 집계에서 제외되며 삭제한 기록에서 복구할 수 있습니다.')) return;
      busy = true; renderAuth();
      try { await backend.manageHistory(action,number,{},state.revision); $("#history-feedback").textContent = action === 'restore' ? '기록을 복구했습니다.' : '기록을 삭제했습니다. 아래에서 복구할 수 있습니다.'; }
      catch(error) { $("#history-feedback").textContent = error.message; }
      finally { busy = false; await refresh(); }
    });
    $("#history-form").addEventListener("submit", async event => {
      event.preventDefault(); if (!backend.isAdmin || !connected || busy || !editingEvent) return;
      const standings = $$("[data-history-row]").map(row => { const old = editingEvent.standings[Number(row.dataset.historyRow)]; return {id:old.id,name:$("[data-field=name]",row).value.trim(),members:$("[data-field=members]",row).value.split(',').map(x=>x.trim()).filter(Boolean),rank:Number($("[data-field=rank]",row).value),points:Number($("[data-field=points]",row).value),kills:Number($("[data-field=kills]",row).value)}; });
      if(new Set(standings.map(x=>x.rank)).size !== standings.length) { $("#history-form-feedback").textContent = '순위를 중복 없이 입력해 주세요.'; return; }
      busy = true; renderAuth();
      try { await backend.manageHistory('edit',editingEvent.number,{date:$("#history-date").value.trim(),standings},historyRevision); $("#history-dialog").close(); $("#history-feedback").textContent = '수정한 순위와 참가자로 우승·개인 기록 집계를 갱신했습니다.'; }
      catch(error) { $("#history-form-feedback").textContent = error.message; }
      finally { busy = false; await refresh(); }
    });
    $$("[data-edit-team-names]").forEach((button) => button.addEventListener("click", () => {
      if (!backend.isAdmin || !connected || busy) return;
      editingTeamsRevision = state.revision;
      $("#team-names-fields").innerHTML = teams.map((team, index) => `<label>${index + 1}번 팀<input type="text" data-team-name="${team.id}" value="${escapeHtml(team.name)}" maxlength="40" required></label>`).join("");
      $("#team-names-feedback").textContent = "";
      $("#team-names-dialog").showModal();
    }));
    $("#close-team-names").addEventListener("click", () => $("#team-names-dialog").close());
    $("#team-names-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!backend.isAdmin || !connected || busy) return;
      const names = $$("[data-team-name]").map((input) => ({ id: input.dataset.teamName, name: input.value.trim() }));
      if (names.some((team) => !team.name) || new Set(names.map((team) => team.name.toLocaleLowerCase("ko"))).size !== teams.length) { $("#team-names-feedback").textContent = "팀 이름은 비워 두거나 중복해서 사용할 수 없습니다."; return; }
      busy = true; renderAuth();
      try { await backend.renameTeams(names, editingTeamsRevision); $("#team-names-dialog").close(); $("#directory-feedback").textContent = "전체 팀 이름을 저장했습니다."; }
      catch (error) { $("#team-names-feedback").textContent = error.message; }
      finally { busy = false; await refresh(); }
    });
    const openRegistration = (id = null) => {
      if (!backend.isAdmin || !connected || busy) return;
      const streamer = state.streamers.find((streamer) => streamer.id === id);
      editingStreamer = streamer?.id ?? null;
      $("#registration-title").textContent = streamer ? "스트리머 프로필 수정" : "스트리머 등록";
      $("#registration-name").value = streamer?.name ?? "";
      $("#registration-name").readOnly = !!streamer;
      $("#registration-nickname").value = streamer?.game_nickname ?? "";
      $("#registration-profile").value = "";
      $("#registration-preview").src = safeProfileUrl(streamer?.profile_url) || "";
      $("#registration-preview").hidden = !safeProfileUrl(streamer?.profile_url);
      $("#registration-tier").value = streamer?.tier ?? "";
      $("#registration-feedback").textContent = "";
      $("#registration-dialog").showModal();
    };
    $("#register-streamer").addEventListener("click", () => openRegistration());
    let previewUrl;
    $("#registration-profile").addEventListener("change", () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const file = $("#registration-profile").files[0];
      previewUrl = file ? URL.createObjectURL(file) : null;
      $("#registration-preview").src = previewUrl || safeProfileUrl(state.streamers.find(s => s.id === editingStreamer)?.profile_url) || "";
      $("#registration-preview").hidden = !$("#registration-preview").getAttribute("src");
    });
    $("#registration-dialog").addEventListener("close", () => { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; $("#registration-profile").value = ""; });
    $("#close-registration").addEventListener("click", () => $("#registration-dialog").close());
    $("#registration-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = $("#registration-name").value.trim();
      if (!name) { $("#registration-feedback").textContent = "스트리머 이름을 입력해 주세요."; return; }
      if (!backend.isAdmin || !connected || busy) return;
      busy = true; renderAuth();
      try {
        const existing = state.streamers.find(s => s.id === editingStreamer);
        const file = $("#registration-profile").files[0];
        $("#registration-feedback").textContent = file ? "이미지 업로드 중…" : "저장 중…";
        const profileUrl = file ? await backend.uploadProfile(file) : existing?.profile_url || "";
        await backend.saveStreamer(editingStreamer, name, existing?.team_id || null, {gameNickname: $("#registration-nickname").value, profileUrl, tier: $("#registration-tier").value});
        $("#registration-dialog").close();
        $("#directory-feedback").textContent = `${name} 명단을 저장했습니다.`;
      } catch (error) { $("#registration-feedback").textContent = error.message; }
      finally { busy = false; await refresh(); }
    });
    $("#streamer-leaderboard-body").addEventListener("click", async (event) => {
      const attendance=event.target.closest('[data-attendance-id]');
      if(attendance){await saveAttendance(attendance.dataset.attendanceId,attendance.dataset.attendance);return;}
      const edit = event.target.closest("[data-edit-streamer]");
      if (edit) { openRegistration(edit.dataset.editStreamer); return; }
      const remove = event.target.closest("[data-remove-streamer]");
      if (!remove || !backend.isAdmin || !connected || busy) return;
      const streamer = state.streamers.find((streamer) => streamer.id === remove.dataset.removeStreamer);
      if (!streamer || !confirm(`${streamer.name} 님을 등록 명단에서 삭제할까요? 대회 기록은 보관됩니다.`)) return;
      busy = true; renderAuth();
      try { await backend.deleteStreamer(streamer.id); $("#directory-feedback").textContent = `${streamer.name} 님을 명단에서 삭제했습니다.`; }
      catch (error) { $("#directory-feedback").textContent = error.message; }
      finally { busy = false; await refresh(); }
    });
    $("#leaderboard-team").insertAdjacentHTML("beforeend", teams.map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join(""));
    $("#leaderboard-search").addEventListener("input", () => renderLeaderboard());
    $("#leaderboard-team").addEventListener("change", () => renderLeaderboard());
    $("#leaderboard-sort").addEventListener("change", () => renderLeaderboard());
    $$("[data-directory-sort]").forEach(button => button.addEventListener("click", () => { $("#leaderboard-sort").value = button.dataset.directorySort; $$("[data-directory-sort]").forEach(item => item.setAttribute("aria-pressed", String(item === button))); renderLeaderboard(); }));
    $("#leaderboard-group").addEventListener("change", () => renderLeaderboard());
    $("#streamer-leaderboard-body").addEventListener("click", (event) => {
      const button = event.target.closest("[data-player]");
      if (!button) return;
      selectedPlayer = button.dataset.player;
      renderPlayerDetail();
      $("#player-dialog").showModal();
    });
    $("#close-player").addEventListener("click", () => $("#player-dialog").close());
    $("#player-dialog").addEventListener("close", () => { selectedPlayer = null; });
    $("#score-team").innerHTML = teams.map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join("");
    $$(".nav-link").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
    $("[data-page-link]").addEventListener("click", (event) => { event.preventDefault(); showPage("dashboard"); });
    $("#open-score-panel").addEventListener("click", openDrawer);
    $("#close-score-panel").addEventListener("click", closeDrawer);
    $("#drawer-backdrop").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && $("#score-drawer").classList.contains("is-open")) closeDrawer(); });
    $("#score-form").addEventListener("submit", saveScore);
    $("#score-log").addEventListener("click", (event) => { const button = event.target.closest("[data-delete-score]"); if (button) deleteScore(button.dataset.deleteScore); });
    $("#finalize-event").addEventListener("click", finalizeEvent);
    $("#player-search").addEventListener("input", renderRecords);
    $("#admin-login").addEventListener("click", () => $("#login-dialog").showModal());
    $("#close-login").addEventListener("click", () => $("#login-dialog").close());
    $("#login-dialog").addEventListener("close", () => { $("#login-password").value = ""; $("#login-feedback").textContent = ""; });
    $("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("#login-form button[type=submit]");
      button.disabled = true;
      $("#login-feedback").textContent = "로그인 확인 중…";
      try {
        await backend.login($("#login-email").value.trim(), $("#login-password").value);
        await refresh();
        renderAuth();
        $("#login-dialog").close();
      } catch (error) { $("#login-feedback").textContent = error.message; }
      finally { $("#login-password").value = ""; button.disabled = false; }
    });
    $("#admin-logout").addEventListener("click", async () => {
      backend.isAdmin = false;
      renderAuth();
      try { await backend.logout(); } catch (error) { $("#sync-label").textContent = error.message; }
      renderAll();
    });
    updateClock();
    setInterval(updateClock, 1000);
    renderAll();
    const initialPage = location.pathname.endsWith("/streamers.html") ? "leaderboard" : location.hash.slice(1);
    if (["dashboard", "champions", "personal", "leaderboard"].includes(initialPage)) showPage(initialPage);
    backend.init(() => { renderAll(); }).then(async () => {
      await refresh();
      setInterval(refresh, 5000);
      window.addEventListener("focus", refresh);
    }).catch((error) => { $("#sync-label").textContent = error.message; renderAuth(); });
  }

  const opsUI = initAdminOps(backend, refresh);
  init();
})();

