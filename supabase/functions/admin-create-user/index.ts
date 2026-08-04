// Criação de usuário do sistema.
//
// Isto não pode viver no navegador: criar conta exige a service_role key,
// que ignora todo o RLS. Se ela for pro front, qualquer visitante abre o
// DevTools e tem o banco inteiro. Aqui ela fica no servidor, e o Supabase
// injeta a variável sozinho — ninguém precisa colar chave em lugar nenhum.
//
// A função confere que quem chamou é admin antes de qualquer coisa.

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

const ROLES = ["admin", "vendedor", "stockist", "courier"] as const;
type Role = (typeof ROLES)[number];

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
    return json({ error: "Apenas administradores criam acessos" }, 403);
  }

  // 3. valida a entrada
  let body: { email?: string; password?: string; full_name?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const fullName = (body.full_name ?? "").trim();
  const role = body.role as Role;

  if (!email.includes("@")) return json({ error: "E-mail inválido" }, 400);
  if (password.length < 8) return json({ error: "A senha precisa ter ao menos 8 caracteres" }, 400);
  if (!fullName) return json({ error: "Informe o nome" }, 400);
  if (!ROLES.includes(role)) return json({ error: "Papel inválido" }, 400);

  // 4. cria a conta já confirmada: quem cria é o admin, não há e-mail a validar
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nome: fullName, full_name: fullName },
  });

  if (createError) {
    return json({ error: createError.message }, 400);
  }

  const userId = created.user.id;

  // o trigger on_auth_user_created já cria o profile; garante o nome
  await admin.from("profiles").update({ full_name: fullName, email }).eq("id", userId);

  const { error: roleError } = await admin
    .from("user_roles")
    .insert({ user_id: userId, role });

  if (roleError) {
    // conta sem papel não enxerga nada — não deixa esse estado de pé
    await admin.auth.admin.deleteUser(userId);
    return json({ error: `Não foi possível atribuir o papel: ${roleError.message}` }, 400);
  }

  return json({ id: userId, email, full_name: fullName, role });
});
