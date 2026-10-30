export interface RawFireObservation {
  id: number;
  observation_id: string;
  sensor: 'MODIS' | 'VIIRS';
  satellite: string;
  latitude: number;
  longitude: number;
  acquisition_datetime: string;
  confidence: string;
  frp?: number;
  brightness_temperature?: number;
  source: string;
  match_status: 'UNMATCHED' | 'MATCHED' | 'MODIS_ONLY' | 'VIIRS_ONLY';
}

export interface HarmonizedFireEvent {
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

export interface KpiStats {
  total_modis: number;
  total_viirs: number;
  matched_events: number;
  modis_only: number;
  viirs_only: number;
  data_mode: 'demo' | 'live';
}

export interface HarmonizeParams {
  spatial_radius_km: number;
  temporal_window_minutes: number;
  spatial_weight?: number;
  temporal_weight?: number;
  confidence_weight?: number;
}

export interface DataQualityReport {
  total_records: number;
  missing_coordinates: number;
  quality_score: number;
}

export interface TrendDataPoint {
  date: string;
  MODIS: number;
  VIIRS: number;
  Harmonized: number;
}