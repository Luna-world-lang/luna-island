const config = window.LUNA_SUPABASE;
let client;
export const backend = {
  isAdmin: false,
  ready: false,
  async init(onAuth) {
    if (!config?.publishableKey) throw new Error("관리자 로그인 연결 설정이 필요합니다.");
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    client = createClient(config.url, config.publishableKey);
    const verify = async () => {
      const { data, error } = await client.auth.getUser();
      this.isAdmin = !error && data.user?.id === config.adminUid;
      onAuth(this.isAdmin);
    };
    client.auth.onAuthStateChange(() => { setTimeout(() => verify().catch(() => { this.isAdmin = false; onAuth(false); }), 0); });
    await verify();
    this.ready = true;
  },
  async login(email, password) {
    if (!client) throw new Error("관리자 로그인 연결 설정이 필요합니다.");
    if (email.toLowerCase() !== "luna") throw new Error("관리자 아이디는 Luna입니다.");
    email = "luna-admin@example.com";
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error("관리자 비밀번호를 확인해 주세요.");
    const { data, error: userError } = await client.auth.getUser();
    if (userError || data.user?.id !== config.adminUid) {
      await client.auth.signOut();
      throw new Error("Luna 관리자 계정만 사용할 수 있습니다.");
    }
    this.isAdmin = true;
  },
  async logout() {
    this.isAdmin = false;
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw new Error("로그아웃에 실패했습니다. 다시 시도해 주세요.");
  },
  async read() {
    const [dashboard, directory, teamNames] = await Promise.all([
      client.from("luna_dashboard").select("scores,history,event_number,revision").eq("id", 1).single(),
      client.from("luna_streamers").select("id,name,team_id,game_nickname,profile_url,tier").order("created_at"),
      client.from("luna_teams").select("id,name")
    ]);
    if (dashboard.error || directory.error || teamNames.error) throw new Error("경기 기록과 명단을 불러오지 못했습니다.");
    const data = dashboard.data;
    return { scores: data.scores, history: data.history.filter(event => !event.deleted), trash: data.history.filter(event => event.deleted), eventNumber: data.event_number, revision: data.revision, streamers: directory.data, teams: teamNames.data };
  },
  async manageHistory(action, number, event, revision) {
    if (!this.isAdmin) throw new Error("관리자 로그인이 필요합니다.");
    const { error } = await client.rpc("luna_history_manage", { p_action: action, p_number: number, p_event: event, p_revision: revision });
    if (error) throw new Error(error.message.includes("revision_conflict") ? "다른 화면에서 기록이 변경되었습니다. 창을 닫고 다시 열어 주세요." : "저장하지 못했습니다. 순위 중복, 참가자 중복과 입력값을 확인해 주세요.");
  },
  async ops(action, payload = {}, revision = null) {
    if (!this.isAdmin) throw new Error("관리자 로그인이 필요합니다.");
    const {data,error} = await client.rpc("luna_admin_ops",{p_action:action,p_payload:payload,p_revision:revision});
    if(error) throw new Error(error.message.includes("revision_conflict") ? "다른 화면에서 기록이 변경되었습니다. 저장 상태를 다시 읽은 뒤 작업해 주세요." : error.message.includes("roster_changed") ? "등록 명단이 변경되었습니다. 저장 상태를 다시 읽어 주세요." : "처리하지 못했습니다. 입력값과 관리자 연결을 확인해 주세요.");
    return data;
  },
  async lookupGame(gameId) {
    if (!this.isAdmin) throw new Error("관리자 로그인이 필요합니다.");
    const {data,error}=await client.functions.invoke('luna-game',{body:{gameId}});
    if(error){
      let message='경기를 조회하지 못했습니다. 관리자 로그인과 서버 연결을 확인하세요.';
      try { const details=await error.context.json(); if(typeof details.error==='string')message=details.error; } catch {}
      throw new Error(message);
    }
    if(!data?.teams?.length)throw new Error('경기 결과가 없습니다.');
    return data;
  },
  async manageBackup(action, id = null) {
    if(!this.isAdmin) throw new Error('관리자 로그인이 필요합니다.');
    const {data,error}=await client.rpc('luna_backup_manage',{p_action:action,p_id:id});
    if(error)throw new Error('백업 목록이 변경되었거나 연결이 끊겼습니다. 목록을 새로고침해 주세요.');
    return data;
  },
  async renameTeams(names, revision) {
    if (!this.isAdmin) throw new Error("관리자 로그인이 필요합니다.");
    const { error } = await client.rpc("luna_rename_teams", { p_names: names, p_revision: revision });
    if (error) throw new Error(error.message.includes("revision_conflict") ? "다른 화면에서 기록이 변경되었습니다. 창을 닫았다가 다시 열어 주세요." : "팀 이름을 저장하지 못했습니다. 중복 이름과 관리자 권한을 확인해 주세요.");
  },
  async saveStreamer(id, name, teamId, profile = {}) {
    if (!this.isAdmin) throw new Error("관리자 로그인이 필요합니다.");
    const fields = { team_id: teamId || null, game_nickname: profile.gameNickname?.trim() || "", profile_url: profile.profileUrl?.trim() || "", tier: profile.tier || "" };
    const query = id ? client.from("luna_streamers").update(fields).eq("id", id)
      : client.from("luna_streamers").insert({ name: name.trim(), ...fields });
    const { error } = await query;
    if (error) throw new Error(error.code === "23505" ? "이미 등록된 이름입니다." : "등록을 저장하지 못했습니다. 관리자 권한과 연결을 확인해 주세요.");
  },
  async uploadProfile(file) {
    if (!this.isAdmin) throw new Error("관리자 로그인이 필요합니다.");
    const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
    if (!extensions[file?.type]) throw new Error("JPG, PNG, WEBP, GIF 이미지 파일을 선택해 주세요.");
    if (file.size > 5 * 1024 * 1024) throw new Error("이미지는 5MB 이하로 선택해 주세요.");
    const path = `${config.adminUid}/${crypto.randomUUID()}.${extensions[file.type]}`;
    const { error } = await client.storage.from("luna-profiles").upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error("이미지 업로드에 실패했습니다. 파일과 관리자 로그인을 확인해 주세요.");
    return client.storage.from("luna-profiles").getPublicUrl(path).data.publicUrl;
  },
  async deleteStreamer(id) {
    if (!this.isAdmin) throw new Error("관리자 로그인이 필요합니다.");
    const { error } = await client.from("luna_streamers").delete().eq("id", id);
    if (error) throw new Error("등록을 삭제하지 못했습니다. 다시 시도해 주세요.");
  },
  async mutate(action, payload, revision) {
    if (!this.isAdmin) throw new Error("관리자 로그인이 필요합니다.");
    const { data: user, error: userError } = await client.auth.getUser();
    if (userError || user.user?.id !== config.adminUid) { this.isAdmin = false; throw new Error("관리자 세션이 만료되었습니다. 다시 로그인해 주세요."); }
    const { error } = await client.rpc("luna_mutate", { p_action: action, p_payload: payload, p_revision: revision });
    if (error) {
      if (error.message.includes("revision_conflict")) throw new Error("다른 화면에서 기록이 변경되었습니다. 최신 기록을 확인한 뒤 다시 시도해 주세요.");
      throw new Error("변경을 저장하지 못했습니다. 관리자 권한과 연결을 확인해 주세요.");
    }
  }
};
