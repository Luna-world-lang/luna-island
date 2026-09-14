import { backend } from "./supabase-service.js";
(() => {
  "use strict";

  const STORAGE_KEY = "luna-island-dashboard-v2";
  const teams = [
    { id: "team-luna", name: "Team Luna", members: ["김망범", "슈에 shue", "로다 Roda"] },
    { id: "team-stella", name: "Team Stella", members: ["Shmpyo", "레로서리", "티 엘"] },
    { id: "team-eclipse", name: "Team Eclipse", members: ["설음동", "겜작새", "고돌조"] },
    { id: "team-nova", name: "Team Nova", members: ["달문양", "달봄토링", "춤을추는카밀로"] },
    { id: "team-orbit", name: "Team Orbit", members: ["은시오", "레코이rekoi", "극향"] },
    { id: "team-comet", name: "Team Comet", members: ["치요띠띠", "츠키시로 우타하", "갱이리99"] },
    { id: "team-aurora", name: "Team Aurora", members: ["유혀누__", "BASUTO", "범린"] },
    { id: "team-meteor", name: "Team Meteor", members: ["솔프", "수앱", "뫄 펠"] }
  ];

  const defaultState = { scores: [], history: [], eventNumber: 1 };
  let state = loadState();
  let busy = false;
  let connected = false;

  function renderAuth() {
    const admin = backend.isAdmin;
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

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return saved && Array.isArray(saved.scores) && Array.isArray(saved.history)
        ? { ...defaultState, ...saved }
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
    const recordMap = new Map(teams.flatMap((team) => team.members.map((name) => [name, { name, appearances: 0, wins: 0, topThree: 0, rankTotal: 0 }])));
    state.history.forEach((event) => {
      event.standings.forEach((teamResult) => {
        teamResult.members.forEach((name) => {
          if (!recordMap.has(name)) recordMap.set(name, { name, appearances: 0, wins: 0, topThree: 0, rankTotal: 0 });
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
        return `<article class="champion-card"><span class="champion-round">제 ${event.number}회 루나섬</span><h3>${escapeHtml(winner.name)}</h3><p>${winner.members.map(escapeHtml).join(" · ")}</p><strong>${winner.points}점 · ${winner.kills}킬</strong><small>${escapeHtml(event.date)}</small></article>`;
      }).join("");
    }

    const records = getIndividualRecords();
    const query = $("#player-search").value.trim().toLocaleLowerCase("ko");
    const filtered = records.filter((record) => record.name.toLocaleLowerCase("ko").includes(query));
    $("#personal-record-body").innerHTML = filtered.map((record) => `<tr><td class="team-name">${escapeHtml(record.name)}</td><td>${record.appearances}회</td><td>${record.wins}회</td><td>${record.topThree}회</td><td>${record.averageRank ? `${record.averageRank.toFixed(2)}위` : "—"}</td></tr>`).join("");

    const ranked = records.filter((record) => record.appearances > 0).sort((a, b) => b.wins - a.wins || b.topThree - a.topThree || a.averageRank - b.averageRank || b.appearances - a.appearances || a.name.localeCompare(b.name));
    $("#streamer-leaderboard-body").innerHTML = ranked.length
      ? ranked.map((record, index) => `<tr><td class="rank-cell ${index < 3 ? "is-top" : ""}">${String(index + 1).padStart(2, "0")}</td><td class="team-name">${escapeHtml(record.name)}</td><td>${record.wins}회</td><td>${record.topThree}회</td><td>${record.appearances}회</td><td>${record.averageRank.toFixed(2)}위</td></tr>`).join("")
      : `<tr><td colspan="6">확정된 대회 기록이 없습니다.</td></tr>`;
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
    const initialPage = location.hash.slice(1);
    if (["dashboard", "champions", "personal", "leaderboard"].includes(initialPage)) showPage(initialPage);
    backend.init(() => { renderAll(); }).then(async () => {
      await refresh();
      setInterval(refresh, 5000);
      window.addEventListener("focus", refresh);
    }).catch((error) => { $("#sync-label").textContent = error.message; renderAuth(); });
  }

  init();
})();
