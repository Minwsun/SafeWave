import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreInstance, type StyleSpecification, type LngLatBoundsLike, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Activity, CloudRain, Droplets, Gauge, MapPin, 
  ShieldAlert, ShieldCheck, Sun, Thermometer, Wind, X, Zap, Search,
  History, AlertTriangle, CheckCircle2, ChevronRight
} from 'lucide-react';

// --- API KEYS ---
const OWM_API_KEY = 'YOUR_OPENWEATHERMAP_API_KEY'; 
const ASIA_BOUNDS: LngLatBoundsLike = [[60.0, -15.0], [150.0, 55.0]];

// --- DỮ LIỆU GIẢ LẬP ---
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

// --- TYPES ---
interface DashboardData {
  title: string; subtitle: string; coordinates: string;
  temp: number; feelsLike: number; humidity: number; pressure: number; 
  windSpeed: number; windDir: number; cloudCover: number; status: string;
}

interface HistoryItem {
  id: number;
  location: string;
  time: string;
  risk: 'High' | 'Medium' | 'Low';
  type: string;
}

interface LayerState { storm: boolean; rain: boolean; wind: boolean; temp: boolean; }

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'osm-tiles': { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '' }
  },
  layers: [{ id: 'osm-layer', type: 'raster', source: 'osm-tiles', minzoom: 0, maxzoom: 19, paint: { 'raster-opacity': 1, 'raster-saturation': -0.8, 'raster-contrast': 0.1 } }] 
} as StyleSpecification;

const SafeWaveApp = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreInstance | null>(null);
  const markerRef = useRef<Marker | null>(null);
  
  const [inputLocation, setInputLocation] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [isAIConsoleOpen, setIsAIConsoleOpen] = useState(true);
  const [consoleTab, setConsoleTab] = useState<'analysis' | 'history'>('analysis');
  
  const [activeLayers, setActiveLayers] = useState<LayerState>({ storm: true, rain: false, wind: false, temp: false });
  const [dashboardInfo, setDashboardInfo] = useState<DashboardData>({ 
    title: 'Sẵn sàng', subtitle: 'Chọn vị trí trên bản đồ', coordinates: '--', 
    temp: 0, feelsLike: 0, humidity: 0, pressure: 0, windSpeed: 0, windDir: 0, cloudCover: 0, status: 'Standby' 
  });

  const [historyList, setHistoryList] = useState<HistoryItem[]>([
    { id: 1, location: 'Đa Nghịt, Lạc Dương', time: '10:05 AM', risk: 'High', type: 'Sạt lở đất' },
    { id: 2, location: 'Phường 12, Đà Lạt', time: '09:42 AM', risk: 'Medium', type: 'Ngập úng' },
    { id: 3, location: 'Liên Khương, Đức Trọng', time: '08:15 AM', risk: 'Low', type: 'An toàn' },
  ]);

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [108.45, 11.95],
      zoom: 10, pitch: 45, bearing: 0, maxPitch: 85, attributionControl: false,
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

      const GEO_PROVINCE = 'https://raw.githubusercontent.com/namchel/vietnam-map-data/master/data/geo/province.geojson';
      map.addSource('admin-province', { type: 'geojson', data: GEO_PROVINCE });
      map.addLayer({ id: 'border-province', type: 'line', source: 'admin-province', paint: { 'line-color': '#a5b4fc', 'line-width': 1, 'line-opacity': 0.4 } });

      map.on('click', async (e) => {
        const { lng, lat } = e.lngLat;
        const coordsText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

        if (markerRef.current) markerRef.current.remove();
        const el = document.createElement('div'); el.className = 'neon-marker-container'; 
        el.innerHTML = `<div class="neon-core"></div><div class="neon-pulse"></div>`;
        markerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);

        setDashboardInfo(prev => ({ ...prev, title: 'Đang tải...', subtitle: 'Đang phân tích dữ liệu...', coordinates: coordsText }));
        setIsAIConsoleOpen(true);
        setConsoleTab('analysis');
        setAnalyzing(true);

        let line1 = 'Vị trí đã chọn', line2 = '';
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
            const data = await res.json();
            if (data?.address) {
                const a = data.address;
                line1 = [a.quarter, a.village, a.town, a.ward].filter(Boolean).join(', ') || a.road || 'Vị trí chưa xác định';
                line2 = a.city || a.state || '';
            }
        } catch {}
        setInputLocation(`${line1}, ${line2}`);

        try {
            const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,pressure_msl,wind_speed_10m,wind_direction_10m,cloud_cover&wind_speed_unit=kmh`);
            const wData = await wRes.json();
            if (wData.current) {
                 setDashboardInfo({
                    title: line1, subtitle: line2, coordinates: coordsText,
                    temp: wData.current.temperature_2m, feelsLike: wData.current.apparent_temperature,
                    humidity: wData.current.relative_humidity_2m, pressure: wData.current.pressure_msl,
                    windSpeed: wData.current.wind_speed_10m, windDir: wData.current.wind_direction_10m,
                    cloudCover: wData.current.cloud_cover, status: 'Live'
                 });
            }
        } catch {}

        setTimeout(() => {
            setAnalyzing(false);
            const randomRisk = Math.random();
            const riskLevel = randomRisk > 0.7 ? 'High' : (randomRisk > 0.4 ? 'Medium' : 'Low');
            const type = riskLevel === 'High' ? 'Cảnh báo sạt lở' : (riskLevel === 'Medium' ? 'Mưa lớn cục bộ' : 'An toàn');
            
            setHistoryList(prev => [
                { id: Date.now(), location: line1, time: new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}), risk: riskLevel, type: type },
                ...prev
            ]);
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
        }
        return next;
    });
  };

  return (
    <div className="relative w-full h-screen bg-[#020408] text-slate-200 overflow-hidden font-sans selection:bg-cyan-500/30">
      
      <div className="absolute inset-0 z-0"><div ref={mapContainerRef} className="w-full h-full bg-[#05060a]"/></div>

      <div className="absolute top-6 right-6 z-30 flex flex-col gap-3">
         {[
           { id: 'storm', icon: Zap, label: 'Bão', color: 'text-red-400' },
           { id: 'rain', icon: CloudRain, label: 'Mưa', color: 'text-blue-400' },
           { id: 'wind', icon: Wind, label: 'Gió', color: 'text-teal-400' },
           { id: 'temp', icon: Thermometer, label: 'Nhiệt', color: 'text-orange-400' }
         ].map((btn) => (
           <button 
             key={btn.id}
             onClick={() => toggleLayer(btn.id as keyof LayerState)} 
             className={`glass-btn w-12 h-12 rounded-2xl flex items-center justify-center ${activeLayers[btn.id as keyof LayerState] ? 'active' : ''}`}
             title={btn.label}
           >
              <btn.icon size={20} className={activeLayers[btn.id as keyof LayerState] ? 'drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]' : ''} />
           </button>
         ))}
      </div>

      <div className="absolute top-6 left-6 z-20 w-[360px] glass-card rounded-3xl overflow-hidden group">
        <div className="p-6 pb-4 border-b border-white/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-20 pointer-events-none">
             <Activity size={80} className="text-white translate-x-4 -translate-y-4" />
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-bold tracking-wider uppercase flex items-center gap-2 shadow-[0_0_10px_rgba(239,68,68,0.2)]">
              <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span></span>
              Live Monitoring
            </div>
          </div>
          <h2 className="text-2xl font-bold text-white leading-tight mb-1 text-glow truncate">{dashboardInfo.title}</h2>
          <p className="text-sm text-gray-400 font-medium truncate">{dashboardInfo.subtitle}</p>
          <div className="flex items-center gap-2 mt-4">
            <MapPin size={14} className="text-cyan-400 drop-shadow-[0_0_5px_rgba(34,211,238,0.8)]"/>
            <span className="text-xs font-mono text-cyan-200/80 tracking-wide">{dashboardInfo.coordinates}</span>
          </div>
        </div>
        <div className="p-6 pt-4">
           <div className="flex items-end justify-between mb-8">
              <div>
                 <div className="text-6xl font-bold text-white tracking-tighter text-glow-cyan leading-none">{Math.round(dashboardInfo.temp)}°</div>
                 <div className="text-xs text-gray-400 font-medium mt-2 pl-1">Cảm giác: <span className="text-gray-200 font-bold">{Math.round(dashboardInfo.feelsLike)}°</span></div>
              </div>
              <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5 text-blue-300 text-[11px] uppercase font-bold mb-1"><Wind size={14}/> Tốc độ gió</div>
                  <div className="text-2xl font-bold text-white">{dashboardInfo.windSpeed}<span className="text-sm text-gray-500 font-normal ml-1">km/h</span></div>
                  <div className="text-[10px] text-gray-500 mt-1">Hướng: {dashboardInfo.windDir}°</div>
              </div>
           </div>
           <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Độ ẩm', val: dashboardInfo.humidity + '%', icon: Droplets, color: 'text-cyan-400' },
                { label: 'Áp suất', val: dashboardInfo.pressure, unit: 'hPa', icon: Gauge, color: 'text-purple-400' },
                { label: 'Mây', val: dashboardInfo.cloudCover + '%', icon: Sun, color: 'text-yellow-400' }
              ].map((item, i) => (
                <div key={i} className="bg-white/5 rounded-2xl p-3 flex flex-col items-center justify-center gap-1.5 border border-white/5 hover:bg-white/10 transition group/item">
                    <item.icon size={16} className={`${item.color} group-hover/item:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)] transition-all`} />
                    <span className="text-sm font-bold text-white mt-1">{item.val}<span className="text-[9px] text-gray-500 ml-0.5 font-normal">{item.unit}</span></span>
                    <span className="text-[9px] text-gray-500 uppercase font-semibold tracking-wider">{item.label}</span>
                </div>
              ))}
           </div>
        </div>
      </div>

      {isAIConsoleOpen ? (
        <div className="absolute top-6 z-40 w-[400px] glass-card rounded-3xl overflow-hidden flex flex-col transition-all duration-300" style={{ right: 88, maxHeight: 'calc(100vh - 48px)' }}>
           
           <div className="bg-white/5 border-b border-white/5">
               <div className="p-4 flex justify-between items-center">
                  <div className="flex gap-2.5 items-center">
                      <ShieldCheck className="text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.6)]" size={18}/>
                      <span className="text-white font-bold text-sm tracking-wide text-glow">SafeWave AI</span>
                  </div>
                  <button onClick={() => setIsAIConsoleOpen(false)} className="text-gray-400 hover:text-white transition"><X size={18}/></button>
               </div>
               
               <div className="flex px-4 pb-0 gap-6 text-sm font-medium relative">
                  <button 
                    onClick={() => setConsoleTab('analysis')}
                    className={`pb-3 relative transition-colors ${consoleTab === 'analysis' ? 'text-cyan-400 text-glow-cyan' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    Phân tích rủi ro
                    {consoleTab === 'analysis' && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-cyan-400 shadow-[0_0_10px_#22d3ee]"></span>}
                  </button>
                  <button 
                    onClick={() => setConsoleTab('history')}
                    className={`pb-3 relative transition-colors ${consoleTab === 'history' ? 'text-purple-400 text-glow' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    Lịch sử & Cảnh báo
                    {consoleTab === 'history' && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-purple-400 shadow-[0_0_10px_#c084fc]"></span>}
                  </button>
               </div>
           </div>
           
           <div className="p-5 flex-1 overflow-y-auto custom-scrollbar">
              
              {consoleTab === 'analysis' && (
                <div className="flex flex-col gap-4">
                    <div className="relative">
                        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"/>
                        <input 
                          value={inputLocation} 
                          onChange={e => setInputLocation(e.target.value)} 
                          className="w-full bg-[#05060a]/50 border border-white/10 focus:border-cyan-500/50 rounded-xl py-3 pl-10 pr-4 text-xs text-white placeholder-gray-600 outline-none transition-all" 
                          placeholder="Địa điểm đang chọn..."
                          readOnly
                        />
                    </div>

                    {analyzing ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-4">
                            <div className="loader-spin border-t-cyan-400 border-r-cyan-400"></div>
                            <span className="text-xs font-mono text-cyan-400 animate-pulse">AI đang tổng hợp dữ liệu địa hình...</span>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            <div className="bg-gradient-to-br from-red-500/10 to-orange-500/5 border border-red-500/20 rounded-xl p-4 relative overflow-hidden group hover:border-red-500/40 transition">
                                <div className="absolute top-0 right-0 p-2 opacity-30 group-hover:opacity-50 transition"><AlertTriangle size={40} className="text-red-500"/></div>
                                <h3 className="text-xs font-bold text-red-400 uppercase tracking-widest mb-1">Cảnh báo rủi ro</h3>
                                <div className="text-2xl font-bold text-white mb-2 text-glow-red">CAO</div>
                                {/* ĐÃ SỬA LỖI Ở DÒNG DƯỚI ĐÂY: Thay > bằng &gt; */}
                                <p className="text-xs text-gray-400 leading-relaxed w-[90%]">Khu vực có địa hình dốc &gt; 25°. Độ ẩm đất bão hòa. Nguy cơ sạt lở cao trong 12h tới.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-white/5 border border-white/5 rounded-xl p-3">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[10px] text-gray-400 uppercase">Lượng mưa</span>
                                        <CloudRain size={12} className="text-blue-400"/>
                                    </div>
                                    <div className="text-lg font-bold text-white">45mm<span className="text-[10px] text-gray-500">/3h</span></div>
                                    <div className="w-full bg-gray-700 h-1 rounded-full mt-2 overflow-hidden"><div className="bg-blue-500 h-full w-[70%]"></div></div>
                                </div>
                                <div className="bg-white/5 border border-white/5 rounded-xl p-3">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[10px] text-gray-400 uppercase">Độ ẩm đất</span>
                                        <Droplets size={12} className="text-green-400"/>
                                    </div>
                                    <div className="text-lg font-bold text-white">82%<span className="text-[10px] text-gray-500"> SAT</span></div>
                                    <div className="w-full bg-gray-700 h-1 rounded-full mt-2 overflow-hidden"><div className="bg-green-500 h-full w-[82%]"></div></div>
                                </div>
                            </div>

                            <button onClick={() => setAnalyzing(true)} className="mt-2 w-full bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 border border-cyan-500/30 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2">
                                <Activity size={14}/> Cập nhật phân tích
                            </button>
                        </div>
                    )}
                </div>
              )}

              {consoleTab === 'history' && (
                  <div className="flex flex-col gap-3">
                      {historyList.map((item) => (
                          <div key={item.id} className="bg-[#0b0f16]/60 border border-white/5 hover:border-white/10 rounded-xl p-3 transition flex gap-3 items-center group cursor-pointer">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                                  item.risk === 'High' ? 'bg-red-500/10 text-red-500' : 
                                  item.risk === 'Medium' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-green-500/10 text-green-500'
                              }`}>
                                  {item.risk === 'High' ? <AlertTriangle size={18}/> : item.risk === 'Medium' ? <Activity size={18}/> : <CheckCircle2 size={18}/>}
                              </div>
                              <div className="flex-1 min-w-0">
                                  <div className="flex justify-between items-start">
                                      <h4 className="text-xs font-bold text-gray-200 truncate pr-2">{item.location}</h4>
                                      <span className="text-[10px] font-mono text-gray-500 shrink-0">{item.time}</span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-1">
                                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                          item.risk === 'High' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                                          item.risk === 'Medium' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' :
                                          'bg-green-500/10 border-green-500/20 text-green-400'
                                      }`}>
                                          {item.type}
                                      </span>
                                  </div>
                              </div>
                              <ChevronRight size={14} className="text-gray-600 group-hover:text-white transition"/>
                          </div>
                      ))}
                      <button className="text-[10px] text-center text-gray-500 hover:text-cyan-400 mt-2 transition uppercase font-bold tracking-widest">
                          Xem toàn bộ lịch sử
                      </button>
                  </div>
              )}
           </div>
        </div>
      ) : (
        <button 
            onClick={() => setIsAIConsoleOpen(true)} 
            className="absolute top-6 z-30 glass-btn px-5 py-3 rounded-2xl text-white text-xs font-bold border border-white/10 flex items-center gap-2 group" 
            style={{ right: 88 }}
        >
            <ShieldCheck size={16} className="text-blue-400 group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]"/>
            AI Reports
        </button>
      )}
    </div>
  );
};

export default SafeWaveApp;