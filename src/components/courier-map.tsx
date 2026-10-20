import { useEffect, useState, type ComponentType } from "react";
import type { MapStop } from "@/components/courier-map-impl";

type Props = { stops: MapStop[]; onOpenStops?: () => void };

/**
 * Mesmo cuidado do mapa de rastreio: Leaflet usa `window` assim que é
 * importado, e a rota renderiza primeiro no servidor. O import só acontece
 * dentro do useEffect, que nunca roda no SSR.
 */
export function CourierMap(props: Props) {
  const [Impl, setImpl] = useState<ComponentType<Props> | null>(null);

  useEffect(() => {
    let alive = true;
    import("@/components/courier-map-impl").then((mod) => {
      if (alive) setImpl(() => mod.CourierMap);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!Impl) {
    return (
      <div className="panel flex h-[65vh] min-h-80 items-center justify-center text-sm text-muted-foreground">
        Carregando mapa...
      </div>
    );
  }

  return <Impl {...props} />;
}
