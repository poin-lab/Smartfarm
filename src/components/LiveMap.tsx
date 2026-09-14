import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { useEffect } from "react";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import type { Farm } from "../model";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function FitFarms({ farms }: { farms: Farm[] }) {
  const map = useMap();
  useEffect(() => {
    if (farms.length === 1)
      map.setView([farms[0].latitude, farms[0].longitude], 12);
    if (farms.length > 1)
      map.fitBounds(
        farms.map((farm) => [farm.latitude, farm.longitude]),
        { padding: [40, 40] },
      );
  }, [farms, map]);
  return null;
}

export function LiveMap({
  farms,
  onSelect,
}: {
  farms: Farm[];
  onSelect: (farm: Farm) => void;
}) {
  return (
    <MapContainer
      className="leaflet-map"
      center={[35.87, 128.67]}
      zoom={9}
      scrollWheelZoom
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitFarms farms={farms} />
      {farms.map((farm) => (
        <Marker
          key={farm.id}
          position={[farm.latitude, farm.longitude]}
          eventHandlers={{ click: () => onSelect(farm) }}
        >
          <Popup>
            <strong>{farm.name}</strong>
            <br />
            {farm.address}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
