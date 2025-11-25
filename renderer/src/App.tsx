import { useEffect, useRef, useState } from 'react';
import maplibregl, { type LayerSpecification, type Map as MapLibreInstance, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Activity, ArrowUp, Bot, CheckCircle2, Clock, Droplets, Eye, EyeOff, Gauge, Layers, 
  LineChart, Map as MapIcon, Mountain, Menu, MoveRight, Navigation, ShieldAlert, 
  ShieldCheck, Target, Thermometer, ThermometerSnowflake, ThermometerSun, Tornado, 
  TrendingUp, Waves, Wind, X
} from 'lucide-react';

// --- TYPES ---
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'ALERT';

interface ChartConfig {
  title: string; unit: string; data: number[]; thresholds: number[];
}
interface Assessment {
  id: number; location: string; level: RiskLevel; desc: string; time: string; coords: [number, number];
}
interface LayerVisibility {
  storm: boolean; stormDir: boolean; wind: boolean; heat: boolean; cold: boolean;
  river: boolean; flow: boolean; waterLevel: boolean; tides: boolean; surge: boolean; elevation: boolean;
}
interface RiskZone {
  id: string; name: string; level: RiskLevel; description: string; coordinates: [number, number][][];
}

// --- CONFIG: SỬ DỤNG OPENSTREETMAP (OSM) ĐỂ ĐẢM BẢO HIỂN THỊ ---
const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap Contributors'
    }
  },
  layers: [
    {
      id: 'osm-layer',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: 19
    }
  ]
} as StyleSpecification;

// --- DATA MẪU ---
const getRiskColor = (level: RiskLevel) => {
  switch (level) {
    case 'LOW': return '#10B981'; case 'MEDIUM': return '#F59E0B';
    case 'HIGH': return '#EF4444'; case 'ALERT': return '#7F1D1D'; default: return '#3B82F6';
  }
};
const getPointColor = (value: number, thresholds?: number[]) => {
  if (!thresholds) return '#3B82F6';
  if (value >= thresholds[2]) return '#EF4444';
  if (value >= thresholds[1]) return '#F97316';
  if (value >= thresholds[0]) return '#EAB308';
  return '#3B82F6';
};

const MOCK_CHARTS: Record<string, ChartConfig> = {
  WIND: { title: 'Tốc độ gió', unit: 'km/h', data: [10, 12, 11, 13, 15, 18, 16, 25, 35, 42], thresholds: [15, 25, 40] },
  TEMP: { title: 'Nhiệt độ', unit: '°C', data: [28, 29, 30, 31, 32, 31, 30, 29, 28, 27], thresholds: [30, 35, 38] },
  SURGE: { title: 'Nước dâng', unit: 'm', data: [0.5, 0.6, 0.8, 1.2, 1.5, 1.8, 2.0, 2.2, 2.4, 2.5], thresholds: [1.0, 2.0, 2.8] },
  PRESSURE: { title: 'Áp suất', unit: 'hPa', data: [1000, 998, 996, 994, 992, 990, 988, 986, 990, 995], thresholds: [990, 980, 970] }
};
type MetricKey = keyof typeof MOCK_CHARTS;

const BASE_RISK_ZONES: RiskZone[] = [
  { id: 'central-vn', name: 'Đà Nẵng', level: 'HIGH', description: 'Khu vực chịu ảnh hưởng bão', coordinates: [] }
];

const DASHBOARD_OFFSET = 12;
const DASHBOARD_WIDTH = 360;
const SCREEN_MARGIN = 24;

const SafeWaveApp = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreInstance | null>(null);
  
  const [isLoaded, setIsLoaded] = useState(false);
  const [inputLocation, setInputLocation] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(true);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);
  const [isAIConsoleOpen, setIsAIConsoleOpen] = useState(true);
  
  const [dashboardInfo, setDashboardInfo] = useState({ location: 'Vietnam', coordinates: '-', status: 'Monitoring' });
  const [activeStorm] = useState({ name: 'BÃO SỐ 4 (NORU)', speed: '145 km/h', direction: 'Tây Tây Bắc', coords: [111.5, 16.2] as [number, number] });
  
  const [layers, setLayers] = useState<LayerVisibility>({
    storm: true, stormDir: true, wind: false, heat: false, cold: false,
    river: true, flow: false, waterLevel: false, tides: false, surge: false, elevation: false
  });

  // --- MAP INITIALIZATION ---
  useEffect(() => {
    if (mapRef.current) return; // Guard clause
    if (!mapContainerRef.current) return;

    // Khởi tạo map
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [108.2, 16.0],
      zoom: 5,
      attributionControl: true
    });

    mapRef.current = map;

    map.on('load', () => {
      // Thêm các layer ảo mô phỏng bão
      map.addSource('storm-eye', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: activeStorm.coords } }
      });
      map.addLayer({
        id: 'storm-eye-circle',
        type: 'circle',
        source: 'storm-eye',
        paint: { 'circle-radius': 40, 'circle-color': '#EF4444', 'circle-opacity': 0.6, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
      });

      map.addSource('storm-path', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [activeStorm.coords, [107.5, 17.5], [105.0, 19.0]] } }
      });
      map.addLayer({
        id: 'storm-path-line',
        type: 'line',
        source: 'storm-path',
        paint: { 'line-color': '#FCA5A5', 'line-width': 4, 'line-dasharray': [2, 1] }
      });

      setIsLoaded(true);
      map.resize(); // Quan trọng: Buộc map vẽ lại kích thước
    });

    // Handle Click
    map.on('click', (e) => {
        const { lng, lat } = e.lngLat;
        const coordsText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        setInputLocation(coordsText);
        setDashboardInfo({ location: 'Vị trí đã chọn', coordinates: coordsText, status: 'Selected' });
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(`<div style="color:black; padding:5px;">${coordsText}</div>`)
          .addTo(map);
    });

  }, []);

  // --- RESIZE HANDLER ---
  useEffect(() => {
    if (!mapRef.current) return;
    const timeout = setTimeout(() => {
      mapRef.current?.resize();
    }, 300);
    return () => clearTimeout(timeout);
  }, [isDashboardOpen, isAIConsoleOpen]);

  // --- TOGGLE LAYERS ---
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;
    const toggle = (id: string, visible: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    };
    toggle('storm-eye-circle', layers.storm);
    toggle('storm-path-line', layers.stormDir);
  }, [layers, isLoaded]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    await new Promise(r => setTimeout(r, 1500));
    setAnalyzing(false);
    setDashboardInfo(prev => ({ ...prev, status: 'Gemma Verified' }));
  };

  // --- UI COMPONENTS ---
  const renderChartModal = () => {
    if (!selectedMetric) return null;
    const config = MOCK_CHARTS[selectedMetric];
    return (
        <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <div className="bg-[#1A1C23] p-6 rounded-2xl w-full max-w-lg border border-gray-700 relative">
                <button onClick={() => setSelectedMetric(null)} className="absolute top-4 right-4 text-white"><X /></button>
                <h3 className="text-xl font-bold text-white mb-4">{config.title}</h3>
                <div className="h-40 flex items-end gap-2 border-b border-gray-600 pb-2">
                    {config.data.map((val, i) => (
                        <div key={i} className="bg-blue-500 flex-1 hover:bg-blue-400 transition-all relative group" style={{ height: `${(val/Math.max(...config.data))*100}%` }}>
                           <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] bg-black text-white px-1 rounded opacity-0 group-hover:opacity-100">{val}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
  };

  return (
    <div className="relative w-full h-screen bg-gray-900 text-slate-200 overflow-hidden font-sans">
      <style>{`
        .storm-pulse { animation: pulse-red 2s infinite; }
        @keyframes pulse-red { 0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.65); } 70% { box-shadow: 0 0 0 14px rgba(239,68,68,0); } 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); } }
      `}</style>

      {renderChartModal()}

      {/* --- MAP CONTAINER --- */}
      <div className="absolute inset-0 z-0">
        <div ref={mapContainerRef} className="w-full h-full bg-gray-200" />
      </div>

      {/* --- DASHBOARD --- */}
      {isDashboardOpen ? (
        <div className="absolute top-6 left-12 w-[360px] z-30 flex flex-col gap-4" style={{ height: 'calc(100vh - 48px)' }}>
          <div className="flex justify-end">
             <button onClick={() => setIsDashboardOpen(false)} className="bg-black/50 p-2 rounded-full text-white"><X size={16} /></button>
          </div>
          <div className="flex-1 bg-[#111217]/95 backdrop-blur-xl border border-gray-800/60 rounded-3xl shadow-2xl p-4 overflow-y-auto custom-scrollbar">
            <div className="relative rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-900/30 to-transparent p-4 mb-4 cursor-pointer" onClick={() => setSelectedMetric('SURGE')}>
               <div className="flex items-center gap-2 text-xs text-red-400 font-semibold uppercase">
                  <span className="w-2 h-2 rounded-full bg-red-500 storm-pulse" /> LIVE TRACKING
               </div>
               <h3 className="text-2xl font-bold text-white mt-2">{activeStorm.name}</h3>
               <p className="text-sm text-gray-300 mt-1">{activeStorm.speed} - {activeStorm.direction}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(MOCK_CHARTS).map(([key, config]) => (
                 <div key={key} className="bg-white/5 p-3 rounded-xl border border-white/10 hover:bg-white/10 transition cursor-pointer" onClick={() => setSelectedMetric(key as MetricKey)}>
                    <p className="text-xs text-gray-400">{config.title}</p>
                    <p className="text-lg font-bold text-white mt-1">{config.data[config.data.length-1]} {config.unit}</p>
                 </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <button onClick={() => setIsDashboardOpen(true)} className="absolute top-6 left-12 z-30 bg-[#0b0f16]/80 text-white px-4 py-2 rounded-2xl flex items-center gap-2 shadow-lg">
          <Menu size={14} /> Dashboard
        </button>
      )}

      {/* --- AI CONSOLE --- */}
      {isAIConsoleOpen && (
        <div className="absolute top-6 right-6 w-[320px] z-30 bg-[#0b0f16]/90 backdrop-blur border border-white/10 rounded-3xl shadow-2xl p-4">
          <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
            <div className="flex items-center gap-2"><ShieldCheck className="text-blue-500" size={18} /><span className="font-bold text-sm text-white">Gemma Analyst</span></div>
            <button onClick={() => setIsAIConsoleOpen(false)}><X size={14} className="text-gray-500" /></button>
          </div>
          <div className="mb-3">
              <input type="text" value={inputLocation} onChange={e => setInputLocation(e.target.value)} placeholder="Nhập tọa độ..." className="w-full bg-black/50 border border-gray-700 rounded p-2 text-sm" />
          </div>
          <button onClick={handleAnalyze} disabled={analyzing} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded text-sm flex justify-center items-center gap-2">
             {analyzing ? <Activity className="animate-spin" size={14}/> : <Bot size={14}/>} {analyzing ? 'Analyzing...' : 'Ask AI'}
          </button>
          <div className="mt-4 p-2 bg-white/5 rounded text-xs text-gray-400">
             Status: {dashboardInfo.status}
          </div>
        </div>
      )}
    </div>
  );
};

export default SafeWaveApp;