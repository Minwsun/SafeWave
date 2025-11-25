import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreInstance, type StyleSpecification, type LngLatBoundsLike, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Activity, CloudRain, Droplets, Gauge, MapPin, 
  ShieldAlert, ShieldCheck, Sun, Thermometer, Wind, X, Zap, Search,
  History, AlertTriangle, CheckCircle2, ChevronRight, Minus, LayoutDashboard, Layers,
  RefreshCw, Maximize2, Siren, Mountain, ArrowUp, ArrowDown, Waves, Umbrella, Navigation
} from 'lucide-react';

// --- CẤU HÌNH API & DỮ LIỆU ---
const OWM_API_KEY = 'YOUR_OPENWEATHERMAP_API_KEY'; 
const ASIA_BOUNDS: LngLatBoundsLike = [[60.0, -15.0], [150.0, 55.0]];

const STORM_TRACK_GEOJSON = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { name: 'Super Typhoon Yagi' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [135.0, 10.0], [132.0, 12.5], [128.0, 14.5], [124.0, 16.0], 
        [120.0, 17.5], [116.0, 18.5], [112.0, 19.2], [109.0, 20.0], 
        [107.0, 20.8], [105.5, 21.2], [104.0, 21.5]
      ]
    }
  }]
};

const ADMIN_GEO_URLS = {
  province: 'https://raw.githubusercontent.com/namchel/vietnam-map-data/master/data/geo/province.geojson',
  district: 'https://raw.githubusercontent.com/namchel/vietnam-map-data/master/data/geo/district.geojson',
  ward: 'https://raw.githubusercontent.com/namchel/vietnam-map-data/master/data/geo/ward.geojson' 
};

const RISK_COLORS = {
  safe: '#10b981',      
  warning: '#facc15',   
  danger: '#f97316',    
  critical: '#ef4444',  
  default: 'rgba(255,255,255,0.05)' 
};

// --- TYPES MỞ RỘNG ---
interface RainStats {
  h1: number; h2: number; h3: number; h5: number; h12: number; h24: number;
  d3: number; d7: number; d14: number;
}

interface DashboardData {
  title: string; subtitle: string; coordinates: string;
  temp: number; feelsLike: number; 
  tempMin: number; tempMax: number; // Nhiệt độ thấp/cao nhất
  humidity: number; 
  pressureSea: number; pressureGround: number; // Áp suất biển vs mặt đất
  windSpeed: number; windDir: number; 
  windGusts: number; // Áp lực gió (Gió giật)
  cloudCover: number; 
  elevation: number; // Độ cao
  uvIndex: number; // Chỉ số UV
  rainStats: RainStats; // Chi tiết mưa
  status: string;
}

interface HistoryItem {
  id: number; location: string; time: string; risk: 'High' | 'Medium' | 'Low'; type: string;
}

interface AlertItem {
  id: number; location: string; province: string; level: 'Critical' | 'High' | 'Medium'; 
  type: string; timestamp: string; rainAmount: number; windSpeed: number; description: string; coords: [number, number]; 
}

interface LayerState { storm: boolean; rain: boolean; wind: boolean; temp: boolean; adminMap: boolean; }

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'osm-tiles': { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '' }
  },
  layers: [{ id: 'osm-layer', type: 'raster', source: 'osm-tiles', minzoom: 0, maxzoom: 19, paint: { 'raster-opacity': 1, 'raster-saturation': -0.8, 'raster-contrast': 0.1 } }] 
} as StyleSpecification;

// --- MOCK ALERTS (Giữ nguyên logic cũ) ---
const PROVINCES_MOCK = ['Lào Cai', 'Yên Bái', 'Hà Giang', 'Cao Bằng', 'Quảng Ninh', 'Hải Phòng', 'Thanh Hóa', 'Nghệ An', 'Quảng Bình', 'Thừa Thiên Huế'];
const ALERT_TYPES = ['Sạt lở đất', 'Lũ quét', 'Ngập úng diện rộng', 'Giông lốc mạnh'];

const generateMockAlerts = (): AlertItem[] => {
  const alerts: AlertItem[] = [];
  const count = Math.floor(Math.random() * 5) + 3; 
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    const level = r > 0.7 ? 'Critical' : (r > 0.4 ? 'High' : 'Medium');
    const prov = PROVINCES_MOCK[Math.floor(Math.random() * PROVINCES_MOCK.length)];
    alerts.push({
      id: Date.now() + i,
      location: `Huyện ${['Bảo Yên', 'Bát Xát', 'Mù Cang Chải', 'Bắc Hà', 'Nguyên Bình'][Math.floor(Math.random()*5)]}`,
      province: prov, level: level, type: ALERT_TYPES[Math.floor(Math.random() * ALERT_TYPES.length)],
      timestamp: new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}),
      rainAmount: Math.floor(Math.random() * 150) + 50, windSpeed: Math.floor(Math.random() * 80) + 20,
      description: 'Đất bão hòa nước >95%. Nguy cơ sạt lở rất cao tại các sườn dốc.',
      coords: [105 + Math.random() * 3, 19 + Math.random() * 3] 
    });
  }
  return alerts.sort((a, b) => (a.level === 'Critical' ? -1 : 1));
};

const SafeWaveApp = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreInstance | null>(null);
  const markerRef = useRef<Marker | null>(null);
  
  const [inputLocation, setInputLocation] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  
  const [isAIConsoleOpen, setIsAIConsoleOpen] = useState(true);
  const [isDashboardOpen, setIsDashboardOpen] = useState(true);
  
  const [consoleTab, setConsoleTab] = useState<'analysis' | 'alerts' | 'history'>('analysis');
  const [activeLayers, setActiveLayers] = useState<LayerState>({ storm: true, rain: false, wind: false, temp: false, adminMap: true });
  
  // [MODIFIED] State Dashboard mở rộng
  const [dashboardInfo, setDashboardInfo] = useState<DashboardData>({ 
    title: 'Sẵn sàng', subtitle: 'Chọn vị trí trên bản đồ', coordinates: '--', 
    temp: 0, feelsLike: 0, tempMin: 0, tempMax: 0,
    humidity: 0, pressureSea: 0, pressureGround: 0,
    windSpeed: 0, windDir: 0, windGusts: 0, cloudCover: 0, 
    elevation: 0, uvIndex: 0,
    rainStats: { h1: 0, h2: 0, h3: 0, h5: 0, h12: 0, h24: 0, d3: 0, d7: 0, d14: 0 },
    status: 'Standby' 
  });

  const [historyList, setHistoryList] = useState<HistoryItem[]>([
    { id: 1, location: 'Đa Nghịt, Lạc Dương', time: '10:05 AM', risk: 'High', type: 'Sạt lở đất' },
    { id: 2, location: 'Phường 12, Đà Lạt', time: '09:42 AM', risk: 'Medium', type: 'Ngập úng' },
  ]);
  const [nationalAlerts, setNationalAlerts] = useState<AlertItem[]>([]);
  const [lastScanTime, setLastScanTime] = useState<string>('--:--');
  const [isScanning, setIsScanning] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<AlertItem | null>(null); 

  // Logic Scan System
  const runSystemScan = () => {
    setIsScanning(true);
    setTimeout(() => {
      const newAlerts = generateMockAlerts();
      setNationalAlerts(newAlerts);
      setLastScanTime(new Date().toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'}));
      setIsScanning(false);
    }, 2000);
  };

  useEffect(() => {
    runSystemScan(); 
    const interval = setInterval(runSystemScan, 30 * 60 * 1000); 
    return () => clearInterval(interval);
  }, []);

  const simulateAdminRisk = (map: MapLibreInstance) => {
    ['source-province', 'source-district', 'source-ward'].forEach(sourceId => {
        const features = map.querySourceFeatures(sourceId, { sourceLayer: sourceId }); 
        features.forEach((f) => {
            if (!f.id) return;
            const r = Math.random();
            const level = r > 0.8 ? 3 : (r > 0.6 ? 2 : (r > 0.3 ? 1 : 0)); 
            map.setFeatureState({ source: sourceId, id: f.id }, { riskLevel: level });
        });
    });
  };

  // --- MAP INIT ---
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [108.9445, 14.8452],
      zoom: 6, pitch: 0, bearing: 0, maxPitch: 85, attributionControl: false,
      maxBounds: ASIA_BOUNDS, minZoom: 3
    });
    mapRef.current = map;

    map.on('load', async () => {
      map.addSource('terrain-source', { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 12 });
      map.setTerrain({ source: 'terrain-source', exaggeration: 1.5 });
      map.addLayer({ id: 'hillshade-layer', type: 'hillshade', source: 'terrain-source', paint: { 'hillshade-shadow-color': '#020408', 'hillshade-highlight-color': '#ffffff', 'hillshade-exaggeration': 1.1, 'hillshade-opacity': 0.6 } });

      try {
        const rvRes = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const rvData = await rvRes.json();
        const latestRadar = rvData.radar?.past?.at(-1);
        if (latestRadar) {
             map.addSource('rain-source', { type: 'raster', tiles: [`https://tile.rainviewer.com/v2/radar/${latestRadar.time}/256/{z}/{x}/{y}/2/1_1.png`], tileSize: 256 });
             map.addLayer({ id: 'rain-layer', type: 'raster', source: 'rain-source', paint: { 'raster-opacity': 0.8 }, layout: { visibility: 'none' } });
        }
      } catch (e) {}

      map.addSource('wind-source', { type: 'raster', tiles: [`https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`], tileSize: 256 });
      map.addLayer({ id: 'wind-layer', type: 'raster', source: 'wind-source', paint: { 'raster-opacity': 0.6 }, layout: { visibility: 'none' } });
      map.addSource('temp-source', { type: 'raster', tiles: [`https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`], tileSize: 256 });
      map.addLayer({ id: 'temp-layer', type: 'raster', source: 'temp-source', paint: { 'raster-opacity': 0.5 }, layout: { visibility: 'none' } });
      map.addSource('storm-source', { type: 'geojson', data: STORM_TRACK_GEOJSON as any, lineMetrics: true });
      map.addLayer({ id: 'storm-track', type: 'line', source: 'storm-source', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' }, paint: { 'line-width': 6, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#22c55e', 0.5, '#f59e0b', 1, '#ef4444'] } });
      map.addLayer({ id: 'storm-glow', type: 'line', source: 'storm-source', layout: { visibility: 'visible' }, paint: { 'line-width': 18, 'line-color': '#ef4444', 'line-opacity': 0.3, 'line-blur': 12 } }, 'storm-track');
      
      const riskFillPaint: any = {
        'fill-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false], '#ffffff', 
            ['match', ['feature-state', 'riskLevel'], 3, RISK_COLORS.critical, 2, RISK_COLORS.danger, 1, RISK_COLORS.warning, 0, RISK_COLORS.safe, RISK_COLORS.default]
        ],
        'fill-opacity': 0.6, 'fill-outline-color': 'rgba(255,255,255,0.1)'
      };

      map.addSource('source-province', { type: 'geojson', data: ADMIN_GEO_URLS.province, promoteId: 'code' });
      map.addSource('source-district', { type: 'geojson', data: ADMIN_GEO_URLS.district, promoteId: 'code' });
      map.addSource('source-ward', { type: 'geojson', data: ADMIN_GEO_URLS.ward, promoteId: 'code' });

      map.addLayer({ id: 'layer-province-fill', type: 'fill', source: 'source-province', maxzoom: 7, paint: riskFillPaint, layout: { visibility: 'visible' } }, 'storm-track');
      map.addLayer({ id: 'layer-province-border', type: 'line', source: 'source-province', maxzoom: 7, paint: { 'line-color': '#fff', 'line-width': 1, 'line-opacity': 0.3 }, layout: { visibility: 'visible' } });
      map.addLayer({ id: 'layer-district-fill', type: 'fill', source: 'source-district', minzoom: 7, maxzoom: 9.5, paint: riskFillPaint, layout: { visibility: 'visible' } }, 'storm-track');
      map.addLayer({ id: 'layer-district-border', type: 'line', source: 'source-district', minzoom: 7, maxzoom: 9.5, paint: { 'line-color': '#fff', 'line-width': 0.5, 'line-opacity': 0.3 }, layout: { visibility: 'visible' } });
      map.addLayer({ id: 'layer-ward-fill', type: 'fill', source: 'source-ward', minzoom: 9.5, paint: riskFillPaint, layout: { visibility: 'visible' } }, 'storm-track');
      map.addLayer({ id: 'layer-ward-border', type: 'line', source: 'source-ward', minzoom: 9.5, paint: { 'line-color': '#fff', 'line-width': 0.3, 'line-opacity': 0.2 }, layout: { visibility: 'visible' } });

      map.on('idle', () => simulateAdminRisk(map));

      map.on('click', async (e) => {
        const { lng, lat } = e.lngLat;
        const coordsText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        
        // Marker
        if (markerRef.current) markerRef.current.remove();
        const el = document.createElement('div'); el.className = 'neon-marker-container'; 
        el.innerHTML = `<div class="neon-core"></div><div class="neon-pulse"></div>`;
        markerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);

        setConsoleTab('analysis'); 
        setAnalyzing(true);

        // Geocoding
        let line1 = 'Vị trí đã chọn', line2 = '';
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
            const data = await res.json();
            if (data?.address) {
                const a = data.address;
                line1 = [a.quarter, a.village, a.town, a.ward].filter(Boolean).join(', ') || a.road || 'Vị trí chưa xác định';
                line2 = a.city || a.state || a.province || '';
            }
        } catch {}
        setInputLocation(`${line1}, ${line2}`);

        // [MODIFIED] Weather API Call
        try {
            // Thêm các tham số: hourly=precipitation, daily=rain_sum,uv,temp_min/max, elevation
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,wind_gusts_10m,precipitation&hourly=precipitation&daily=temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum&timezone=auto&forecast_days=14`;
            
            const wRes = await fetch(url);
            const wData = await wRes.json();
            
            if (wData.current && wData.hourly && wData.daily) {
                 const current = wData.current;
                 const hourlyRain = wData.hourly.precipitation;
                 const dailyRain = wData.daily.precipitation_sum;

                 // Hàm tính tổng mưa giờ (tính từ giờ hiện tại)
                 const nowHour = new Date().getHours(); 
                 const sumRain = (hours: number) => {
                    const slice = hourlyRain.slice(nowHour, nowHour + hours);
                    return slice.reduce((a:number, b:number) => a + b, 0);
                 };

                 // Hàm tính tổng mưa ngày
                 const sumRainDays = (days: number) => dailyRain.slice(0, days).reduce((a:number, b:number) => a + b, 0);

                 setDashboardInfo({
                    title: line1, subtitle: line2, coordinates: coordsText,
                    temp: current.temperature_2m, 
                    feelsLike: current.apparent_temperature,
                    tempMin: wData.daily.temperature_2m_min[0],
                    tempMax: wData.daily.temperature_2m_max[0],
                    humidity: current.relative_humidity_2m, 
                    pressureSea: current.pressure_msl,
                    pressureGround: current.surface_pressure, // Áp suất mặt đất
                    windSpeed: current.wind_speed_10m, 
                    windDir: current.wind_direction_10m,
                    windGusts: current.wind_gusts_10m, // Áp lực/Gió giật
                    cloudCover: current.cloud_cover, 
                    elevation: wData.elevation || 0,
                    uvIndex: wData.daily.uv_index_max[0],
                    rainStats: {
                        h1: current.precipitation,
                        h2: sumRain(2),
                        h3: sumRain(3),
                        h5: sumRain(5),
                        h12: sumRain(12),
                        h24: sumRain(24),
                        d3: sumRainDays(3),
                        d7: sumRainDays(7),
                        d14: sumRainDays(14)
                    },
                    status: 'Live'
                 });
            }
        } catch (err) {}

        // Mock Analysis Result
        setTimeout(() => {
            setAnalyzing(false);
            const randomRisk = Math.random();
            const riskLevel = randomRisk > 0.7 ? 'High' : (randomRisk > 0.4 ? 'Medium' : 'Low');
            const type = riskLevel === 'High' ? 'Cảnh báo sạt lở' : (riskLevel === 'Medium' ? 'Mưa lớn cục bộ' : 'An toàn');
            
            if (riskLevel !== 'Low') {
                setHistoryList(prev => {
                    const now = Date.now();
                    const tenDaysInMs = 10 * 24 * 60 * 60 * 1000;
                    const newItem: HistoryItem = { 
                        id: now, location: line1, 
                        time: new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}), 
                        risk: riskLevel, type: type 
                    };
                    return [newItem, ...prev].filter(item => (now - item.id) < tenDaysInMs);
                });
            }
        }, 1500);
      });
    });
  }, []);

  const toggleLayer = (key: keyof LayerState) => {
    setActiveLayers(prev => {
        const next = { ...prev, [key]: !prev[key] };
        const map = mapRef.current;
        if (map) {
            const v = next[key] ? 'visible' : 'none';
            if (key === 'storm') { map.setLayoutProperty('storm-track', 'visibility', v); map.setLayoutProperty('storm-glow', 'visibility', v); }
            else if (key === 'rain') map.setLayoutProperty('rain-layer', 'visibility', v);
            else if (key === 'wind') map.setLayoutProperty('wind-layer', 'visibility', v);
            else if (key === 'temp') map.setLayoutProperty('temp-layer', 'visibility', v);
            else if (key === 'adminMap') {
                ['province', 'district', 'ward'].forEach(type => {
                    if (map.getLayer(`layer-${type}-fill`)) map.setLayoutProperty(`layer-${type}-fill`, 'visibility', v);
                    if (map.getLayer(`layer-${type}-border`)) map.setLayoutProperty(`layer-${type}-border`, 'visibility', v);
                });
            }
        }
        return next;
    });
  };

  return (
    <div className="relative w-full h-screen bg-[#020408] text-slate-200 overflow-hidden font-sans selection:bg-cyan-500/30">
      
      {/* MAP CONTAINER */}
      <div className="absolute inset-0 z-0"><div ref={mapContainerRef} className="w-full h-full bg-[#05060a]"/></div>

      {/* LAYER CONTROLS */}
      <div className="absolute top-6 right-6 z-30 flex flex-col gap-3">
         <button onClick={() => toggleLayer('adminMap')} className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-xl backdrop-blur-md border ${activeLayers.adminMap ? 'bg-[#05060a]/90 border-cyan-500 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'bg-[#05060a]/60 border-white/10 text-gray-400 hover:bg-[#05060a]/80 hover:text-white'}`}><Layers size={20}/></button>
         {[
           { id: 'storm', icon: Zap, color: 'text-red-400' },
           { id: 'rain', icon: CloudRain, color: 'text-blue-400' },
           { id: 'wind', icon: Wind, color: 'text-teal-400' },
           { id: 'temp', icon: Thermometer, color: 'text-orange-400' }
         ].map((btn) => (
           <button key={btn.id} onClick={() => toggleLayer(btn.id as keyof LayerState)} className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-xl backdrop-blur-md border ${activeLayers[btn.id as keyof LayerState] ? 'bg-[#05060a]/90 border-cyan-500 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'bg-[#05060a]/60 border-white/10 text-gray-400 hover:bg-[#05060a]/80 hover:text-white'}`}><btn.icon size={20} className={activeLayers[btn.id as keyof LayerState] ? 'drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]' : ''} /></button>
         ))}
      </div>

      {/* --- DASHBOARD CARD (NÂNG CẤP) --- */}
      {isDashboardOpen ? (
        <div className="absolute top-6 left-6 z-20 w-[420px] glass-card rounded-3xl overflow-hidden group transition-all duration-300 flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="p-5 border-b border-white/5 relative bg-gradient-to-b from-white/5 to-transparent">
            <button onClick={() => setIsDashboardOpen(false)} className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition"><Minus size={16} /></button>
            <div className="flex items-center gap-2 mb-2">
              <div className="px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[9px] font-bold tracking-wider uppercase flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span></span>Live Monitoring
              </div>
            </div>
            <h2 className="text-xl font-bold text-white leading-tight mb-0.5 truncate w-[90%]">{dashboardInfo.title}</h2>
            <p className="text-xs text-gray-400 font-medium truncate">{dashboardInfo.subtitle}</p>
            <div className="flex items-center gap-3 mt-3">
              <div className="flex items-center gap-1 text-cyan-400 bg-cyan-950/30 px-2 py-1 rounded-md border border-cyan-500/20"><MapPin size={12}/><span className="text-[10px] font-mono">{dashboardInfo.coordinates}</span></div>
              <div className="flex items-center gap-1 text-yellow-400 bg-yellow-950/30 px-2 py-1 rounded-md border border-yellow-500/20"><Mountain size={12}/><span className="text-[10px] font-bold">{Math.round(dashboardInfo.elevation)}m</span></div>
            </div>
          </div>
          
          <div className="p-5 pt-2 overflow-y-auto custom-scrollbar">
             {/* Main Temp Section */}
             <div className="flex items-center justify-between py-4 border-b border-white/5">
                <div>
                   <div className="text-5xl font-bold text-white tracking-tighter text-glow-cyan leading-none">{Math.round(dashboardInfo.temp)}°</div>
                   <div className="text-[10px] text-gray-400 font-medium mt-1">Cảm giác: <span className="text-gray-200 font-bold">{Math.round(dashboardInfo.feelsLike)}°</span></div>
                </div>
                <div className="flex flex-col gap-1 text-right">
                    <div className="flex items-center justify-end gap-1 text-xs font-medium text-red-300"><ArrowUp size={12}/> Max: {Math.round(dashboardInfo.tempMax)}°</div>
                    <div className="flex items-center justify-end gap-1 text-xs font-medium text-blue-300"><ArrowDown size={12}/> Min: {Math.round(dashboardInfo.tempMin)}°</div>
                    <div className="mt-1 px-2 py-0.5 bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[10px] rounded font-bold inline-block ml-auto">UV: {dashboardInfo.uvIndex}</div>
                </div>
             </div>

             {/* Wind & Pressure Grid */}
             <div className="grid grid-cols-2 gap-2 mt-4">
                 <div className="bg-white/5 rounded-xl p-3 border border-white/5 relative overflow-hidden">
                     <div className="text-[10px] text-gray-500 uppercase font-bold mb-1 flex items-center gap-1"><Wind size={10}/> Tốc độ gió</div>
                     <div className="text-xl font-bold text-white">{dashboardInfo.windSpeed}<span className="text-xs text-gray-400 font-normal ml-0.5">km/h</span></div>
                     <div className="text-[10px] text-cyan-300 mt-1 flex items-center gap-1"><Navigation size={10} style={{transform: `rotate(${dashboardInfo.windDir}deg)`}}/> {dashboardInfo.windDir}°</div>
                 </div>
                 <div className="bg-white/5 rounded-xl p-3 border border-white/5 relative overflow-hidden">
                     <div className="text-[10px] text-gray-500 uppercase font-bold mb-1 flex items-center gap-1"><Waves size={10}/> Áp lực gió</div>
                     <div className="text-xl font-bold text-white">{dashboardInfo.windGusts}<span className="text-xs text-gray-400 font-normal ml-0.5">km/h</span></div>
                     <div className="text-[10px] text-red-300 mt-1">Gió giật mạnh</div>
                 </div>
             </div>

             {/* Atmosphere Grid */}
             <div className="grid grid-cols-3 gap-2 mt-2">
                 {[
                   { l: 'Độ ẩm', v: dashboardInfo.humidity + '%', c: 'text-blue-400', i: Droplets },
                   { l: 'Áp suất', v: dashboardInfo.pressureSea, u: 'hPa', c: 'text-purple-400', i: Gauge }, // Sea Level
                   { l: 'Mây', v: dashboardInfo.cloudCover + '%', c: 'text-gray-400', i: Sun }
                 ].map((d,i) => (
                    <div key={i} className="bg-white/5 rounded-lg p-2 text-center border border-white/5">
                        <d.i size={14} className={`mx-auto mb-1 ${d.c}`}/>
                        <div className="text-sm font-bold text-white leading-none">{d.v}</div>
                        <div className="text-[8px] text-gray-500 mt-1 font-bold uppercase">{d.l}</div>
                    </div>
                 ))}
             </div>

             {/* Precipitation Matrix (Chi tiết mưa) */}
             <div className="mt-4 bg-[#0b0f16]/60 rounded-xl border border-white/10 p-3">
                 <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/5">
                     <Umbrella size={14} className="text-blue-400"/>
                     <span className="text-xs font-bold text-white uppercase tracking-wider">Lượng mưa tích lũy</span>
                 </div>
                 {/* Short Term */}
                 <div className="mb-3">
                     <div className="text-[9px] text-gray-500 uppercase font-bold mb-2">Ngắn hạn (Giờ)</div>
                     <div className="grid grid-cols-6 gap-1 text-center">
                         {[
                            { l: '1h', v: dashboardInfo.rainStats.h1 },
                            { l: '2h', v: dashboardInfo.rainStats.h2 },
                            { l: '3h', v: dashboardInfo.rainStats.h3 },
                            { l: '5h', v: dashboardInfo.rainStats.h5 },
                            { l: '12h', v: dashboardInfo.rainStats.h12 },
                            { l: '24h', v: dashboardInfo.rainStats.h24 },
                         ].map((r, idx) => (
                             <div key={idx} className={`rounded-md p-1 border ${r.v > 0 ? 'bg-blue-500/10 border-blue-500/30' : 'bg-transparent border-white/5'}`}>
                                 <div className={`text-[10px] font-bold ${r.v > 5 ? 'text-red-400' : r.v > 0 ? 'text-blue-300' : 'text-gray-600'}`}>
                                     {r.v.toFixed(1)}
                                 </div>
                                 <div className="text-[8px] text-gray-500 mt-0.5">{r.l}</div>
                             </div>
                         ))}
                     </div>
                 </div>
                 {/* Long Term */}
                 <div>
                     <div className="text-[9px] text-gray-500 uppercase font-bold mb-2">Dự báo (Ngày)</div>
                     <div className="grid grid-cols-3 gap-2 text-center">
                         {[
                            { l: '3 Ngày', v: dashboardInfo.rainStats.d3 },
                            { l: '7 Ngày', v: dashboardInfo.rainStats.d7 },
                            { l: '14 Ngày', v: dashboardInfo.rainStats.d14 },
                         ].map((r, idx) => (
                             <div key={idx} className="flex items-center justify-between bg-white/5 px-2 py-1.5 rounded-lg border border-white/5">
                                 <span className="text-[9px] text-gray-400 font-bold">{r.l}</span>
                                 <span className={`text-xs font-bold ${r.v > 50 ? 'text-red-400' : r.v > 10 ? 'text-yellow-400' : 'text-white'}`}>{r.v.toFixed(0)}mm</span>
                             </div>
                         ))}
                     </div>
                 </div>
             </div>
             
             {/* Footer Info */}
             <div className="mt-2 flex justify-between text-[9px] text-gray-600 font-mono px-1">
                 <span>Pressure (Ground): {dashboardInfo.pressureGround} hPa</span>
                 <span>Sea Level Rise: N/A</span>
             </div>
          </div>
        </div>
      ) : (
        <button onClick={() => setIsDashboardOpen(true)} className="absolute top-6 left-6 z-20 h-12 px-4 rounded-2xl bg-[#05060a]/80 backdrop-blur-md border border-white/10 flex items-center gap-3 shadow-xl hover:bg-[#05060a]/95 transition-all group">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_red]"></div>
            <div className="flex flex-col items-start leading-none gap-1">
                <span className="text-white font-bold text-sm">{Math.round(dashboardInfo.temp)}°C</span>
                <span className="text-[10px] text-gray-400 font-medium max-w-[100px] truncate">{dashboardInfo.title}</span>
            </div>
            <LayoutDashboard size={16} className="text-gray-400 group-hover:text-cyan-400 transition ml-2"/>
        </button>
      )}

      {/* --- AI CONSOLE (RIGHT) --- */}
      {isAIConsoleOpen ? (
        <div className="absolute top-6 z-40 w-[420px] glass-card rounded-3xl overflow-hidden flex flex-col transition-all duration-300" style={{ right: 88, maxHeight: 'calc(100vh - 48px)' }}>
           
           <div className="bg-white/5 border-b border-white/5">
               <div className="p-4 flex justify-between items-center">
                  <div className="flex gap-2.5 items-center"><ShieldCheck className="text-blue-400" size={18}/><span className="text-white font-bold text-sm tracking-wide text-glow">SafeWave AI</span></div>
                  <button onClick={() => setIsAIConsoleOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"><Minus size={16}/></button>
               </div>
               
               {/* TABS NAVIGATION */}
               <div className="flex px-4 pb-0 gap-6 text-sm font-medium relative">
                  {[
                    { id: 'analysis', label: 'Phân tích', color: 'cyan' },
                    { id: 'alerts', label: 'Cảnh báo', color: 'red' }, 
                    { id: 'history', label: 'Lịch sử', color: 'purple' }
                  ].map(tab => (
                    <button key={tab.id} onClick={() => setConsoleTab(tab.id as any)} className={`pb-3 relative transition-colors ${consoleTab === tab.id ? `text-${tab.color}-400 text-glow-${tab.color === 'cyan' || tab.color === 'red' ? tab.color : 'purple'}` : 'text-gray-500 hover:text-gray-300'}`}>
                        {tab.label}
                        {consoleTab === tab.id && <span className={`absolute bottom-0 left-0 w-full h-0.5 bg-${tab.color}-400 shadow-[0_0_10px_${tab.color === 'cyan' ? '#22d3ee' : tab.color === 'red' ? '#ef4444' : '#c084fc'}]`}></span>}
                    </button>
                  ))}
               </div>
           </div>
           
           <div className="p-5 flex-1 overflow-y-auto custom-scrollbar relative">
              {/* TAB 1: PHÂN TÍCH */}
              {consoleTab === 'analysis' && (
                <div className="flex flex-col gap-4">
                    <div className="relative">
                        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"/>
                        <input value={inputLocation} onChange={e => setInputLocation(e.target.value)} className="w-full bg-[#05060a]/50 border border-white/10 focus:border-cyan-500/50 rounded-xl py-3 pl-10 pr-4 text-xs text-white placeholder-gray-600 outline-none transition-all" placeholder="Địa điểm đang chọn..." readOnly />
                    </div>
                    {analyzing ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-4">
                            <div className="loader-spin border-t-cyan-400 border-r-cyan-400"></div>
                            <span className="text-xs font-mono text-cyan-400 animate-pulse">AI đang tổng hợp dữ liệu...</span>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-5">
                            {(() => {
                                const currentRiskLevel = 4;
                                const levels = [{ lvl: 1, label: 'An toàn', color: 'bg-emerald-500' }, { lvl: 2, label: 'Nhẹ', color: 'bg-yellow-400' }, { lvl: 3, label: 'Cảnh báo', color: 'bg-orange-500' }, { lvl: 4, label: 'Nguy hiểm', color: 'bg-red-500' }];
                                return (
                                    <div className="bg-[#0b0f16]/40 border border-white/5 rounded-2xl p-5 flex flex-col gap-4 relative overflow-hidden">
                                        <div className={`absolute inset-0 opacity-10 blur-3xl bg-red-600`}></div>
                                        <div className="flex items-end justify-between gap-3 h-[100px] relative z-10 px-4">
                                            {levels.map((item) => (
                                                <div key={item.lvl} className="flex-1 flex flex-col items-center justify-end gap-3 group h-full">
                                                    <div className={`w-1.5 rounded-full transition-all duration-700 relative ${currentRiskLevel === item.lvl ? `h-full ${item.color} opacity-100 shadow-[0_0_15px_currentColor]` : 'h-2 bg-gray-700/50 opacity-30'}`}></div>
                                                    <span className={`text-[9px] font-bold uppercase tracking-wider ${currentRiskLevel === item.lvl ? 'text-white opacity-100' : 'text-gray-600 opacity-40'}`}>{item.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mt-2 pt-4 border-t border-white/5 z-10">
                                            <div className="text-2xl font-bold text-white mb-2 text-glow-red">NGUY HIỂM</div>
                                            <p className="text-xs text-gray-300 leading-relaxed font-light">Đất bão hòa nước (&gt;90%). Địa hình dốc cao. Nguy cơ sạt lở cực kỳ nguy hiểm.</p>
                                        </div>
                                    </div>
                                );
                            })()}
                            <button onClick={() => setAnalyzing(true)} className="w-full bg-cyan-600/10 hover:bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 group relative overflow-hidden">
                                <span className="relative flex h-2 w-2 mr-1">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                                </span>
                                Cập nhật dữ liệu
                            </button>
                        </div>
                    )}
                </div>
              )}

              {/* TAB 2: CẢNH BÁO */}
              {consoleTab === 'alerts' && (
                 <div className="flex flex-col h-full">
                     <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span></span><span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Hệ thống giám sát 24/7</span></div>
                        <div className="flex items-center gap-2"><span className="text-[10px] text-gray-500 font-mono">{lastScanTime}</span><button onClick={runSystemScan} disabled={isScanning} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition disabled:opacity-50"><RefreshCw size={12} className={isScanning ? 'animate-spin' : ''}/></button></div>
                     </div>
                     {isScanning ? (
                         <div className="flex-1 flex flex-col items-center justify-center gap-3"><div className="loader-spin border-t-red-500 border-r-red-500 w-8 h-8"></div><div className="text-xs text-red-400 animate-pulse font-mono">Đang quét toàn bộ lãnh thổ...</div></div>
                     ) : (
                         <div className="flex flex-col gap-3 pb-4">
                             {nationalAlerts.length === 0 ? <div className="text-center py-10 text-gray-500 text-xs">Không phát hiện rủi ro.</div> : nationalAlerts.map((alert) => (
                                 <div key={alert.id} onClick={() => setSelectedAlert(alert)} className="bg-[#0b0f16]/60 border border-white/5 hover:border-red-500/30 hover:bg-red-500/5 rounded-xl p-3 transition flex gap-3 items-start group cursor-pointer relative overflow-hidden">
                                     <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${alert.level === 'Critical' ? 'bg-red-500/20 text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]' : 'bg-orange-500/20 text-orange-500'}`}>{alert.level === 'Critical' ? <Siren size={20} className="animate-pulse"/> : <AlertTriangle size={20}/>}</div>
                                     <div className="flex-1 min-w-0"><div className="flex justify-between items-start"><h4 className="text-xs font-bold text-gray-200 truncate pr-2">{alert.location}</h4><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${alert.level === 'Critical' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-orange-500/10 border-orange-500/20 text-orange-400'}`}>{alert.level}</span></div><div className="text-[10px] text-gray-500 mt-0.5">{alert.province}</div><div className="text-[11px] text-gray-300 mt-2 font-medium flex items-center gap-1.5"><Activity size={10}/> {alert.type}</div></div>
                                     <Maximize2 size={12} className="absolute bottom-3 right-3 text-gray-600 group-hover:text-white transition opacity-0 group-hover:opacity-100"/>
                                 </div>
                             ))}
                         </div>
                     )}
                 </div>
              )}

              {/* TAB 3: LỊCH SỬ */}
              {consoleTab === 'history' && (
                  <div className="flex flex-col gap-3">
                      {historyList.length === 0 ? <div className="text-center py-8 text-gray-500 text-xs">Chưa có dữ liệu rủi ro.</div> : historyList.map((item) => (
                          <div key={item.id} className="bg-[#0b0f16]/60 border border-white/5 hover:border-white/10 rounded-xl p-3 transition flex gap-3 items-center group cursor-pointer">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${item.risk === 'High' ? 'bg-red-500/10 text-red-500' : 'bg-orange-500/10 text-orange-500'}`}><History size={18}/></div>
                              <div className="flex-1 min-w-0"><div className="flex justify-between items-start"><h4 className="text-xs font-bold text-gray-200 truncate pr-2">{item.location}</h4><span className="text-[10px] font-mono text-gray-500 shrink-0">{item.time}</span></div><div className="flex items-center gap-2 mt-1"><span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-white/5 border-white/10 text-gray-400">{item.type}</span></div></div>
                          </div>
                      ))}
                  </div>
              )}
           </div>
        </div>
      ) : (
        <button onClick={() => setIsAIConsoleOpen(true)} className="absolute top-6 z-30 h-12 px-5 rounded-2xl bg-[#05060a]/80 backdrop-blur-md border border-white/10 flex items-center gap-2 shadow-xl hover:border-blue-500/50 transition-all group" style={{ right: 88 }}><ShieldCheck size={18} className="text-blue-400 group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]"/><span className="text-white text-xs font-bold">AI Reports</span></button>
      )}

      {/* --- POPUP MODAL --- */}
      {selectedAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
           <div className="w-full max-w-md glass-card rounded-3xl p-6 relative shadow-[0_0_50px_rgba(239,68,68,0.2)] border border-red-500/20">
               <button onClick={() => setSelectedAlert(null)} className="absolute top-4 right-4 text-gray-400 hover:text-white transition"><X size={20}/></button>
               <div className="flex items-center gap-3 mb-6"><div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center text-red-500 border border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.4)]"><Siren size={24} className="animate-pulse"/></div><div><div className="text-[10px] text-red-400 font-bold uppercase tracking-widest mb-1">Cảnh báo khẩn cấp</div><h3 className="text-xl font-bold text-white leading-none">{selectedAlert.location}</h3><span className="text-sm text-gray-400">{selectedAlert.province}</span></div></div>
               <div className="space-y-4">
                   <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20"><div className="flex justify-between items-center mb-2"><span className="text-xs text-gray-400 uppercase font-semibold">Mức độ rủi ro</span><span className="text-red-400 font-bold text-sm shadow-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]">{selectedAlert.level.toUpperCase()}</span></div><div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-red-600 w-[90%] shadow-[0_0_10px_red]"></div></div></div>
                   <div className="grid grid-cols-2 gap-3"><div className="bg-white/5 rounded-xl p-3 border border-white/5"><div className="text-[10px] text-gray-500 uppercase mb-1">Lượng mưa</div><div className="text-lg font-bold text-blue-300">{selectedAlert.rainAmount}mm</div></div><div className="bg-white/5 rounded-xl p-3 border border-white/5"><div className="text-[10px] text-gray-500 uppercase mb-1">Gió giật</div><div className="text-lg font-bold text-teal-300">{selectedAlert.windSpeed}km/h</div></div></div>
                   <div className="text-sm text-gray-300 leading-relaxed italic border-l-2 border-red-500/50 pl-3">"{selectedAlert.description}"</div>
                   <button onClick={() => { if (mapRef.current) { mapRef.current.flyTo({ center: selectedAlert.coords, zoom: 12, speed: 1.5 }); } setSelectedAlert(null); }} className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl shadow-[0_0_20px_rgba(220,38,38,0.4)] transition-all flex items-center justify-center gap-2"><Maximize2 size={16}/> Xem trên bản đồ</button>
               </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default SafeWaveApp;