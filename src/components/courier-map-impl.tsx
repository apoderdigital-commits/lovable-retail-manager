import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapStop = {
  id: string;
  index: number;
  label: string;
  address: string;
};

type Point = { lat: number; lng: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// endereço -> coordenada pelo Nominatim (OpenStreetMap), serviço público e
// sem chave. A política de uso pede no máximo 1 consulta por segundo, então
// as paradas são resolvidas uma de cada vez e o resultado fica guardado no
// aparelho: o mesmo endereço não é consultado de novo.
const CACHE_KEY = "courier-geocode-v1";

function readCache(): Record<string, Point | null> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, Point | null>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // armazenamento cheio ou bloqueado: só deixa de guardar
  }
}

async function search(q: string): Promise<Point | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
  if (!res.ok) return null;
  const data = (await res.json()) as { lat: string; lon: string }[];
  const hit = data[0];
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
}

// endereço completo primeiro; se o OpenStreetMap não conhecer a rua, cai
// pro bairro + cidade, que pelo menos põe o pino na região certa
async function geocode(address: string): Promise<Point | null> {
  const full = await search(address);
  if (full) return full;
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length < 3) return null;
  await sleep(1100);
  return search(parts.slice(-2).join(", "));
}

function useGeocoded(stops: MapStop[]) {
  const [points, setPoints] = useState<Record<string, Point | null>>(() => readCache());
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let alive = true;
    const missing = stops.filter((s) => !(s.address in points));
    if (missing.length === 0) return;
    setPending(missing.length);

    (async () => {
      const cache = readCache();
      for (const [i, s] of missing.entries()) {
        if (!alive) return;
        if (i > 0) await sleep(1100);
        let p: Point | null = null;
        try {
          p = await geocode(s.address);
        } catch {
          p = null;
        }
        cache[s.address] = p;
        writeCache(cache);
        if (!alive) return;
        setPoints((prev) => ({ ...prev, [s.address]: p }));
        setPending((n) => n - 1);
      }
    })();

    return () => {
      alive = false;
    };
    // só refaz quando muda o conjunto de endereços
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops.map((s) => s.address).join("|")]);

  return { points, pending };
}

// posição do aparelho, atualizada enquanto a aba do mapa estiver aberta
function useMyPosition() {
  const [pos, setPos] = useState<Point | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setDenied(true);
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setDenied(true),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return { pos, denied };
}

// trajeto de carro pelas ruas, na ordem das paradas, pelo OSRM (servidor
// público de demonstração do OpenStreetMap). Se ele estiver fora do ar, o
// mapa mostra só os pontos, sem a linha.
function useRoute(points: Point[]) {
  const [line, setLine] = useState<[number, number][]>([]);
  const [summary, setSummary] = useState<{ km: number; min: number } | null>(null);
  const key = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");

  useEffect(() => {
    if (points.length < 2) {
      setLine([]);
      setSummary(null);
      return;
    }
    let alive = true;
    fetch(
      `https://router.project-osrm.org/route/v1/driving/${key}?overview=full&geometries=geojson`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data?.routes?.[0]) return;
        const route = data.routes[0];
        setLine(
          (route.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng]),
        );
        setSummary({ km: route.distance / 1000, min: route.duration / 60 });
      })
      .catch(() => {
        if (alive) setLine([]);
      });
    return () => {
      alive = false;
    };
    // a chave já resume os pontos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { line, summary };
}

const stopIcon = (n: number) =>
  L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;border-radius:50%;background:#1e3a52;color:white;font:600 12px sans-serif;display:grid;place-items:center;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)">${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

const meIcon = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 6px rgba(37,99,235,.25)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// enquadra tudo uma vez; depois deixa o entregador mexer no mapa à vontade
function FitOnce({ points }: { points: Point[] }) {
  const map = useMap();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done || points.length === 0) return;
    if (points.length === 1) map.setView([points[0]!.lat, points[0]!.lng], 15);
    else map.fitBounds(points.map((p) => [p.lat, p.lng] as [number, number]), { padding: [40, 40] });
    setDone(true);
  }, [map, points, done]);
  return null;
}

function Recenter({ pos }: { pos: Point | null }) {
  const map = useMap();
  if (!pos) return null;
  return (
    <button
      type="button"
      onClick={() => map.flyTo([pos.lat, pos.lng], 16)}
      className="absolute bottom-3 right-3 z-[1000] rounded-full bg-white px-3 py-2 text-xs font-medium text-black shadow"
    >
      Minha posição
    </button>
  );
}

export const navLinks = (p: Point | null, address: string) => ({
  google: p
    ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`,
  waze: p
    ? `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`,
});

export function CourierMap({ stops }: { stops: MapStop[] }) {
  const { points, pending } = useGeocoded(stops);
  const { pos, denied } = useMyPosition();

  const located = useMemo(
    () =>
      stops.flatMap((s) => {
        const p = points[s.address];
        return p ? [{ ...s, ...p }] : [];
      }),
    [stops, points],
  );

  const routePoints = useMemo(
    () => [...(pos ? [pos] : []), ...located.map((s) => ({ lat: s.lat, lng: s.lng }))],
    // a rota não precisa refazer a cada passo do GPS: arredonda a posição
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pos?.lat.toFixed(3), pos?.lng.toFixed(3), located],
  );
  const { line, summary } = useRoute(routePoints);

  const notFound = stops.filter((s) => points[s.address] === null);
  const next = stops[0];
  const nextPoint = next ? (points[next.address] ?? null) : null;
  const nextLinks = next ? navLinks(nextPoint, next.address) : null;

  return (
    <div className="space-y-2">
      <div className="panel relative h-[60vh] min-h-80 overflow-hidden">
        <MapContainer center={[-8.05, -34.9]} zoom={12} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitOnce points={routePoints} />
          {line.length > 0 && (
            <Polyline positions={line} pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.8 }} />
          )}
          {located.map((s) => (
            <Marker key={s.id} position={[s.lat, s.lng]} icon={stopIcon(s.index)}>
              <Popup>
                <strong>
                  {s.index}. {s.label}
                </strong>
                <br />
                {s.address}
              </Popup>
            </Marker>
          ))}
          {pos && <Marker position={[pos.lat, pos.lng]} icon={meIcon} />}
          <Recenter pos={pos} />
        </MapContainer>
      </div>

      {summary && (
        <p className="text-center text-xs text-muted-foreground">
          Trajeto completo: {summary.km.toFixed(1)} km · cerca de {Math.round(summary.min)} min
        </p>
      )}
      {pending > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Localizando {pending} endereço(s)...
        </p>
      )}
      {denied && (
        <p className="text-center text-xs text-warning">
          Sem acesso à localização do celular. Libere o GPS para ver sua posição no mapa.
        </p>
      )}
      {notFound.length > 0 && (
        <p className="text-center text-xs text-destructive">
          Endereço não encontrado no mapa: {notFound.map((s) => `${s.index}. ${s.label}`).join(", ")}.
          Use os botões de navegação da parada.
        </p>
      )}

      {next && nextLinks && (
        <div className="panel p-3">
          <p className="text-xs text-muted-foreground">Próxima parada</p>
          <p className="text-sm font-medium">
            {next.index}. {next.label}
          </p>
          <p className="text-xs text-muted-foreground">{next.address}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <a
              href={nextLinks.waze}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground"
            >
              Navegar no Waze
            </a>
            <a
              href={nextLinks.google}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-border px-3 py-2 text-center text-sm font-medium"
            >
              Google Maps
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
