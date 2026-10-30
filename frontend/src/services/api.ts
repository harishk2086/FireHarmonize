import {
  KpiStats,
  RawFireObservation,
  HarmonizedFireEvent,
  HarmonizeParams,
  DataQualityReport,
} from '../types';

const API_BASE = '/api';

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

async function fetchJson<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
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
  const pageSize = 100;

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

export const api = {
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


getModis: async (): Promise<RawFireObservation[]> => {
  const fires = await fetchAllFires();

  return fires
    .filter((fire) => fire.sensor === 'MODIS')
    .map(convertFire);
},

getViirs: async (): Promise<RawFireObservation[]> => {
  const fires = await fetchAllFires();

  return fires
    .filter((fire) => fire.sensor === 'VIIRS')
    .map(convertFire);
},


  getHarmonized: async (): Promise<HarmonizedFireEvent[]> => {
    const data = await fetchJson<BackendHarmonizedEvent[]>(
      '/fires/harmonized'
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