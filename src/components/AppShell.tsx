import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  BarChart3,
  LogOut,
  Store,
  Receipt,
  Truck,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const nav = [
  { to: "/", label: "Painel", icon: LayoutDashboard },
  { to: "/pdv", label: "Nova venda", icon: ShoppingCart },
  { to: "/pedidos", label: "Pedidos", icon: Receipt },
  { to: "/entregas", label: "Entregas", icon: Truck },
  { to: "/produtos", label: "Produtos", icon: Package },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
] as const;

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user, loading, role, fullName, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar px-3 py-5 text-sidebar-foreground md:flex">
        <div className="mb-7 flex items-center gap-2 px-2">
          <span className="grid size-9 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Store className="size-5" />
          </span>
          <span className="font-display text-lg font-semibold">Vieira Perfumes</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60"
                }`}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-4 rounded-lg bg-sidebar-accent/50 p-3">
          <p className="truncate text-sm font-medium">{fullName || user.email}</p>
          <p className="mt-0.5 text-xs text-sidebar-foreground/60">
            {role === "admin" ? "Administrador" : "Vendedor"}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start px-2 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={async () => {
              await signOut();
              navigate({ to: "/auth" });
            }}
          >
            <LogOut className="mr-2 size-4" /> Sair
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5 py-4">
          <div>
            <h1 className="font-display text-xl font-semibold text-foreground">{title}</h1>
            {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">{actions}</div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-3 py-2 md:hidden">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs ${
                pathname === item.to
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <main className="flex-1 p-5">{children}</main>
      </div>
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "warning";
}) {
  return (
    <div className="panel p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-2 font-display text-2xl font-semibold ${
          tone === "warning" ? "text-warning" : tone === "accent" ? "text-accent" : "text-foreground"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function StockBadge({ stock, min }: { stock: number; min: number }) {
  if (stock <= 0) return <Badge variant="destructive">Sem estoque</Badge>;
  if (stock <= min)
    return (
      <Badge className="border-transparent bg-warning text-warning-foreground">Estoque baixo</Badge>
    );
  return <Badge variant="secondary">Ok</Badge>;
}
