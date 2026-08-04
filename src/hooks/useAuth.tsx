import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

import type { Database } from "@/integrations/supabase/types";

type Role = Database["public"]["Enums"]["app_role"];

const STAFF_ROLES: Role[] = ["admin", "vendedor", "attendant", "stockist"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  vendedor: "Vendedor",
  attendant: "Atendente",
  stockist: "Estoque",
  courier: "Entregador",
};

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  roles: Role[];
  role: Role | null;
  isAdmin: boolean;
  isStaff: boolean;
  isCourier: boolean;
  fullName: string | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<Role[]>([]);
  const [fullName, setFullName] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setRoles([]);
      setFullName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const [{ data: roles }, { data: profile }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      ]);
      if (cancelled) return;
      setRoles((roles ?? []).map((r) => r.role));
      setFullName(profile?.full_name ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const isAdmin = roles.includes("admin");
  // papel principal só pra exibição: admin ganha de qualquer outro
  const role = isAdmin ? "admin" : (roles[0] ?? null);

  const value: AuthState = {
    user: session?.user ?? null,
    session,
    loading,
    roles,
    role,
    isAdmin,
    isStaff: roles.some((r) => STAFF_ROLES.includes(r)),
    isCourier: roles.includes("courier"),
    fullName,
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
