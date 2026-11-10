// Redefinição de senha de um acesso, feita pelo admin na tela Usuários.
//
// Mesmo motivo do admin-create-user: trocar a senha de outra pessoa exige a
// service_role key, que não pode ir pro navegador. A função confere que
// quem chamou é admin antes de qualquer coisa.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. quem está chamando?
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Não autenticado" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const token = authHeader.replace("Bearer ", "");
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller.user) return json({ error: "Sessão inválida" }, 401);

  // 2. só admin passa daqui
  const { data: callerRoles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", caller.user.id);

  if (!(callerRoles ?? []).some((r) => r.role === "admin")) {
    return json({ error: "Apenas administradores redefinem senhas" }, 403);
  }

  // 3. valida a entrada (mesma regra de senha do admin-create-user)
  let body: { user_id?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }

  const userId = (body.user_id ?? "").trim();
  const password = body.password ?? "";

  if (!UUID.test(userId)) return json({ error: "Usuário inválido" }, 400);
  if (password.length < 8) return json({ error: "A senha precisa ter ao menos 8 caracteres" }, 400);
  if (password.length > 72) return json({ error: "A senha pode ter no máximo 72 caracteres" }, 400);

  // 4. troca a senha
  const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password,
  });

  if (updateError) return json({ error: updateError.message }, 400);

  return json({ id: updated.user.id, email: updated.user.email });
});
