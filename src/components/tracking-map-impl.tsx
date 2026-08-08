import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type TrackedCourier = {
  id: string;
  name: string;
  color: string;
  lat: number | null;
  lng: number | null;
  updatedAt: string | null;
};

// pino colorido em CSS puro: evita depender dos ícones-padrão do Leaflet,
// que quebram no bundler sem configuração extra de assets
const icon = (color: string) =>
  L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

// centraliza/ajusta o zoom pra caber todo mundo sempre que a lista de
// posições muda — sem isso o mapa fica parado no último enquadramento
function FitBounds({ couriers }: { couriers: TrackedCourier[] }) {
  const map = useMap();
  useEffect(() => {
    const pts = couriers.filter(
      (c): c is TrackedCourier & { lat: number; lng: number } => c.lat !== null && c.lng !== null,
    );
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView([pts[0].lat, pts[0].lng], 15);
      return;
    }
    map.fitBounds(
      pts.map((c) => [c.lat, c.lng] as [number, number]),
      { padding: [40, 40] },
    );
  }, [map, couriers]);
  return null;
}

export function TrackingMap({
  couriers,
  focusId,
}: {
  couriers: TrackedCourier[];
  focusId?: string | null;
}) {
  const withPosition = useMemo(() => couriers.filter((c) => c.lat !== null && c.lng !== null), [couriers]);

  return (
    <MapContainer center={[-23.55, -46.63]} zoom={12} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds couriers={withPosition} />
      {withPosition.map((c) => (
        <Marker key={c.id} position={[c.lat!, c.lng!]} icon={icon(c.color)}>
          <Popup>
            <strong>{c.name}</strong>
            <br />
            {c.updatedAt ? new Date(c.updatedAt).toLocaleTimeString("pt-BR") : "sem horário"}
          </Popup>
        </Marker>
      ))}
      <FocusOn id={focusId} couriers={withPosition} />
    </MapContainer>
  );
}

// clicar num entregador na lista dá um "voa até ele" no mapa
function FocusOn({ id, couriers }: { id?: string | null; couriers: TrackedCourier[] }) {
  const map = useMap();
  useEffect(() => {
    if (!id) return;
    const c = couriers.find((x) => x.id === id);
    if (c && c.lat !== null && c.lng !== null) map.flyTo([c.lat, c.lng], 16);
  }, [id, map, couriers]);
  return null;
}
