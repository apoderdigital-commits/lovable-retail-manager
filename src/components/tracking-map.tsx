import { useEffect, useState, type ComponentType } from "react";
import type { TrackedCourier } from "@/components/tracking-map-impl";

type Props = { couriers: TrackedCourier[]; focusId?: string | null };

/**
 * Leaflet mexe com `window`/`document` assim que é importado, e o
 * TanStack Start renderiza a rota primeiro no servidor — importar direto
 * no topo do arquivo quebra o build lá (mesmo problema que já pegamos com
 * html2canvas/jspdf no recibo). O import só acontece dentro do useEffect,
 * que nunca roda durante SSR.
 */
export function TrackingMap(props: Props) {
  const [Impl, setImpl] = useState<ComponentType<Props> | null>(null);

  useEffect(() => {
    let alive = true;
    import("@/components/tracking-map-impl").then((mod) => {
      if (alive) setImpl(() => mod.TrackingMap);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!Impl) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Carregando mapa...
      </div>
    );
  }

  return <Impl {...props} />;
}
