import {
  KpiStats,
  RawFireObservation,
  HarmonizedFireEvent,
  HarmonizeParams,
  DataQualityReport,
} from '../types';

// Empty in local dev (Vite proxies /api to localhost:8000); set VITE_API_URL to the backend URL in production.
const API_ORIGIN = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
export const API_BASE = `${API_ORIGIN}/api`;

interface BackendFire {
  observation_id: string;
  sensor: 'MODIS' | 'VIIRS';
  satellite: string;
  latitude: number;
  longitude: number;
  acq_datetime: string;
  confidence: number;
  frp: number;
  brightness: number;
  product: string;
  version: string;
  is_demo: boolean;
}

interface FiresResponse {
  total: number;
  page: number;
  label: string;
  items: BackendFire[];
}

interface BackendStats {
  modis_observations: number;
  viirs_observations: number;
  matched_pairs: number;
  modis_only: number;
  viirs_only: number;
  possible_duplicates: number;
  low_confidence: number;
  match_percentage_of_modis: number;
  match_percentage_of_viirs: number;
}

interface HarmonizationResponse {
  statistics: BackendStats;
  events: number;
  label: string;
  params: {
    radius_km: number;
    window_min: number;
    conf_threshold: number;
    note: string;
  };
  is_demo: boolean;
}

interface BackendHarmonizedEvent {
  event_id: string;
  time_start: string;
  time_end: string;
  centroid_latitude: number;
  centroid_longitude: number;
  source_count: number;
  modis_count: number;
  viirs_count: number;
  mean_confidence: number;
  max_confidence: number;
  frp_sum: number;
  frp_max: number;
  match_score: number;
  source_sensor_list: string[];
  classification: string;
  date: string;
  harmonization_method: string;
  spatial_match_radius_km: number;
  temporal_match_window_min: number;
}

// Region the dashboard is showing; sent as ?region= on every data request.
let currentRegion: string | null = null;

export function setRegion(regionId: string | null) {
  currentRegion = regionId;
}

function withRegion(endpoint: string): string {
  if (!currentRegion) return endpoint;
  const sep = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${sep}region=${encodeURIComponent(currentRegion)}`;
}

async function fetchJson<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${withRegion(endpoint)}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `API Error [${response.status}]: ${
        errText || response.statusText
      }`
    );
  }

  return response.json();
}

async function fetchAllFires(): Promise<BackendFire[]> {
  const pageSize = 1000; // live data can be thousands of detections

  const firstPage = await fetchJson<FiresResponse>(
    `/fires?page=1&size=${pageSize}`
  );

  const totalPages = Math.ceil(firstPage.total / pageSize);

  if (totalPages <= 1) {
    return firstPage.items;
  }

  const remainingPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      fetchJson<FiresResponse>(
        `/fires?page=${index + 2}&size=${pageSize}`
      )
    )
  );

  return [
    ...firstPage.items,
    ...remainingPages.flatMap((page) => page.items),
  ];
}

function convertFire(
  fire: BackendFire,
  index: number
): RawFireObservation {
  return {
    id: index + 1,
    observation_id: fire.observation_id,
    sensor: fire.sensor,
    satellite: fire.satellite,
    latitude: fire.latitude,
    longitude: fire.longitude,
    acquisition_datetime: fire.acq_datetime,
    confidence: String(fire.confidence),
    frp: fire.frp,
    brightness_temperature: fire.brightness,
    source: fire.product,
    match_status: 'UNMATCHED',
  };
}

function convertHarmonizedEvent(
  event: BackendHarmonizedEvent,
  index: number
): HarmonizedFireEvent {
  return {
    id: index + 1,
    event_id: event.event_id,
    event_datetime: event.time_start,
    latitude: event.centroid_latitude,
    longitude: event.centroid_longitude,
    modis_count: event.modis_count,
    viirs_count: event.viirs_count,
    mean_confidence: event.mean_confidence,
    match_score: event.match_score * 100,
    spatial_radius_km: event.spatial_match_radius_km,
    temporal_window_minutes: event.temporal_match_window_min,
    harmonization_method: event.harmonization_method,
    classification: event.classification,
  };
}

function convertStats(
  data: HarmonizationResponse
): KpiStats {
  return {
    total_modis: data.statistics.modis_observations,
    total_viirs: data.statistics.viirs_observations,
    matched_events: data.statistics.matched_pairs,
    modis_only: data.statistics.modis_only,
    viirs_only: data.statistics.viirs_only,
    data_mode: data.is_demo ? 'demo' : 'live',
  };
}

/**
 * Waits until the backend answers /health. Free hosting tiers put idle servers
 * to sleep, so the first request after a pause can take up to a minute.
 * onWait receives the seconds waited so far (after 2 s), and null when done.
 */
export async function waitForBackend(
  onWait: (seconds: number | null) => void,
  timeoutMs = 90000,
  retryMs = 3000
): Promise<void> {
  const start = Date.now();
  const ticker = window.setInterval(() => {
    const s = Math.round((Date.now() - start) / 1000);
    if (s >= 2) onWait(s);
  }, 1000);

  try {
    for (;;) {
      try {
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(`${API_BASE}/health`, { signal: ctrl.signal });
        window.clearTimeout(timer);
        // Must be our JSON health response, not a host's "waking up" HTML page.
        if (res.ok) {
          const body = await res.json().catch(() => null);
          if (body && typeof body.mode === 'string') return;
        }
      } catch {
        // backend not reachable yet - retry below
      }

      if (Date.now() - start >= timeoutMs) {
        throw new Error(
          `The backend at ${API_BASE} did not respond within ${Math.round(timeoutMs / 1000)} seconds.`
        );
      }

      await new Promise((resolve) => window.setTimeout(resolve, retryMs));
    }
  } finally {
    window.clearInterval(ticker);
    onWait(null);
  }
}
interface ObservationStatus {
  observation_id: string;
  status: RawFireObservation['match_status'];
}

type MatchParams = { spatial_radius_km: number; temporal_window_minutes: number };

function matchQuery(params?: MatchParams): string {
  return params
    ? `?radius_km=${params.spatial_radius_km}&window_min=${params.temporal_window_minutes}`
    : '';
}

// Observations with their harmonization status for the given parameters.
// getModis() and getViirs() are usually called together; sharing one in-flight
// request avoids downloading every observation page twice.
let inflightObservations: { key: string; promise: Promise<RawFireObservation[]> } | null = null;

function loadObservations(params?: MatchParams): Promise<RawFireObservation[]> {
  const query = matchQuery(params);
  const key = `${currentRegion}${query}`;
  if (inflightObservations && inflightObservations.key === key) {
    return inflightObservations.promise;
  }

  const promise = (async () => {
    const [fires, statuses] = await Promise.all([
      fetchAllFires(),
      fetchJson<ObservationStatus[]>(`/harmonization/observations${query}`),
    ]);
    const statusById = new Map(statuses.map((s) => [s.observation_id, s.status]));
    return fires.map((fire, i) => ({
      ...convertFire(fire, i),
      match_status: statusById.get(fire.observation_id) ?? 'UNMATCHED',
    }));
  })();

  inflightObservations = { key, promise };
  const clear = () => {
    if (inflightObservations?.promise === promise) inflightObservations = null;
  };
  promise.then(clear, clear);
  return promise;
}

/** Regions the dashboard can switch between (GET /api/regions). */
export interface RegionList {
  mode: 'live' | 'demo';
  default: string;
  regions: { id: string; name: string; bbox: [number, number, number, number] }[];
}

/** Which data the backend is serving for the current region (GET /api/dataset). */
export interface DatasetInfo {
  mode: 'live' | 'demo' | 'demo-fallback';
  region_id: string;
  label: string;
  region: string;
  bbox: [number, number, number, number];
  sources: string[];
  days: number | null;
  first_date: string | null;
  last_date: string | null;
  fetched_at: string | null;
  stale: boolean;
  reason: string | null;
  counts: Record<string, number>;
}

export const api = {
  getRegions: () => fetchJson<RegionList>('/regions'),

  getDataset: () => fetchJson<DatasetInfo>('/dataset'),

  checkHealth: () =>
    fetchJson<{
      status?: string;
      mode: 'demo' | 'live';
      label?: string;
    }>('/health'),

  getStats: async (): Promise<KpiStats> => {
    const data = await fetchJson<HarmonizationResponse>(
      '/harmonization/run'
    );

    return convertStats(data);
  },


getModis: async (params?: MatchParams): Promise<RawFireObservation[]> => {
  const all = await loadObservations(params);
  return all.filter((fire) => fire.sensor === 'MODIS');
},

getViirs: async (params?: MatchParams): Promise<RawFireObservation[]> => {
  const all = await loadObservations(params);
  return all.filter((fire) => fire.sensor === 'VIIRS');
},


  getHarmonized: async (
    params?: { spatial_radius_km: number; temporal_window_minutes: number }
  ): Promise<HarmonizedFireEvent[]> => {
    const query = params
      ? `?radius_km=${params.spatial_radius_km}&window_min=${params.temporal_window_minutes}`
      : '';

    const data = await fetchJson<BackendHarmonizedEvent[]>(
      `/fires/harmonized${query}`
    );

    return data.map(convertHarmonizedEvent);
  },

  
  
  getDataQuality: async (): Promise<DataQualityReport> => {
    const data = await fetchJson<{
      label: string;
      rows: number;
      missing_confidence: number;
      missing_frp: number;
      by_sensor: {
        MODIS: number;
        VIIRS: number;
      };
    }>('/data-quality');

    const totalChecks = data.rows * 3;
    const missingValues =
      data.missing_confidence + data.missing_frp;

    const missingCoordinates = 0;

    const qualityScore =
      totalChecks > 0
        ? Math.max(
            0,
            ((totalChecks - missingValues - missingCoordinates) /
              totalChecks) *
              100
          )
        : 0;

        return {
      total_records: data.rows,
      missing_coordinates: 0,
      quality_score: qualityScore,
    };
  },



  runHarmonization: async (
    params: HarmonizeParams
  ): Promise<KpiStats> => {
    const query = new URLSearchParams({
      radius_km: String(params.spatial_radius_km),
      window_min: String(params.temporal_window_minutes),
    });

    const data = await fetchJson<HarmonizationResponse>(
      `/harmonization/run?${query.toString()}`
    );

    return convertStats(data);
  },
};