import FireMap from './components/FireMap';
import { useState, useEffect, useMemo } from 'react';
import {
  Flame,
  Satellite,
  Layers,
  RefreshCw,
  BarChart3,
  MapPin,
  Database,
  BookOpen,
  AlertCircle,
  Sliders,
  CheckCircle2,
  Info,
  ArrowRight,
  Search,
  ShieldAlert
} from 'lucide-react';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell
} from 'recharts';

import { api, API_BASE } from './services/api';
import {
  KpiStats,
  RawFireObservation,
  HarmonizedFireEvent,
  DataQualityReport
} from './types';

// Tab enum
type TabType =
  | 'overview'
  | 'map'
  | 'harmonization'
  | 'trends'
  | 'data'
  | 'methodology';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [stats, setStats] = useState<KpiStats>({
    total_modis: 0,
    total_viirs: 0,
    matched_events: 0,
    modis_only: 0,
    viirs_only: 0,
    data_mode: 'demo'
  });

  const [modisFires, setModisFires] =
    useState<RawFireObservation[]>([]);

  const [viirsFires, setViirsFires] =
    useState<RawFireObservation[]>([]);

  const [harmonizedEvents, setHarmonizedEvents] =
    useState<HarmonizedFireEvent[]>([]);

  const [dataQuality, setDataQuality] =
    useState<DataQualityReport | null>(null);

  // Configurable Harmonization Parameters
  const [spatialRadius, setSpatialRadius] =
    useState<number>(1.5);

  const [temporalWindow, setTemporalWindow] =
    useState<number>(45);

  const [spatialWeight] =
    useState<number>(0.4);

  const [temporalWeight] =
    useState<number>(0.4);

  const [confidenceWeight] =
    useState<number>(0.2);

  const [isHarmonizing, setIsHarmonizing] =
    useState<boolean>(false);

  // Map Filter States
  const [showModis, setShowModis] =
    useState<boolean>(true);

  const [showViirs, setShowViirs] =
    useState<boolean>(true);

  const [showHarmonized, setShowHarmonized] =
    useState<boolean>(true);

const [selectedHotspot, setSelectedHotspot] =
  useState<any | null>(null);

  // Explorer Filters
  const [searchQuery, setSearchQuery] =
    useState<string>('');

  const [sensorFilter, setSensorFilter] =
    useState<string>('ALL');

  // Load backend data
  const loadAllData = async () => {
    setLoading(true);
    setError(null);

    try {
      const [
        sData,
        mData,
        vData,
        hData,
        qData
      ] = await Promise.all([
        api.getStats(),
        api.getModis(),
        api.getViirs(),
        api.getHarmonized(),
        api.getDataQuality()
      ]);

      setStats(sData);
      setModisFires(mData);
      setViirsFires(vData);
      setHarmonizedEvents(hData);
      setDataQuality(qData);
    } catch (err: any) {
      console.error(
        'Failed to load backend data:',
        err
      );

      setError(
        err.message ||
        `Could not connect to the FastAPI backend at ${API_BASE}`
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Trigger Backend Harmonization Re-calculation
  const handleHarmonize = async () => {
    setIsHarmonizing(true);

    try {
      const updatedStats =
        await api.runHarmonization({
          spatial_radius_km: spatialRadius,
          temporal_window_minutes: temporalWindow,
          spatial_weight: spatialWeight,
          temporal_weight: temporalWeight,
          confidence_weight: confidenceWeight
        });

      setStats(updatedStats);

      const [
        mRefreshed,
        vRefreshed,
        hRefreshed
      ] = await Promise.all([
        api.getModis(),
        api.getViirs(),
        api.getHarmonized()
      ]);

      setModisFires(mRefreshed);
      setViirsFires(vRefreshed);
      setHarmonizedEvents(hRefreshed);
    } catch (err: any) {
      alert(
        'Harmonization failed: ' +
        err.message
      );
    } finally {
      setIsHarmonizing(false);
    }
  };

  // Aggregated trend data for charts
  const trendChartData = useMemo(() => {
    const dates = Array.from(
      new Set([
        ...modisFires.map(f =>
          f.acquisition_datetime.substring(0, 10)
        ),
        ...viirsFires.map(f =>
          f.acquisition_datetime.substring(0, 10)
        )
      ])
    ).sort();

    return dates.map(d => {
      const mCount =
        modisFires.filter(
          f =>
            f.acquisition_datetime.startsWith(d)
        ).length;

      const vCount =
        viirsFires.filter(
          f =>
            f.acquisition_datetime.startsWith(d)
        ).length;

      const hCount =
        harmonizedEvents.filter(
          e =>
            e.event_datetime.startsWith(d)
        ).length;

      return {
        date: d,
        MODIS: mCount,
        VIIRS: vCount,
        Harmonized: hCount
      };
    });
  }, [
    modisFires,
    viirsFires,
    harmonizedEvents
  ]);

  // Combined Data Explorer Items
  const explorerRows = useMemo(() => {
    let rows: any[] = [];

    if (
      sensorFilter === 'ALL' ||
      sensorFilter === 'MODIS'
    ) {
      rows.push(
        ...modisFires.map(m => ({
          ...m,
          type: 'MODIS'
        }))
      );
    }

    if (
      sensorFilter === 'ALL' ||
      sensorFilter === 'VIIRS'
    ) {
      rows.push(
        ...viirsFires.map(v => ({
          ...v,
          type: 'VIIRS'
        }))
      );
    }

    if (
      sensorFilter === 'ALL' ||
      sensorFilter === 'HARMONIZED'
    ) {
      rows.push(
        ...harmonizedEvents.map(h => ({
          id: h.id,
          observation_id: h.event_id,
          sensor: 'HARMONIZED',
          type: 'HARMONIZED',
          latitude: h.latitude,
          longitude: h.longitude,
          acquisition_datetime:
            h.event_datetime,
          confidence:
            `${Math.round(h.mean_confidence)}%`,
          match_status: 'MATCHED_EVENT',
          match_score: h.match_score
        }))
      );
    }

    if (searchQuery.trim()) {
      const q =
        searchQuery.toLowerCase();

      rows = rows.filter(r =>
        r.observation_id
          .toLowerCase()
          .includes(q) ||
        r.sensor
          .toLowerCase()
          .includes(q) ||
        r.latitude
          .toString()
          .includes(q) ||
        r.longitude
          .toString()
          .includes(q)
      );
    }

    return rows;
  }, [
    modisFires,
    viirsFires,
    harmonizedEvents,
    sensorFilter,
    searchQuery
  ]);

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F19] text-slate-100">

      {/* Top Banner for DEMO MODE indicator */}
      {stats.data_mode === 'demo' && (
        <div className="bg-gradient-to-r from-amber-600/30 via-amber-500/20 to-amber-600/30 border-b border-amber-500/40 px-4 py-1.5 text-xs text-amber-200 flex items-center justify-between font-mono">
          <div className="flex items-center space-x-2">
            <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>

            <span className="font-bold tracking-wider uppercase text-amber-400">
              DEMO DATA MODE ACTIVE
            </span>

            <span className="text-amber-300/80 hidden sm:inline">
              — Connect NASA FIRMS API key to enable live operational feed
            </span>
          </div>

          <a
            href="#methodology"
            onClick={() =>
              setActiveTab('methodology')
            }
            className="hover:underline flex items-center space-x-1 text-amber-300"
          >
            <span>
              Read Architecture Specs
            </span>

            <ArrowRight className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Main Header */}
      <header className="border-b border-slate-800 bg-[#0F172A]/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Branding */}
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-gradient-to-br from-amber-500 to-red-600 rounded-lg shadow-lg shadow-red-500/20">
                <Flame className="w-6 h-6 text-slate-950 stroke-[2.5]" />
              </div>

              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-slate-200 to-amber-400 bg-clip-text text-transparent">
                    FIREHARMONIZE
                  </span>

                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700">
                    NASA Space Apps '26
                  </span>
                </div>

                <p className="text-xs text-slate-400 font-mono">
                  MODIS + VIIRS Active Fire Cross-Sensor Intelligence
                </p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="hidden md:flex items-center space-x-1">
              {[
                {
                  id: 'overview',
                  label: 'Overview',
                  icon: BarChart3
                },
                {
                  id: 'map',
                  label: 'Fire Map',
                  icon: MapPin
                },
                {
                  id: 'harmonization',
                  label: 'Harmonization',
                  icon: Sliders
                },
                {
                  id: 'trends',
                  label: 'Historical Trends',
                  icon: Layers
                },
                {
                  id: 'data',
                  label: 'Data Explorer',
                  icon: Database
                },
                {
                  id: 'methodology',
                  label: 'Methodology',
                  icon: BookOpen
                }
              ].map(tab => {
                const Icon = tab.icon;
                const isActive =
                  activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    onClick={() =>
                      setActiveTab(
                        tab.id as TabType
                      )
                    }
                    className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Actions */}
            <div className="flex items-center space-x-3">
              <button
                onClick={loadAllData}
                disabled={loading}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                title="Refresh from FastAPI Backend"
              >
                <RefreshCw
                  className={`w-4 h-4 ${
                    loading
                      ? 'animate-spin text-amber-400'
                      : ''
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />

              <div>
                <p className="font-semibold text-sm">
                  Backend Connection Required
                </p>

                <p className="text-xs text-red-300/80 font-mono">
                  {error}
                </p>
              </div>
            </div>

            <button
              onClick={loadAllData}
              className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 rounded text-xs transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* PAGE 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                {
                  label: 'MODIS Detections',
                  val: stats.total_modis,
                  color: 'text-blue-400',
                  bg: 'bg-blue-500/10 border-blue-500/20'
                },
                {
                  label: 'VIIRS Detections',
                  val: stats.total_viirs,
                  color: 'text-emerald-400',
                  bg: 'bg-emerald-500/10 border-emerald-500/20'
                },
                {
                  label: 'Harmonized Events',
                  val: stats.matched_events,
                  color: 'text-amber-400',
                  bg: 'bg-amber-500/10 border-amber-500/30'
                },
                {
                  label: 'MODIS-Only',
                  val: stats.modis_only,
                  color: 'text-sky-300',
                  bg: 'bg-slate-800/80 border-slate-700'
                },
                {
                  label: 'VIIRS-Only',
                  val: stats.viirs_only,
                  color: 'text-teal-300',
                  bg: 'bg-slate-800/80 border-slate-700'
                },
                {
                  label: 'Quality Index',
                  val: `${dataQuality ? Math.round(dataQuality.quality_score) : 100}%`,
                  color: 'text-purple-400',
                  bg: 'bg-purple-500/10 border-purple-500/20'
                }
              ].map((card, i) => (
                <div
                  key={i}
                  className={`p-4 rounded-xl border ${card.bg} flex flex-col justify-between`}
                >
                  <p className="text-[11px] text-slate-400 font-medium">
                    {card.label}
                  </p>

                  <p
                    className={`text-2xl font-bold font-mono mt-2 ${card.color}`}
                  >
                    {loading ? '...' : card.val}
                  </p>
                </div>
              ))}
            </div>

            {/* Why Harmonization Matters Section */}
            <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-800 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                <Satellite className="w-64 h-64 text-amber-400" />
              </div>

              <div className="relative z-10 max-w-3xl">
                <div className="flex items-center space-x-2 text-amber-400 text-xs font-mono uppercase tracking-wider mb-2">
                  <ShieldAlert className="w-4 h-4" />
                  <span>
                    Scientific Grounding & Anti-Distortion
                  </span>
                </div>

                <h2 className="text-xl font-bold text-white mb-3">
                  Why Satellite Hotspot Observations Cannot Simply Be Merged
                </h2>

                <p className="text-slate-300 text-sm leading-relaxed mb-4">
                  MODIS (Aqua/Terra) produces a spatial pixel footprint of <strong>1000m</strong>, while VIIRS (S-NPP/NOAA-20) captures active fires at <strong>375m spatial resolution</strong>. VIIRS triggers detections at much lower brightness temperatures and smaller fire fractions than MODIS. Simple concatenation leads to double-counting and false historical trends.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-center text-xs font-mono py-3 my-2 border-y border-slate-800">
                  <div className="p-2 rounded bg-blue-950/60 border border-blue-800/50 text-blue-300">
                    MODIS (1km)
                  </div>

                  <div className="flex items-center justify-center text-slate-500">
                    →
                  </div>

                  <div className="p-2 rounded bg-amber-950/80 border border-amber-600/50 text-amber-300 font-bold glow-amber">
                    Harmonization Engine
                  </div>

                  <div className="flex items-center justify-center text-slate-500">
                    →
                  </div>

                  <div className="p-2 rounded bg-emerald-950/60 border border-emerald-800/50 text-emerald-300">
                    VIIRS (375m)
                  </div>
                </div>

                <div className="flex items-center space-x-4 pt-2">
                  <button
                    onClick={() =>
                      setActiveTab('harmonization')
                    }
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-lg text-xs transition flex items-center space-x-1.5 shadow-lg shadow-amber-500/20"
                  >
                    <span>
                      Configure Engine Parameters
                    </span>

                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() =>
                      setActiveTab('methodology')
                    }
                    className="text-xs text-slate-400 hover:text-slate-200 underline"
                  >
                    Read Methodology
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Chart + Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900/80 border border-slate-800">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                    <BarChart3 className="w-4 h-4 text-amber-400" />
                    <span>
                      Observation Count Timeline (MODIS vs VIIRS vs Harmonized)
                    </span>
                  </h3>

                  <span className="text-xs font-mono text-slate-500">
                    Backend Synced
                  </span>
                </div>

                <div className="h-64 w-full">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <AreaChart data={trendChartData}>
                      <defs>
                        <linearGradient
                          id="modisGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#3B82F6"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#3B82F6"
                            stopOpacity={0}
                          />
                        </linearGradient>

                        <linearGradient
                          id="viirsGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#10B981"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#10B981"
                            stopOpacity={0}
                          />
                        </linearGradient>

                        <linearGradient
                          id="harmGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#F59E0B"
                            stopOpacity={0.6}
                          />
                          <stop
                            offset="95%"
                            stopColor="#F59E0B"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>

                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#1F2937"
                      />

                      <XAxis
                        dataKey="date"
                        stroke="#6B7280"
                        tick={{ fontSize: 11 }}
                      />

                      <YAxis
                        stroke="#6B7280"
                        tick={{ fontSize: 11 }}
                      />

                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#111827',
                          borderColor: '#374151',
                          borderRadius: '8px',
                          fontSize: '12px'
                        }}
                      />

                      <Legend
                        wrapperStyle={{
                          fontSize: '11px',
                          paddingTop: '10px'
                        }}
                      />

                      <Area
                        type="monotone"
                        dataKey="MODIS"
                        stroke="#3B82F6"
                        fillOpacity={1}
                        fill="url(#modisGrad)"
                      />

                      <Area
                        type="monotone"
                        dataKey="VIIRS"
                        stroke="#10B981"
                        fillOpacity={1}
                        fill="url(#viirsGrad)"
                      />

                      <Area
                        type="monotone"
                        dataKey="Harmonized"
                        stroke="#F59E0B"
                        fillOpacity={1}
                        fill="url(#harmGrad)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800">
                <h3 className="text-sm font-bold text-white mb-4">
                  Harmonization Summary
                </h3>

                <div className="h-48">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <PieChart>
                      <Pie
                        data={[
                          {
                            name: 'Matched',
                            value: stats.matched_events
                          },
                          {
                            name: 'MODIS Only',
                            value: stats.modis_only
                          },
                          {
                            name: 'VIIRS Only',
                            value: stats.viirs_only
                          }
                        ]}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={65}
                        innerRadius={38}
                      >
                        <Cell fill="#F59E0B" />
                        <Cell fill="#3B82F6" />
                        <Cell fill="#10B981" />
                      </Pie>

                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#111827',
                          borderColor: '#374151',
                          borderRadius: '8px'
                        }}
                      />

                      <Legend
                        wrapperStyle={{
                          fontSize: '10px'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PAGE 2: MAP */}
        {activeTab === 'map' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white">
                    Cross-Sensor Fire Observation Map
                  </h3>

                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setShowModis(!showModis)
                      }
                      className={`px-3 py-1.5 rounded text-xs font-mono border ${
                        showModis
                          ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                          : 'bg-slate-800 border-slate-700 text-slate-500'
                      }`}
                    >
                      MODIS
                    </button>

                    <button
                      onClick={() =>
                        setShowViirs(!showViirs)
                      }
                      className={`px-3 py-1.5 rounded text-xs font-mono border ${
                        showViirs
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-800 border-slate-700 text-slate-500'
                      }`}
                    >
                      VIIRS
                    </button>

                    <button
                      onClick={() =>
                        setShowHarmonized(
                          !showHarmonized
                        )
                      }
                      className={`px-3 py-1.5 rounded text-xs font-mono border ${
                        showHarmonized
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'bg-slate-800 border-slate-700 text-slate-500'
                      }`}
                    >
                      Harmonized
                    </button>
                  </div>
                </div>

                <div className="relative h-[520px] rounded-xl overflow-hidden bg-[#0d131f] border border-slate-800">

                  <div className="absolute inset-0 opacity-20">
                    <div
                      className="w-full h-full"
                      style={{
                        backgroundImage:
                          'linear-gradient(rgba(100,116,139,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(100,116,139,0.15) 1px, transparent 1px)',
                        backgroundSize:
                          '40px 40px'
                      }}
                    />
                  </div>

                  
<FireMap
  modisFires={modisFires}
  viirsFires={viirsFires}
  harmonizedEvents={harmonizedEvents}
  showModis={showModis}
  showViirs={showViirs}
  showHarmonized={showHarmonized}
  onSelect={(item, sensorType) =>
  setSelectedHotspot({ ...item, sensorType })
}
/>


                  {/* Map Labels */}
                  <div className="absolute top-3 left-3 px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-800 text-[10px] font-mono text-slate-400 backdrop-blur">
                    <div className="text-amber-400 font-bold mb-1">
                      DEMO SPATIAL VIEW
                    </div>
                    <div>
                      Northern Hemisphere Active Fire Region
                    </div>
                  </div>

                  <div className="absolute bottom-4 left-4 p-3 rounded-lg bg-slate-900/90 border border-slate-800 text-xs font-mono space-y-1.5 backdrop-blur">
                    <div className="flex items-center space-x-2">
                      <span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span>
                      <span>
                        MODIS Observation (1km)
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
                      <span>
                        VIIRS Observation (375m)
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="w-3 h-3 rounded-full bg-amber-400 border border-slate-900 inline-block"></span>
                      <span>
                        Harmonized Event
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Hotspot Inspector Panel */}
              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white mb-4 pb-2 border-b border-slate-800 flex items-center space-x-2">
                    <Info className="w-4 h-4 text-amber-400" />
                    <span>
                      Observation Inspector
                    </span>
                  </h3>

                  {selectedHotspot ? (
                    <div className="space-y-3 text-xs font-mono">

                      <div className="p-2.5 rounded-lg bg-slate-800/80 border border-slate-700">
                        <span className="text-slate-400 block text-[10px]">
                          SENSOR / EVENT TYPE
                        </span>

                        <span className="text-sm font-bold text-amber-400">
                          {selectedHotspot.sensorType ||
                            selectedHotspot.sensor}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 rounded bg-slate-800/50">
                          <span className="text-slate-500 text-[10px] block">
                            LATITUDE
                          </span>

                          <span className="text-slate-200">
                            {Number(
                              selectedHotspot.latitude
                            ).toFixed(4)}
                            °
                          </span>
                        </div>

                        <div className="p-2 rounded bg-slate-800/50">
                          <span className="text-slate-500 text-[10px] block">
                            LONGITUDE
                          </span>

                          <span className="text-slate-200">
                            {Number(
                              selectedHotspot.longitude
                            ).toFixed(4)}
                            °
                          </span>
                        </div>
                      </div>

                      <div className="p-2 rounded bg-slate-800/50">
                        <span className="text-slate-500 text-[10px] block">
                          DATE / TIME (UTC)
                        </span>

                        <span className="text-slate-200">
                          {selectedHotspot.acquisition_datetime ||
                            selectedHotspot.event_datetime}
                        </span>
                      </div>

                      <div className="p-2 rounded bg-slate-800/50">
                        <span className="text-slate-500 text-[10px] block">
                          CONFIDENCE
                        </span>

                        <span className="text-slate-200">
                          {selectedHotspot.confidence ||
                            `${Math.round(
                              selectedHotspot.mean_confidence
                            )}%`}
                        </span>
                      </div>

                      {selectedHotspot.match_score && (
                        <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
                          <span className="text-[10px] block text-amber-400/80">
                            MATCH SCORE
                          </span>

                          <span className="text-base font-bold">
                            {selectedHotspot.match_score}%
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-slate-500 text-xs">
                      Select any hotspot point on the map to inspect scientific metadata.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PAGE 3: HARMONIZATION ENGINE */}
        {activeTab === 'harmonization' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Controls Form */}
              <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-5">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center space-x-2">
                    <Sliders className="w-5 h-5 text-amber-400" />
                    <span>
                      Engine Control Panel
                    </span>
                  </h3>

                  <p className="text-xs text-slate-400 mt-1">
                    Adjust spatio-temporal matching criteria and trigger FastAPI recalculation.
                  </p>
                </div>

                {/* Spatial Radius Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-mono">
                    <label className="text-slate-300">
                      Spatial Match Radius
                    </label>

                    <span className="text-amber-400 font-bold">
                      {spatialRadius} km
                    </span>
                  </div>

                  <input
                    type="range"
                    min="0.5"
                    max="5.0"
                    step="0.1"
                    value={spatialRadius}
                    onChange={e =>
                      setSpatialRadius(
                        parseFloat(e.target.value)
                      )
                    }
                    className="w-full accent-amber-500 bg-slate-800 rounded-lg cursor-pointer"
                  />

                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>
                      0.5 km (Strict)
                    </span>

                    <span>
                      5.0 km (Broad)
                    </span>
                  </div>
                </div>

                {/* Temporal Window Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-mono">
                    <label className="text-slate-300">
                      Temporal Window
                    </label>

                    <span className="text-amber-400 font-bold">
                      {temporalWindow} min
                    </span>
                  </div>

                  <input
                    type="range"
                    min="10"
                    max="120"
                    step="5"
                    value={temporalWindow}
                    onChange={e =>
                      setTemporalWindow(
                        parseInt(e.target.value)
                      )
                    }
                    className="w-full accent-amber-500 bg-slate-800 rounded-lg cursor-pointer"
                  />

                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>
                      10 mins
                    </span>

                    <span>
                      120 mins
                    </span>
                  </div>
                </div>

                {/* Multi-weight Config */}
                <div className="pt-3 border-t border-slate-800 space-y-3">
                  <span className="text-xs font-mono text-slate-400 block font-bold">
                    Scoring Weight Distribution
                  </span>

                  <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-mono">
                    <div className="p-2 rounded bg-slate-800 border border-slate-700">
                      <span className="block text-slate-400">
                        Spatial
                      </span>

                      <span className="text-amber-400 font-bold">
                        {(spatialWeight * 100).toFixed(0)}%
                      </span>
                    </div>

                    <div className="p-2 rounded bg-slate-800 border border-slate-700">
                      <span className="block text-slate-400">
                        Temporal
                      </span>

                      <span className="text-amber-400 font-bold">
                        {(temporalWeight * 100).toFixed(0)}%
                      </span>
                    </div>

                    <div className="p-2 rounded bg-slate-800 border border-slate-700">
                      <span className="block text-slate-400">
                        Confidence
                      </span>

                      <span className="text-amber-400 font-bold">
                        {(confidenceWeight * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleHarmonize}
                  disabled={isHarmonizing}
                  className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center justify-center space-x-2 text-sm"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${
                      isHarmonizing
                        ? 'animate-spin'
                        : ''
                    }`}
                  />

                  <span>
                    {isHarmonizing
                      ? 'Running Python Engine...'
                      : 'Run Harmonization Engine'}
                  </span>
                </button>
              </div>

              {/* Matched Results Table */}
              <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-white flex items-center space-x-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />

                      <span>
                        Harmonized Events Output ({harmonizedEvents.length})
                      </span>
                    </h3>

                    <span className="text-xs font-mono px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                      Method: Application-Derived V1
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                        <tr>
                          <th className="p-2.5">
                            Event ID
                          </th>

                          <th className="p-2.5">
                            Coordinates
                          </th>

                          <th className="p-2.5">
                            Date / Time
                          </th>

                          <th className="p-2.5">
                            Mean Conf
                          </th>

                          <th className="p-2.5 text-right">
                            Match Score
                          </th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-800/60">
                        {harmonizedEvents
                          .slice(0, 8)
                          .map(evt => (
                            <tr
                              key={evt.id}
                              className="hover:bg-slate-800/40 text-slate-300"
                            >
                              <td className="p-2.5 font-bold text-amber-400">
                                {evt.event_id}
                              </td>

                              <td className="p-2.5">
                                {evt.latitude.toFixed(3)}°,{' '}
                                {evt.longitude.toFixed(3)}°
                              </td>

                              <td className="p-2.5">
                                {evt.event_datetime.replace(
                                  'T',
                                  ' '
                                )}
                              </td>

                              <td className="p-2.5">
                                {Math.round(
                                  evt.mean_confidence
                                )}%
                              </td>

                              <td className="p-2.5 text-right font-bold text-emerald-400">
                                {evt.match_score}%
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 mt-4 border-t border-slate-800 pt-3">
                  * Parameters are application-configurable parameters for demonstration and cross-sensor evaluation.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* PAGE 4: HISTORICAL TRENDS */}
        {activeTab === 'trends' && (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
              <h3 className="text-base font-bold text-white mb-4 flex items-center space-x-2">
                <BarChart3 className="w-5 h-5 text-amber-400" />

                <span>
                  Daily Activity Comparison (MODIS vs VIIRS vs Harmonized)
                </span>
              </h3>

              <div className="h-80 w-full">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >
                  <BarChart data={trendChartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#1F2937"
                    />

                    <XAxis
                      dataKey="date"
                      stroke="#6B7280"
                      tick={{ fontSize: 11 }}
                    />

                    <YAxis
                      stroke="#6B7280"
                      tick={{ fontSize: 11 }}
                    />

                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#111827',
                        borderColor: '#374151',
                        borderRadius: '8px'
                      }}
                    />

                    <Legend />

                    <Bar
                      dataKey="MODIS"
                      fill="#3B82F6"
                    />

                    <Bar
                      dataKey="VIIRS"
                      fill="#10B981"
                    />

                    <Bar
                      dataKey="Harmonized"
                      fill="#F59E0B"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* PAGE 5: DATA EXPLORER */}
        {activeTab === 'data' && (
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />

                  <input
                    type="text"
                    placeholder="Search by ID or Coords..."
                    value={searchQuery}
                    onChange={e =>
                      setSearchQuery(
                        e.target.value
                      )
                    }
                    className="pl-9 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono w-64"
                  />
                </div>

                <select
                  value={sensorFilter}
                  onChange={e =>
                    setSensorFilter(
                      e.target.value
                    )
                  }
                  className="py-2 px-3 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 font-mono"
                >
                  <option value="ALL">
                    All Sources
                  </option>

                  <option value="MODIS">
                    MODIS Only
                  </option>

                  <option value="VIIRS">
                    VIIRS Only
                  </option>

                  <option value="HARMONIZED">
                    Harmonized Events
                  </option>
                </select>
              </div>

              <div className="text-xs font-mono text-slate-400">
                Showing {explorerRows.length} records
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-800/80 text-slate-400 uppercase text-[10px]">
                  <tr>
                    <th className="p-3">
                      ID / Code
                    </th>

                    <th className="p-3">
                      Source Sensor
                    </th>

                    <th className="p-3">
                      Latitude
                    </th>

                    <th className="p-3">
                      Longitude
                    </th>

                    <th className="p-3">
                      Acquisition UTC
                    </th>

                    <th className="p-3">
                      Confidence
                    </th>

                    <th className="p-3">
                      Status
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800/60">
                  {explorerRows.map(
                    (row, idx) => (
                      <tr
                        key={idx}
                        className="hover:bg-slate-800/40 text-slate-300"
                      >
                        <td className="p-3 font-bold text-amber-400">
                          {row.observation_id}
                        </td>

                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              row.sensor ===
                              'MODIS'
                                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                : row.sensor ===
                                  'VIIRS'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {row.sensor}
                          </span>
                        </td>

                        <td className="p-3">
                          {Number(
                            row.latitude
                          ).toFixed(4)}
                          °
                        </td>

                        <td className="p-3">
                          {Number(
                            row.longitude
                          ).toFixed(4)}
                          °
                        </td>

                        <td className="p-3">
                          {row.acquisition_datetime}
                        </td>

                        <td className="p-3">
                          {row.confidence}
                        </td>

                        <td className="p-3">
                          <span className="text-slate-400">
                            {row.match_status ||
                              'READY'}
                          </span>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* PAGE 6: METHODOLOGY */}
        {activeTab === 'methodology' && (
          <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 space-y-6 max-w-4xl mx-auto">
            <h2 className="text-2xl font-extrabold text-white">
              Scientific Methodology & Architecture
            </h2>

            <div className="space-y-4 text-sm text-slate-300 leading-relaxed">

              <section className="space-y-2">
                <h3 className="text-lg font-bold text-amber-400">
                  1. MODIS vs VIIRS Sensor Divergence
                </h3>

                <p>
                  MODIS (Moderate Resolution Imaging Spectroradiometer) on NASA's Terra and Aqua satellites measures active fires using 1km spatial pixels. VIIRS (Visible Infrared Imaging Radiometer Suite) on S-NPP and NOAA satellites provides 375m spatial resolution. Due to higher pixel density and detection sensitivity, VIIRS detects significantly smaller and cooler fires than MODIS.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-lg font-bold text-amber-400">
                  2. Spatio-Temporal Match Score Algorithm
                </h3>

                <p>
                  The application calculates an application-derived match score using a weighted combination of spatial proximity (Haversine formula), temporal interval, and normalized confidence:
                </p>

                <div className="p-4 rounded-xl bg-slate-950 font-mono text-xs text-amber-300 border border-slate-800">
                  Match Score = (0.4 × Spatial Score) + (0.4 × Temporal Score) + (0.2 × Confidence Score)
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-lg font-bold text-amber-400">
                  3. Scientific Disclaimer & Attribution
                </h3>

                <p>
                  This application was developed for the NASA Space Apps Challenge 2026. Data originates from NASA FIRMS (Fire Information for Resource Management System). Harmonized event groupings represent application-derived prototype outputs and should be interpreted as scientific demonstration models.
                </p>
              </section>

            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-[#0B0F19] py-6 mt-12 text-center text-xs text-slate-500 font-mono">
        <p>
          FIREHARMONIZE — NASA Space Apps Challenge 2026 | MODIS + VIIRS Harmonization Engine
        </p>
      </footer>
    </div>
  );
}