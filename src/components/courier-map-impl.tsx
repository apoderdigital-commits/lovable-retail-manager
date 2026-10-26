import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Circle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { keepAwakeOn, keepAwakeOff } from "@/lib/keep-awake";
import { TZ } from "@/lib/format";
import {
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  ArrowUpLeft,
  ArrowUpRight,
  RotateCcw,
  RefreshCw,
  Flag,
  Navigation,
  LocateFixed,
  X,
} from "lucide-react";

export type MapStop = {
  id: string;
  index: number;
  label: string;
  // texto completo (rua, bairro, cidade): é a chave do cache
  address: string;
  // as partes separadas vão pra busca estruturada, que acerta mais
  street: string | null;
  neighborhood: string | null;
  city: string | null;
};

type Point = { lat: number; lng: number };

// precisão do pino: exato = casa/número achado; rua = só a rua, sem o
// número; bairro = centro do bairro. O entregador precisa saber a diferença,
// senão um pino no meio do bairro parece a porta do cliente.
type Precision = "exato" | "rua" | "bairro";
type Located = Point & { precision: Precision };

// mapa do OpenStreetMap, que não exige chave (o da CARTO passou a exigir e
// cobria o mapa de "API KEY REQUIRED"). A classe map-clean, em styles.css,
// tira as cores e suaviza o contraste: sobram ruas e nomes, sem poluição.
const TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// distância em metros entre dois pontos (fórmula de haversine)
function meters(a: Point, b: Point) {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const fmtMin = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;


// ---- endereço -> coordenada (Nominatim / OpenStreetMap) ----
// política de uso: no máximo 1 consulta por segundo. O resultado fica
// guardado no aparelho, então o mesmo endereço não é consultado de novo.

// v3: guarda só o que foi achado, com a precisão. A v2 gravava "não
// encontrado" pra sempre, inclusive quando era só a rede que falhou, e
// guardava o centro do bairro como se fosse a casa.
const CACHE_KEY = "courier-geocode-v3";

// a loja só entrega na Grande Recife (Igarassu ao Cabo): a busca fica
// presa nessa área, senão "Casa Caiada" ou "Centro" podem cair em outro estado
const AREA = "viewbox=-35.35,-7.55,-34.80,-8.45&bounded=1";

function readCache(): Record<string, Located> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, Located>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // armazenamento cheio ou bloqueado: só deixa de guardar
  }
}

// abreviações que o Nominatim nem sempre entende
const ABBREV: [RegExp, string][] = [
  [/^r\.?\s+/i, "Rua "],
  [/^av\.?\s+/i, "Avenida "],
  [/^tv\.?\s+|^trav\.?\s+/i, "Travessa "],
  [/^est\.?\s+/i, "Estrada "],
  [/^al\.?\s+/i, "Alameda "],
  [/^p[çc]a?\.?\s+/i, "Praça "],
  [/^rod\.?\s+/i, "Rodovia "],
];

// "Rua Foo, nº 123 - Apt 302, Bloco B" -> { street: "Rua Foo", number: "123" }
// O complemento (apto, bloco, casa, fundos...) derruba a busca, então fica
// tudo até o número. Número de rua ("Rua 15 de Novembro") não conta: é o
// primeiro número que NÃO vem seguido de " de ".
function splitStreet(raw: string): { street: string; number: string | null } {
  let s = raw.trim().replace(/\s+/g, " ");
  for (const [re, rep] of ABBREV) s = s.replace(re, rep);
  s = s.replace(/\b(n[º°o]\.?|n[uú]m(?:ero)?\.?)\s*/gi, "");
  const re = /\b(\d{1,5})\b(?!\s+de\s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const street = s
      .slice(0, m.index)
      .replace(/[\s,\-–]+$/, "")
      .trim();
    if (street) return { street, number: m[1]! };
  }
  return { street: s.replace(/\b(s\/n|sn)\b.*$/i, "").replace(/[\s,\-–]+$/, "").trim(), number: null };
}

type Hit = {
  lat: string;
  lon: string;
  address?: { house_number?: string; road?: string; pedestrian?: string; residential?: string };
};

// um pedido ao Nominatim. Erro de rede ou de servidor (429, 5xx) sobe como
// exceção: é "não deu pra consultar", não "não existe"
async function query(params: string): Promise<Located | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=br&${AREA}&${params}`;
  const res = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const hit = ((await res.json()) as Hit[])[0];
  if (!hit) return null;
  const a = hit.address ?? {};
  const precision: Precision = a.house_number
    ? "exato"
    : a.road || a.pedestrian || a.residential
      ? "rua"
      : "bairro";
  return { lat: Number(hit.lat), lng: Number(hit.lon), precision };
}

const enc = encodeURIComponent;

// do mais preciso pro menos: rua+número estruturado, texto completo, só a
// rua, e por fim bairro + cidade. Para no primeiro que achar; 1,1 s entre
// consultas por causa da política de uso do Nominatim.
async function geocode(stop: MapStop): Promise<Located | null> {
  const city = stop.city?.trim() || "Recife";
  const { street, number } = stop.street ? splitStreet(stop.street) : { street: "", number: null };
  const attempts: string[] = [];
  if (street && number) attempts.push(`street=${enc(`${number} ${street}`)}&city=${enc(city)}`);
  attempts.push(`q=${enc(stop.address)}`);
  if (street) attempts.push(`street=${enc(street)}&city=${enc(city)}`);
  if (stop.neighborhood?.trim()) attempts.push(`q=${enc(`${stop.neighborhood.trim()}, ${city}`)}`);

  for (const [i, params] of attempts.entries()) {
    if (i > 0) await sleep(1100);
    const hit = await query(params);
    if (!hit) continue;
    // a busca por bairro não pode "achar" uma casa: o pino é do bairro
    if (i === attempts.length - 1 && stop.neighborhood?.trim()) return { ...hit, precision: "bairro" };
    return hit;
  }
  return null;
}

function useGeocoded(stops: MapStop[]) {
  // só o que foi achado vem do cache; "não achou" e "não consultou" ficam
  // nesta sessão e são tentados de novo na próxima vez
  const [points, setPoints] = useState<Record<string, Located | null>>(() => readCache());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(0);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    const missing = stops.filter((s) => !(s.address in points) && !failed.has(s.address));
    if (missing.length === 0) return;
    setPending(missing.length);

    (async () => {
      for (const [i, s] of missing.entries()) {
        if (!alive) return;
        if (i > 0) await sleep(1100);
        try {
          const p = await geocode(s);
          if (!alive) return;
          if (p) {
            const cache = readCache();
            cache[s.address] = p;
            writeCache(cache);
          }
          setPoints((prev) => ({ ...prev, [s.address]: p }));
        } catch {
          if (!alive) return;
          setFailed((prev) => new Set(prev).add(s.address));
        }
        setPending((n) => n - 1);
      }
    })();

    return () => {
      alive = false;
    };
    // só refaz quando muda o conjunto de endereços ou o entregador pede
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops.map((s) => s.address).join("|"), retry]);

  const retryFailed = () => {
    setFailed(new Set());
    setRetry((n) => n + 1);
  };

  return { points, pending, failed, retryFailed };
}


// ---- posição do aparelho ----

// direção em graus (0 = norte) de a para b
function bearing(a: Point, b: Point) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// posição do aparelho com o raio de erro: antena de celular ou wi-fi dá
// fix de centenas de metros, e a bolinha não pode fingir que é exata
type MyPos = Point & { accuracy: number };

function useMyPosition() {
  const [pos, setPos] = useState<MyPos | null>(null);
  const [heading, setHeading] = useState(0);
  const [denied, setDenied] = useState(false);
  const last = useRef<Point | null>(null);
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setDenied(true);
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setDenied(false);
        const cur = { lat: p.coords.latitude, lng: p.coords.longitude };
        const accuracy = p.coords.accuracy ?? 0;
        // o GPS nem sempre informa a direção; aí calcula pelo deslocamento —
        // mas só com fix bom, senão o salto de um fix ruim vira "direção"
        if (p.coords.heading !== null && !Number.isNaN(p.coords.heading)) {
          setHeading(p.coords.heading);
        } else if (last.current && accuracy <= 50 && meters(last.current, cur) > 5) {
          setHeading(bearing(last.current, cur));
        }
        last.current = cur;
        setPos({ ...cur, accuracy });
      },
      () => setDenied(true),
      { enableHighAccuracy: true, maximumAge: 3_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return { pos, heading, denied };
}

// ---- rota pelas ruas (OSRM, servidor público do OpenStreetMap) ----

type Step = {
  distance: number;
  name: string;
  maneuver: { type: string; modifier?: string; exit?: number };
};

type Route = {
  line: [number, number][];
  distance: number;
  duration: number;
  steps: Step[];
};

async function fetchRoute(points: Point[], steps: boolean): Promise<Route | null> {
  if (points.length < 2) return null;
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const res = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=${steps}`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  const r = data?.routes?.[0];
  if (!r) return null;
  return {
    line: (r.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng]),
    distance: r.distance,
    duration: r.duration,
    steps: steps ? (r.legs?.[0]?.steps ?? []) : [],
  };
}

// instrução em português a partir da manobra do OSRM
function instruction(step: Step | undefined): { text: string; icon: typeof ArrowUp } {
  if (!step) return { text: "Siga em frente", icon: ArrowUp };
  const { type, modifier, exit } = step.maneuver;
  const street = step.name ? ` na ${step.name}` : "";
  if (type === "arrive") return { text: "Você chegou ao destino", icon: Flag };
  if (type === "roundabout" || type === "rotary")
    return { text: `Na rotatória, pegue a ${exit ?? 1}ª saída${street}`, icon: RefreshCw };
  if (modifier === "uturn") return { text: `Faça o retorno${street}`, icon: RotateCcw };
  if (modifier === "left" || modifier === "sharp left")
    return { text: `Vire à esquerda${street}`, icon: ArrowLeft };
  if (modifier === "right" || modifier === "sharp right")
    return { text: `Vire à direita${street}`, icon: ArrowRight };
  if (modifier === "slight left") return { text: `Mantenha-se à esquerda${street}`, icon: ArrowUpLeft };
  if (modifier === "slight right") return { text: `Mantenha-se à direita${street}`, icon: ArrowUpRight };
  return { text: `Siga em frente${street}`, icon: ArrowUp };
}


// ---- ícones ----

// o número gira ao contrário do mapa pra continuar de pé na tela.
// pino aproximado (sem número ou só o bairro) sai laranja e tracejado.
const stopIcon = (n: number, active: boolean, precision: Precision, mapRotation = 0) => {
  const approx = precision !== "exato";
  const bg = approx ? "#d97706" : active ? "#16a34a" : "#1e3a52";
  const border = approx ? "2px dashed white" : "2px solid white";
  return L.divIcon({
    className: "",
    html: `<div style="width:${active ? 32 : 26}px;height:${active ? 32 : 26}px;border-radius:50%;background:${bg};color:white;font:600 13px sans-serif;display:grid;place-items:center;border:${border};box-shadow:0 1px 4px rgba(0,0,0,.35);transform:rotate(${mapRotation}deg)">${n}</div>`,
    iconSize: [active ? 32 : 26, active ? 32 : 26],
    iconAnchor: [active ? 16 : 13, active ? 16 : 13],
  });
};

// parado: bolinha azul. navegando: seta apontando pra onde o motoboy vai
const meIcon = (navigating: boolean, heading: number) =>
  navigating
    ? L.divIcon({
        className: "",
        html: `<div style="width:38px;height:38px;display:grid;place-items:center;transform:rotate(${heading}deg)"><svg width="34" height="34" viewBox="0 0 24 24"><path d="M12 2 L20 21 L12 16.5 L4 21 Z" fill="#14b8a6" stroke="white" stroke-width="1.8" stroke-linejoin="round"/></svg></div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      })
    : L.divIcon({
        className: "",
        html: `<div style="width:20px;height:20px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 7px rgba(37,99,235,.22)"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

const ROUTE_COLOR = "#5b4cf0";


// ---- comportamento do mapa ----

// visão geral: enquadra tudo uma vez e depois deixa o entregador mexer
function FitOnce({ points }: { points: Point[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    if (points.length === 1) map.setView([points[0]!.lat, points[0]!.lng], 15);
    else map.fitBounds(points.map((p) => [p.lat, p.lng] as [number, number]), { padding: [40, 40] });
    done.current = true;
  }, [map, points]);
  return null;
}

// navegação: o mapa acompanha o entregador até ele arrastar com o dedo
function Follow({ pos, follow, onDrag }: { pos: Point | null; follow: boolean; onDrag: () => void }) {
  const map = useMap();
  useMapEvents({ dragstart: onDrag });
  useEffect(() => {
    if (follow && pos) map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 17), { animate: true });
  }, [map, pos, follow]);
  return null;
}


// a camada do mapa muda de tamanho ao entrar/sair da navegação girada:
// o Leaflet precisa recalcular, senão sobram áreas cinzas sem rua
function ResizeSync({ dep }: { dep: string }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize({ pan: false });
  }, [map, dep]);
  return null;
}

// o crédito do mapa é exigido pela licença, mas sem o selo do Leaflet
function QuietAttribution() {
  const map = useMap();
  useEffect(() => {
    map.attributionControl.setPrefix(false);
  }, [map]);
  return null;
}


// ---- tela ----

export function CourierMap({
  stops,
  onOpenStops,
}: {
  stops: MapStop[];
  onOpenStops?: () => void;
}) {
  const { points, pending, failed, retryFailed } = useGeocoded(stops);
  const { pos, heading, denied } = useMyPosition();
  const [navigating, setNavigating] = useState(false);
  const [follow, setFollow] = useState(true);

  // sai da tela do mapa (troca de aba, entrega confirmada): libera a tela
  useEffect(() => () => keepAwakeOff(), []);

  // ângulo do mapa "desenrolado": de 350° pra 10° gira 20°, não volta 340°
  // pelo caminho longo
  const rotation = useRef(0);
  const rot = useMemo(() => {
    const delta = ((heading - (rotation.current % 360) + 540) % 360) - 180;
    rotation.current += delta;
    return rotation.current;
  }, [heading]);

  // lado do quadrado que cobre a moldura em qualquer ângulo (a diagonal)
  const frame = useRef<HTMLDivElement>(null);
  const [diag, setDiag] = useState(0);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e!.contentRect;
      setDiag(Math.ceil(Math.hypot(width, height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rotating = navigating && follow && diag > 0;

  const located = useMemo(
    () =>
      stops.flatMap((s) => {
        const p = points[s.address];
        return p ? [{ ...s, ...p }] : [];
      }),
    [stops, points],
  );

  const next = located[0] ?? null;
  const notFound = stops.filter((s) => points[s.address] === null);
  const approximate = located.filter((s) => s.precision !== "exato");
  const unreachable = stops.filter((s) => failed.has(s.address));

  // visão geral: trajeto completo, da posição atual passando por todas as
  // paradas na ordem escolhida
  const [overview, setOverview] = useState<Route | null>(null);
  const overviewKey = located.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join(";");
  const posRounded = pos ? `${pos.lat.toFixed(3)},${pos.lng.toFixed(3)}` : "";
  useEffect(() => {
    if (navigating) return;
    let alive = true;
    const pts = [...(pos ? [pos] : []), ...located];
    fetchRoute(pts, false)
      .then((r) => alive && setOverview(r))
      .catch(() => alive && setOverview(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewKey, posRounded, navigating]);

  // navegação: rota da posição atual até a próxima parada, refeita quando o
  // entregador anda uns 40 m — é isso que mantém a instrução atualizada
  const [leg, setLeg] = useState<Route | null>(null);
  const lastFrom = useRef<Point | null>(null);
  useEffect(() => {
    if (!navigating || !pos || !next) return;
    if (lastFrom.current && meters(lastFrom.current, pos) < 40 && leg) return;
    lastFrom.current = pos;
    let alive = true;
    fetchRoute([pos, next], true)
      .then((r) => alive && r && setLeg(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating, pos, next?.id]);

  useEffect(() => {
    lastFrom.current = null;
    setLeg(null);
  }, [next?.id]);

  // "chegou" só com fix decente: a 500 m de erro, 50 m não quer dizer nada
  const arrived = navigating && pos && next ? meters(pos, next) < 50 && pos.accuracy <= 100 : false;
  const badFix = pos ? pos.accuracy > 150 : false;
  const nextStep = leg?.steps[1];
  const toNextTurn = leg?.steps[0]?.distance ?? 0;
  const instr = instruction(nextStep);
  const InstrIcon = arrived ? Flag : instr.icon;

  // dentro do clique: o iOS só deixa manter a tela acesa a partir de um toque
  const start = () => {
    keepAwakeOn();
    setFollow(true);
    setNavigating(true);
  };
  const stop = () => {
    keepAwakeOff();
    setNavigating(false);
  };

  return (
    <div className="space-y-2">
      <div ref={frame} className="panel relative h-[65vh] min-h-80 overflow-hidden">
        {/* navegando, o mapa gira pra direção do motoboy ficar sempre pra
            cima, como no Waze. A camada é um quadrado do tamanho da diagonal
            da moldura, pra não aparecer canto vazio em nenhum ângulo. */}
        <div
          style={
            rotating
              ? {
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: diag,
                  height: diag,
                  transform: `translate(-50%, -50%) rotate(${-rot}deg)`,
                  transition: "transform 0.6s linear",
                }
              : { position: "absolute", inset: 0 }
          }
        >
        <MapContainer
          center={[-8.05, -34.9]}
          zoom={13}
          zoomControl={false}
          style={{ height: "100%", width: "100%", background: "#f2efe9" }}
        >
          <TileLayer url={TILES} attribution={ATTRIBUTION} className="map-clean" maxZoom={19} />
          <QuietAttribution />
          <ResizeSync dep={`${rotating}-${diag}`} />
          {!navigating && <FitOnce points={[...(pos ? [pos] : []), ...located]} />}
          {navigating && <Follow pos={pos} follow={follow} onDrag={() => setFollow(false)} />}

          {navigating && leg ? (
            <>
              {/* contorno claro por baixo dá o efeito de "faixa" do Waze */}
              <Polyline positions={leg.line} pathOptions={{ color: "white", weight: 12, opacity: 0.9 }} />
              <Polyline positions={leg.line} pathOptions={{ color: ROUTE_COLOR, weight: 8, opacity: 1 }} />
            </>
          ) : (
            overview && (
              <Polyline
                positions={overview.line}
                pathOptions={{ color: ROUTE_COLOR, weight: 6, opacity: 0.75 }}
              />
            )
          )}

          {located.map((s, i) => (
            <Marker
              key={s.id}
              position={[s.lat, s.lng]}
              icon={stopIcon(s.index, i === 0, s.precision, rotating ? rot : 0)}
            />
          ))}
          {/* raio de erro do GPS: some quando o fix é bom */}
          {pos && pos.accuracy > 25 && (
            <Circle
              center={[pos.lat, pos.lng]}
              radius={pos.accuracy}
              pathOptions={{ color: "#2563eb", weight: 1, opacity: 0.5, fillOpacity: 0.08 }}
            />
          )}
          {pos && (
            <Marker
              position={[pos.lat, pos.lng]}
              icon={meIcon(navigating, heading)}
              zIndexOffset={1000}
            />
          )}
        </MapContainer>
        </div>

        {/* girado, o crédito do Leaflet pode cair fora da moldura */}
        {rotating && (
          <span className="pointer-events-none absolute bottom-1 left-2 z-[1000] text-[10px] text-black/60">
            © OpenStreetMap
          </span>
        )}

        {/* instrução da próxima manobra, no topo, grande pra ler em movimento */}
        {navigating && next && (
          <div className="absolute inset-x-0 top-0 z-[1000] flex items-center gap-3 bg-[#25313d] px-4 py-3 text-white shadow-lg">
            <InstrIcon className="size-10 shrink-0" strokeWidth={2.5} />
            <div className="min-w-0">
              {arrived ? (
                <p className="text-lg font-semibold">Você chegou</p>
              ) : leg ? (
                <>
                  <p className="text-2xl font-bold leading-none">
                    {toNextTurn < 15 ? "Agora" : fmtDist(toNextTurn)}
                  </p>
                  <p className="mt-1 truncate text-sm text-white/85">{instr.text}</p>
                </>
              ) : (
                <p className="text-sm">Calculando rota...</p>
              )}
            </div>
          </div>
        )}

        {navigating && !follow && pos && (
          <button
            type="button"
            onClick={() => setFollow(true)}
            className="absolute bottom-3 right-3 z-[1000] flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-sm font-medium text-black shadow-lg"
          >
            <LocateFixed className="size-4" /> Recentralizar
          </button>
        )}
      </div>

      {denied && (
        <p className="text-center text-xs text-warning">
          Libere a localização do celular para ver sua posição e navegar.
        </p>
      )}
      {badFix && (
        <p className="text-center text-xs text-warning">
          GPS impreciso (±{Math.round(pos!.accuracy)} m). Saia de dentro do prédio ou ligue o GPS de alta precisão.
        </p>
      )}
      {pending > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Localizando {pending} endereço(s)...
        </p>
      )}
      {approximate.length > 0 && (
        <p className="text-center text-xs text-warning">
          Pino aproximado (laranja), confirme o número com o cliente:{" "}
          {approximate
            .map((s) => `${s.index}. ${s.label} (${s.precision === "rua" ? "só a rua" : "centro do bairro"})`)
            .join(", ")}
        </p>
      )}
      {notFound.length > 0 && (
        <p className="text-center text-xs text-destructive">
          Endereço não encontrado no mapa: {notFound.map((s) => `${s.index}. ${s.label}`).join(", ")}
        </p>
      )}
      {unreachable.length > 0 && (
        <p className="text-center text-xs text-destructive">
          Sem resposta do serviço de mapas para {unreachable.length} endereço(s).{" "}
          <button type="button" className="underline" onClick={retryFailed}>
            Tentar de novo
          </button>
        </p>
      )}

      {next && (
        <div className="panel p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Próxima parada</p>
              <p className="truncate font-medium">
                {next.index}. {next.label}
              </p>
              <p className="truncate text-xs text-muted-foreground">{next.address}</p>
            </div>
            {(navigating ? leg : overview) && (
              <div className="shrink-0 text-right">
                {/* como no Waze: hora de chegada em destaque, tempo e km embaixo */}
                <p className="font-display text-xl font-bold leading-none">
                  {new Date(
                    Date.now() + (navigating ? leg : overview)!.duration * 1000,
                  ).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmtMin((navigating ? leg : overview)!.duration)} ·{" "}
                  {fmtDist((navigating ? leg : overview)!.distance)}
                  {!navigating && located.length > 1 ? " no total" : ""}
                </p>
              </div>
            )}
          </div>

          <div className="mt-3">
            {arrived ? (
              <button
                type="button"
                onClick={() => {
                  stop();
                  onOpenStops?.();
                }}
                className="w-full rounded-lg bg-success px-3 py-3 text-base font-semibold text-success-foreground"
              >
                Confirmar entrega
              </button>
            ) : navigating ? (
              <button
                type="button"
                onClick={stop}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-3 text-base font-medium"
              >
                <X className="size-5" /> Parar navegação
              </button>
            ) : (
              <button
                type="button"
                disabled={!pos}
                onClick={start}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-3 text-base font-semibold text-primary-foreground disabled:opacity-50"
              >
                <Navigation className="size-5" /> Iniciar navegação
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
