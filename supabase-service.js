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
    const [dashboard, directory] = await Promise.all([
      client.from("luna_dashboard").select("scores,history,event_number,revision").eq("id", 1).single(),
      client.from("luna_streamers").select("id,name,team_id").order("created_at")
    ]);
    if (dashboard.error || directory.error) throw new Error("경기 기록과 스트리머 명단을 불러오지 못했습니다.");
    const data = dashboard.data;
    return { scores: data.scores, history: data.history, eventNumber: data.event_number, revision: data.revision, streamers: directory.data };
  },
  async saveStreamer(id, name, teamId) {
    if (!this.isAdmin) throw new Error("관리자 로그인이 필요합니다.");
    const query = id ? client.from("luna_streamers").update({ team_id: teamId || null }).eq("id", id)
      : client.from("luna_streamers").insert({ name: name.trim(), team_id: teamId || null });
    const { error } = await query;
    if (error) throw new Error(error.code === "23505" ? "이미 등록된 이름입니다." : "등록을 저장하지 못했습니다. 관리자 권한과 연결을 확인해 주세요.");
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
