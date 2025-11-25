import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreInstance, type StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Activity,
  CheckCircle2,
  Clock,
  Droplets,
  Eye,
  EyeOff,
  Gauge,
  Layers,
  LineChart,
  MoveRight,
  Navigation,
  ShieldAlert,
  ShieldCheck,
  Target,
  Thermometer,
  ThermometerSnowflake,
  ThermometerSun,
  Tornado,
  Waves,
  Wind,
  X
} from 'lucide-react';

// --- TYPES & INTERFACES ---
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'ALERT';

interface ChartConfig { title: string; unit: string; data: number[]; thresholds: number[]; }
interface Assessment { id: number; location: string; level: RiskLevel; desc: string; time: string; coords: [number, number]; }
interface LayerVisibility { storm: boolean; stormDir: boolean; wind: boolean; heat: boolean; cold: boolean; river: boolean; flow: boolean; waterLevel: boolean; tides: boolean; surge: boolean; elevation: boolean; }
interface RiskZone { id: string; name: string; level: RiskLevel; description: string; coordinates: [number, number][][]; }

// --- 1. SỬ DỤNG STYLE OPENSTREETMAP (OSM) ĐỂ KHẮC PHỤC LỖI KHÔNG HIỂN THỊ ---
// Link Esri cũ bị chặn CORS/Key, dùng cái này đảm bảo lên hình 100%
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

const RIVERS_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson';

const getRiskColor = (level: RiskLevel) => {
  switch (level) {
    case 'LOW': return '#10B981';
    case 'MEDIUM': return '#F59E0B';
    case 'HIGH': return '#EF4444';
    case 'ALERT': return '#7F1D1D';
    default: return '#3B82F6';
  }
};

const MOCK_CHARTS: Record<string, ChartConfig> = {
  WIND: { title: 'Tốc độ gió (24h qua)', unit: 'km/h', data: [10, 12, 11, 13, 15, 18, 16, 25, 35, 42], thresholds: [15, 25, 40] },
  TEMP: { title: 'Nhiệt độ (24h qua)', unit: '°C', data: [24, 25, 26, 28, 32, 36, 38, 36, 32, 28], thresholds: [30, 35, 38] },
  PRESSURE: { title: 'Áp suất khí quyển', unit: 'hPa', data: [1002, 1000, 998, 996, 995, 990, 985, 990, 995, 1000], thresholds: [995, 990, 985] }
};
type MetricKey = keyof typeof MOCK_CHARTS;

const BASE_RISK_ZONES: RiskZone[] = [
  {
    id: 'central-vn',
    name: 'Quảng Nam - Đà Nẵng',
    level: 'HIGH',
    description: 'Địa hình trung du ven biển, nguy cơ ngập và sạt lở do bão.',
    coordinates: [[[107.8, 15.0], [108.8, 15.0], [108.8, 16.3], [107.8, 16.3], [107.8, 15.0]]]
  }
];

const getPointColor = (value: number, thresholds?: number[]) => {
  if (!thresholds) return '#3B82F6';
  if (value >= thresholds[2]) return '#EF4444';
  if (value >= thresholds[1]) return '#F97316';
  if (value >= thresholds[0]) return '#EAB308';
  return '#3B82F6';
};

const buildRiskGeoJson = (zones: RiskZone[]): FeatureCollection<Polygon> => ({
  type: 'FeatureCollection',
  features: zones.map((zone): Feature<Polygon> => ({
      type: 'Feature',
      properties: { name: zone.name, level: zone.level, color: getRiskColor(zone.level), description: zone.description },
      geometry: { type: 'Polygon', coordinates: zone.coordinates }
    }))
});

const AI_PANEL_WIDTH = 360;
const AI_TOGGLE_WIDTH = 120;
const SCREEN_MARGIN = 24;
const PANEL_GAP = 16;

const SafeWaveApp = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreInstance | null>(null);
  
  const [isLoaded, setIsLoaded] = useState(false);
  const [inputLocation, setInputLocation] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [isLayerManagerOpen, setIsLayerManagerOpen] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);
  const [isAIConsoleOpen, setIsAIConsoleOpen] = useState(true);
  const [riskZones, setRiskZones] = useState<RiskZone[]>(BASE_RISK_ZONES);

  const [layers, setLayers] = useState<LayerVisibility>({
    storm: true, stormDir: true, wind: false, heat: false, cold: false, river: false, flow: false, waterLevel: false, tides: false, surge: false, elevation: false
  });

  const [dashboardInfo, setDashboardInfo] = useState({ location: 'Vietnam', coordinates: '-', status: 'Monitoring' });

  const [activeStorm] = useState({
    name: 'BÃO SỐ 4 (NORU)', speed: '145 km/h', direction: 'Tây Tây Bắc', level: 'Cấp 13', coords: [111.5, 16.2] as [number, number], radius: 150
  });

  const [assessments, setAssessments] = useState<Assessment[]>([
    { id: 1, location: 'Quần đảo Hoàng Sa', level: 'ALERT', desc: 'Rủi ro cực đại.', time: '11:00', coords: [111.5, 16.2] },
    { id: 2, location: 'Đà Nẵng', level: 'HIGH', desc: 'Mưa lớn diện rộng.', time: '10:35', coords: [108.2, 16.05] }
  ]);

  const riskGeoJson = useMemo(() => buildRiskGeoJson(riskZones), [riskZones]);
  const layerRightOffset = SCREEN_MARGIN + (isAIConsoleOpen ? AI_PANEL_WIDTH + PANEL_GAP : AI_TOGGLE_WIDTH + PANEL_GAP);

  // --- MAP INITIALIZATION ---
  useEffect(() => {
    if (mapRef.current) return; // Guard clause: Map đã tạo rồi thì thôi
    if (!mapContainerRef.current) return;

    console.log("Khởi tạo Map với OSM Style...");

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE, // Dùng style OSM an toàn
      center: [108.2, 16.0],
      zoom: 6,
      attributionControl: true
    });

    mapRef.current = map;

    map.on('load', () => {
      console.log("Map Loaded Success!");

      // 1. Rivers
      map.addSource('rivers', { type: 'geojson', data: RIVERS_URL });
      map.addLayer({
        id: 'river-lines', type: 'line', source: 'rivers',
        layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
        paint: { 'line-color': '#06B6D4', 'line-width': 2, 'line-opacity': 0.8 }
      });

      // 2. Risk Zones
      map.addSource('risk-polygons', { type: 'geojson', data: riskGeoJson });
      map.addLayer({
        id: 'risk-polygons-fill', type: 'fill', source: 'risk-polygons',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.35 }
      });

      // 3. Storm Elements
      map.addSource('storm-eye', { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: activeStorm.coords } }] } });
      map.addLayer({ id: 'storm-eye-circle', type: 'circle', source: 'storm-eye', paint: { 'circle-radius': 50, 'circle-color': '#EF4444', 'circle-opacity': 0.6, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });

      map.addSource('storm-path', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [activeStorm.coords, [107.5, 17.5], [105.0, 19.0]] } } });
      map.addLayer({ id: 'storm-path-line', type: 'line', source: 'storm-path', paint: { 'line-color': '#FCA5A5', 'line-width': 4, 'line-dasharray': [2, 1] } });

      // 4. Dummy Layers (Wind/Heat/Cold)
      const windFeatures = Array.from({ length: 30 }, () => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [105 + Math.random() * 10, 14 + Math.random() * 10] } }));
      map.addSource('wind-data', { type: 'geojson', data: { type: 'FeatureCollection', features: windFeatures } });
      map.addLayer({ id: 'wind-arrows', type: 'circle', source: 'wind-data', paint: { 'circle-radius': 3, 'circle-color': '#06B6D4' }, layout: { visibility: 'none' } });

      map.addSource('temp-data', { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { type: 'heat' }, geometry: { type: 'Polygon', coordinates: [[[100, 10], [105, 10], [105, 15], [100, 15], [100, 10]]] } }, { type: 'Feature', properties: { type: 'cold' }, geometry: { type: 'Polygon', coordinates: [[[110, 20], [115, 20], [115, 25], [110, 25], [110, 20]]] } }] } });
      map.addLayer({ id: 'heat-poly', type: 'fill', source: 'temp-data', filter: ['==', 'type', 'heat'], paint: { 'fill-color': '#F97316', 'fill-opacity': 0.3 }, layout: { visibility: 'none' } });
      map.addLayer({ id: 'cold-poly', type: 'fill', source: 'temp-data', filter: ['==', 'type', 'cold'], paint: { 'fill-color': '#3B82F6', 'fill-opacity': 0.3 }, layout: { visibility: 'none' } });

      // Events
      map.on('click', (e) => {
        const coordsText = `${e.lngLat.lat.toFixed(4)}, ${e.lngLat.lng.toFixed(4)}`;
        setInputLocation(coordsText);
        setDashboardInfo({ location: 'Vị trí đã chọn', coordinates: coordsText, status: 'Selected Region' });
        new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<div style="color:black">Tọa độ: ${coordsText}</div>`).addTo(map);
      });

      setIsLoaded(true);
      map.resize(); // Quan trọng: force resize
    });

    map.on('error', (e) => {
        console.error("Map Error:", e);
    });

  }, []); // Dependency rỗng

  // --- UPDATES ---
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;
    
    // Toggle Layers Logic
    const toggle = (id: string, visible: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    };
    toggle('storm-eye-circle', layers.storm);
    toggle('storm-path-line', layers.stormDir);
    toggle('wind-arrows', layers.wind);
    toggle('river-lines', layers.river);
    toggle('heat-poly', layers.heat);
    toggle('cold-poly', layers.cold);
  }, [layers, isLoaded]);

  const handleAnalyze = async () => {
    if (!inputLocation) return;
    setAnalyzing(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setAnalyzing(false);
    setDashboardInfo(prev => ({ ...prev, status: 'Gemma Verified' }));
  };

  const toggleLayer = (key: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderChartModal = () => {
    if (!selectedMetric) return null;
    const config = MOCK_CHARTS[selectedMetric];
    const maxVal = Math.max(...config.data) * 1.1;
    return (
      <div className="absolute inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
        <div className="bg-[#1A1C23] border border-gray-700 rounded-2xl w-full max-w-lg p-6 relative">
          <button onClick={() => setSelectedMetric(null)} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={20} /></button>
          <h3 className="text-white font-bold mb-4">{config.title}</h3>
          <div className="h-40 flex items-end gap-1 border-b border-gray-700 pb-2">
             {config.data.map((val, i) => (
                 <div key={i} className="flex-1 bg-blue-500 hover:bg-blue-400" style={{ height: `${(val/maxVal)*100}%` }}></div>
             ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="relative w-full h-screen bg-[#05060a] text-slate-200 overflow-hidden font-sans">
      <style>{` .storm-pulse { animation: pulse-red 2s infinite; } @keyframes pulse-red { 0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.65); } 70% { box-shadow: 0 0 0 14px rgba(239,68,68,0); } 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); } } `}</style>

      {renderChartModal()}

      {/* MAP CONTAINER - Sử dụng style inline để ÉP chiều cao 100vh */}
      <div className="absolute inset-0 z-0">
         <div 
           ref={mapContainerRef} 
           style={{ width: '100%', height: '100vh', position: 'absolute', top: 0, left: 0 }} 
           className="bg-gray-800"
         />
      </div>

      {/* LAYER MANAGER */}
      {!isLayerManagerOpen && (
        <button onClick={() => setIsLayerManagerOpen(true)} className="absolute top-6 z-20 bg-[#1A1C23]/90 border border-gray-800 rounded-2xl p-3 text-white shadow-2xl" style={{ right: layerRightOffset }}>
          <Layers size={20} className="text-blue-400" />
        </button>
      )}

      {isLayerManagerOpen && (
        <div className="absolute top-6 z-30 w-72 bg-[#111217]/95 border border-gray-800 rounded-3xl shadow-2xl p-4" style={{ right: layerRightOffset }}>
          <div className="flex justify-between mb-3"><h4 className="text-xs uppercase text-gray-500">Layers</h4><button onClick={() => setIsLayerManagerOpen(false)}><X size={14}/></button></div>
          <div className="space-y-2 text-xs">
            <div onClick={() => toggleLayer('storm')} className="flex justify-between p-2 hover:bg-white/5 rounded cursor-pointer"><span>Bão</span>{layers.storm ? <Eye size={14} className="text-blue-400"/> : <EyeOff size={14}/>}</div>
            <div onClick={() => toggleLayer('wind')} className="flex justify-between p-2 hover:bg-white/5 rounded cursor-pointer"><span>Gió</span>{layers.wind ? <Eye size={14} className="text-blue-400"/> : <EyeOff size={14}/>}</div>
          </div>
        </div>
      )}

      {/* AI CONSOLE */}
      {isAIConsoleOpen ? (
        <div className="absolute top-6 z-40 w-[360px] bg-[#0b0f16]/90 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden" style={{ right: SCREEN_MARGIN }}>
           <div className="p-4 border-b border-white/10 flex justify-between"><div className="flex gap-2 items-center"><ShieldCheck className="text-blue-400" size={18}/><span className="text-white font-bold text-sm">Gemma Analyst</span></div><button onClick={() => setIsAIConsoleOpen(false)}><X size={16} className="text-gray-500"/></button></div>
           <div className="p-4">
              <input value={inputLocation} onChange={e => setInputLocation(e.target.value)} className="w-full bg-black/50 border border-gray-700 rounded p-2 text-sm mb-3" placeholder="Nhập tọa độ..."/>
              <button onClick={handleAnalyze} disabled={analyzing} className="w-full bg-blue-600 hover:bg-blue-500 py-2 rounded text-white text-sm flex justify-center gap-2">{analyzing ? <Activity className="animate-spin"/> : <ShieldAlert/>} Phân tích</button>
           </div>
           <div className="p-4 border-t border-white/5 max-h-60 overflow-y-auto custom-scrollbar bg-black/20">
              {assessments.map(a => (
                 <div key={a.id} className="mb-2 p-2 bg-white/5 rounded border border-white/5 text-xs text-gray-300">
                    <div className="flex justify-between font-bold text-white mb-1"><span>{a.location}</span><span className="text-red-400">{a.level}</span></div>
                    {a.desc}
                 </div>
              ))}
           </div>
        </div>
      ) : (
        <button onClick={() => setIsAIConsoleOpen(true)} className="absolute top-6 z-30 bg-[#0b0f16]/80 px-4 py-2 rounded-2xl text-white text-xs border border-white/10 shadow-lg" style={{ right: SCREEN_MARGIN }}>Mở AI Console</button>
      )}

      {/* CARD QUAN TRẮC TRỰC TIẾP */}
      <div className="absolute top-6 left-6 z-20 w-72 bg-[#0b0f16]/80 backdrop-blur-xl border border-white/10 rounded-3xl shadow-lg overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-2 text-red-400 text-[10px] font-bold tracking-[0.2em] uppercase"><div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />QUAN TRẮC THỰC TIẾP</div>
          <h2 className="text-xl font-bold text-white mt-2">{dashboardInfo.location.split(',')[0]}</h2>
          <p className="text-[11px] text-gray-500 mt-1 font-mono">{dashboardInfo.coordinates}</p>
        </div>
        <div className="p-4 space-y-3">
           <div className="flex justify-between items-center"><span className="text-[10px] text-gray-500 uppercase">Gió</span><Navigation size={14} className="text-blue-400"/></div>
           <div className="text-4xl font-bold text-white">10° <span className="text-xs text-gray-400 font-normal">Đông Bắc</span></div>
           <div className="grid grid-cols-2 gap-3 mt-2">
              <div className="bg-white/5 p-2 rounded-xl border border-white/10"><div className="text-[10px] text-orange-400 mb-1 flex gap-1"><Thermometer size={10}/> Nhiệt độ</div><div className="font-bold text-white">22.5°C</div></div>
              <div className="bg-white/5 p-2 rounded-xl border border-white/10"><div className="text-[10px] text-purple-400 mb-1 flex gap-1"><Gauge size={10}/> Áp suất</div><div className="font-bold text-white">1015 hPa</div></div>
           </div>
        </div>
      </div>

    </div>
  );
};

export default SafeWaveApp;