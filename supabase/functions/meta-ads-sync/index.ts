// Puxa gasto e resultados das campanhas do Meta.
//
// Duas coisas que definem o desenho:
//
// 1. Os números do Meta mudam depois. A janela de atribuição faz o gasto
//    de ontem ser diferente amanhã, e conversas continuam entrando por
//    dias. Por isso a função repuxa uma janela móvel e sobrescreve, em
//    vez de gravar uma vez e nunca mais olhar.
//
// 2. O token nunca sai do servidor. Ele vive em integration_settings,
//    tabela sem política de SELECT: só quem tem service role alcança.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const GRAPH = "https://graph.facebook.com/v21.0";
const DEFAULT_WINDOW = 7;

// métrica que interessa em campanha de clique-para-mensagem
const CONVERSATION_ACTIONS = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.total_messaging_connection",
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

type Action = { action_type: string; value: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // quem chamou precisa ser da equipe. o agendamento usa a service role,
  // que não traz Authorization — nesse caso segue direto.
  const auth = req.headers.get("Authorization") ?? "";
  const isCron = req.headers.get("x-scheduled") === "true";

  if (!isCron) {
    if (!auth) return json({ error: "Não autenticado" }, 401);
    const { data: caller } = await admin.auth.getUser(auth.replace("Bearer ", ""));
    if (!caller.user) return json({ error: "Sessão inválida" }, 401);
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.user.id);
    const ok = (roles ?? []).some((r) =>
      ["admin", "vendedor", "attendant", "stockist"].includes(r.role),
    );
    if (!ok) return json({ error: "Sem permissão" }, 403);
  }

  const { data: settings } = await admin
    .from("integration_settings")
    .select("ad_account_id, access_token")
    .eq("id", "meta_ads")
    .maybeSingle();

  if (!settings?.access_token || !settings?.ad_account_id) {
    return json({ error: "Configure o token e a conta de anúncios primeiro" }, 400);
  }

  let days = DEFAULT_WINDOW;
  try {
    const body = await req.json();
    if (typeof body?.days === "number" && body.days > 0 && body.days <= 90) days = body.days;
  } catch {
    // sem corpo: usa a janela padrão
  }

  const until = new Date();
  const since = new Date(until.getTime() - days * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const account = settings.ad_account_id.startsWith("act_")
    ? settings.ad_account_id
    : `act_${settings.ad_account_id}`;

  const params = new URLSearchParams({
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }),
    fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,actions",
    limit: "500",
    access_token: settings.access_token,
  });

  let url = `${GRAPH}/${account}/insights?${params}`;
  const campaigns = new Map<string, string>();
  const rows: Record<string, unknown>[] = [];

  // a resposta vem paginada; segue enquanto houver próxima página
  while (url) {
    const res = await fetch(url);
    const payload = await res.json();

    if (!res.ok) {
      const msg = payload?.error?.message ?? "Falha ao consultar o Meta";
      return json({ error: msg }, 400);
    }

    for (const row of payload.data ?? []) {
      const actions: Action[] = row.actions ?? [];
      const conversations = actions
        .filter((a) => CONVERSATION_ACTIONS.includes(a.action_type))
        .reduce((s, a) => Math.max(s, Number(a.value) || 0), 0);

      campaigns.set(row.campaign_id, row.campaign_name);
      rows.push({
        campaign_id: row.campaign_id,
        date: row.date_start,
        spend: Number(row.spend) || 0,
        impressions: Number(row.impressions) || 0,
        reach: Number(row.reach) || 0,
        clicks: Number(row.clicks) || 0,
        conversations,
        synced_at: new Date().toISOString(),
      });
    }

    url = payload.paging?.next ?? "";
  }

  if (campaigns.size > 0) {
    await admin.from("ad_campaigns").upsert(
      [...campaigns].map(([id, name]) => ({ id, name, synced_at: new Date().toISOString() })),
      { onConflict: "id" },
    );
  }

  if (rows.length > 0) {
    const { error } = await admin
      .from("ad_insights")
      .upsert(rows, { onConflict: "campaign_id,date" });
    if (error) return json({ error: error.message }, 500);
  }

  return json({
    campaigns: campaigns.size,
    days: rows.length,
    from: fmt(since),
    to: fmt(until),
  });
});
