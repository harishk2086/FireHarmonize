import { useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  LayersControl,
  LayerGroup,
  useMap,
} from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';

interface RawFireObservation {
  id: number;
  observation_id: string;
  sensor: string;
  satellite?: string;
  latitude: number;
  longitude: number;
  acquisition_datetime: string;
  confidence?: string | number;
  frp?: number | null;
  brightness_temperature?: number | null;
  source?: string;
  match_status?: string;
}

interface HarmonizedFireEvent {
  id: number;
  event_id: string;
  event_datetime: string;
  latitude: number;
  longitude: number;
  modis_count: number;
  viirs_count: number;
  mean_confidence: number;
  match_score: number;
  spatial_radius_km: number;
  temporal_window_minutes: number;
  harmonization_method: string;
}

interface FireMapProps {
  modisFires: RawFireObservation[];
  viirsFires: RawFireObservation[];
  harmonizedEvents: HarmonizedFireEvent[];
  showModis: boolean;
  showViirs: boolean;
  showHarmonized: boolean;

  onSelect: (
    item: any,
    sensorType: 'MODIS' | 'VIIRS' | 'HARMONIZED'
  ) => void;
}

function MapResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => window.clearTimeout(timer);
  }, [map]);

  return null;
}

function ObservationPopup({
  observation,
}: {
  observation: RawFireObservation;
}) {
  return (
    <div className="min-w-[190px] space-y-2 text-sm">
      <h3 className="text-base font-bold">{observation.sensor} Observation</h3>

      <div>
        <span className="font-semibold">ID: </span>
        {observation.observation_id}
      </div>

      {observation.satellite && (
        <div>
          <span className="font-semibold">Satellite: </span>
          {observation.satellite}
        </div>
      )}

      <div>
        <span className="font-semibold">Latitude: </span>
        {observation.latitude.toFixed(5)}
      </div>

      <div>
        <span className="font-semibold">Longitude: </span>
        {observation.longitude.toFixed(5)}
      </div>

      <div>
        <span className="font-semibold">Acquired: </span>
        {new Date(observation.acquisition_datetime).toLocaleString()}
      </div>

      {observation.confidence !== undefined && (
        <div>
          <span className="font-semibold">Confidence: </span>
          {String(observation.confidence)}
        </div>
      )}

      {observation.frp != null && (
        <div>
          <span className="font-semibold">Fire Radiative Power: </span>
          {observation.frp} MW
        </div>
      )}

      {observation.brightness_temperature != null && (
        <div>
          <span className="font-semibold">Brightness Temperature: </span>
          {observation.brightness_temperature}
        </div>
      )}

      {observation.match_status && (
        <div>
          <span className="font-semibold">Match status: </span>
          {observation.match_status}
        </div>
      )}
    </div>
  );
}

function HarmonizedPopup({ event }: { event: HarmonizedFireEvent }) {
  return (
    <div className="min-w-[210px] space-y-2 text-sm">
      <h3 className="text-base font-bold text-amber-600">
        Harmonized Fire Event
      </h3>

      <div>
        <span className="font-semibold">Event ID: </span>
        {event.event_id}
      </div>

      <div>
        <span className="font-semibold">Latitude: </span>
        {event.latitude.toFixed(5)}
      </div>

      <div>
        <span className="font-semibold">Longitude: </span>
        {event.longitude.toFixed(5)}
      </div>

      <div>
        <span className="font-semibold">Event time: </span>
        {new Date(event.event_datetime).toLocaleString()}
      </div>

      <div>
        <span className="font-semibold">MODIS observations: </span>
        {event.modis_count}
      </div>

      <div>
        <span className="font-semibold">VIIRS observations: </span>
        {event.viirs_count}
      </div>

      <div>
        <span className="font-semibold">Mean confidence: </span>
        {Number(event.mean_confidence).toFixed(1)}%
      </div>

      <div>
        <span className="font-semibold">Match score: </span>
        {Number(event.match_score).toFixed(1)}/100
      </div>

      <div>
        <span className="font-semibold">Spatial radius: </span>
        {event.spatial_radius_km} km
      </div>

      <div>
        <span className="font-semibold">Time window: </span>
        {event.temporal_window_minutes} minutes
      </div>

      <div>
        <span className="font-semibold">Method: </span>
        {event.harmonization_method}
      </div>
    </div>
  );
}

export default function FireMap({
  modisFires,
  viirsFires,
  harmonizedEvents,
  showModis,
  showViirs,
  showHarmonized,
  onSelect,
}: FireMapProps) {
  const validModis = modisFires.filter(
    (fire) =>
      Number.isFinite(fire.latitude) && Number.isFinite(fire.longitude),
  );

  const validViirs = viirsFires.filter(
    (fire) =>
      Number.isFinite(fire.latitude) && Number.isFinite(fire.longitude),
  );

  const validHarmonized = harmonizedEvents.filter(
    (event) =>
      Number.isFinite(event.latitude) && Number.isFinite(event.longitude),
  );

  const allCoordinates: LatLngExpression[] = [
    ...validModis.map(
      (fire) => [fire.latitude, fire.longitude] as LatLngExpression,
    ),
    ...validViirs.map(
      (fire) => [fire.latitude, fire.longitude] as LatLngExpression,
    ),
    ...validHarmonized.map(
      (event) => [event.latitude, event.longitude] as LatLngExpression,
    ),
  ];

 const center: LatLngExpression =
  allCoordinates.length > 0 ? allCoordinates[0] : [11.5, 78.5];

  return (
    <div className="relative z-0 h-[420px] w-full overflow-hidden rounded-xl border border-slate-800 sm:h-[500px] lg:h-[600px]">
      <MapContainer
        center={center}
        zoom={allCoordinates.length > 0 ? 5 : 2}
        scrollWheelZoom
        style={{
          height: '100%',
          width: '100%',
          background: '#0B0F19',
        }}
      >
        <MapResizeHandler />

        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Dark map (Esri Dark Gray)">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
              attribution='Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS, &copy; OpenStreetMap contributors, and the GIS User Community'
              maxNativeZoom={16}
              maxZoom={19}
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Satellite (Esri World Imagery)">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution='Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
              maxNativeZoom={19}
              maxZoom={19}
            />
          </LayersControl.BaseLayer>

          <LayersControl.Overlay checked name="Place names &amp; borders">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              attribution='Labels &copy; <a href="https://www.esri.com">Esri</a>'
              maxNativeZoom={16}
              maxZoom={19}
              zIndex={10}
            />
          </LayersControl.Overlay>

          <LayersControl.Overlay
            checked={showModis}
            name="MODIS Observations (Blue)"
          >
            <LayerGroup>
              {validModis.map((fire) => (
                <CircleMarker
                  key={`modis-${fire.id}`}
                  center={[fire.latitude, fire.longitude]}
eventHandlers={{
  click: () => onSelect(fire, 'MODIS'),
}}                  radius={6}
                  pathOptions={{
                    color: '#3B82F6',
                    fillColor: '#3B82F6',
                    fillOpacity: 0.8,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <ObservationPopup observation={fire} />
                  </Popup>
                </CircleMarker>
              ))}
            </LayerGroup>
          </LayersControl.Overlay>

          <LayersControl.Overlay
            checked={showViirs}
            name="VIIRS Observations (Green)"
          >
            <LayerGroup>
              {validViirs.map((fire) => (
                <CircleMarker
                  key={`viirs-${fire.id}`}
                  center={[fire.latitude, fire.longitude]}
                  eventHandlers={{ click: () => onSelect(fire, 'VIIRS') }}
                  radius={4}
                  pathOptions={{
                    color: '#10B981',
                    fillColor: '#10B981',
                    fillOpacity: 0.85,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <ObservationPopup observation={fire} />
                  </Popup>
                </CircleMarker>
              ))}
            </LayerGroup>
          </LayersControl.Overlay>

          <LayersControl.Overlay
            checked={showHarmonized}
            name="Harmonized Events (Amber)"
          >
            <LayerGroup>
              {validHarmonized.map((event) => (
                <CircleMarker
                  key={`harmonized-${event.id}`}
                  center={[event.latitude, event.longitude]}
                  eventHandlers={{ click: () => onSelect(event, 'HARMONIZED') }}
                  radius={8}
                  pathOptions={{
                    color: '#F59E0B',
                    fillColor: '#F59E0B',
                    fillOpacity: 0.9,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <HarmonizedPopup event={event} />
                  </Popup>
                </CircleMarker>
              ))}
            </LayerGroup>
          </LayersControl.Overlay>
        </LayersControl>
      </MapContainer>

        

      <div className="pointer-events-none absolute bottom-7 left-3 z-[1000] max-w-[calc(100%-1.5rem)] rounded-lg border border-slate-700 bg-slate-950/95 p-3 text-xs text-slate-200 shadow-lg">
        <div className="mb-2 font-bold tracking-wide">MAP LEGEND</div>

        <div className="mb-2 flex items-start gap-2">
          <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500" />
          <span>MODIS Observations (1 km)</span>
        </div>

        <div className="mb-2 flex items-start gap-2">
          <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
          <span>VIIRS Observations (375 m)</span>
        </div>

        <div className="flex items-start gap-2">
          <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
          <span>Harmonized Events</span>
        </div>
      </div>


      {allCoordinates.length === 0 && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-[1000] -translate-x-1/2 rounded-lg border border-amber-500/40 bg-slate-950/90 px-3 py-2 text-center text-xs text-amber-200">
          No valid fire coordinates are available.
        </div>
      )}
    </div>
  );
}
