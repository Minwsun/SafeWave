import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreInstance, type StyleSpecification, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Activity,
  Droplets,
  Gauge,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Wind,
  X
} from 'lucide-react';

// --- DATA SOURCES (ADMIN BOUNDARIES) ---
const GEO_PROVINCE = 'https://raw.githubusercontent.com/namchel/vietnam-map-data/master/data/geo/province.geojson';
const GEO_DISTRICT = 'https://raw.githubusercontent.com/namchel/vietnam-map-data/master/data/geo/district.geojson';
// Lưu ý: GeoJSON Xã (Ward) rất nặng, chỉ nên load khi zoom sâu hoặc dùng API. 
// Ở đây ta dùng API Nominatim để lấy tên Xã khi click, còn ranh giới chỉ vẽ Tỉnh/Huyện để mượt.

// --- TYPES ---
interface DashboardData {
  title: string;       // Dòng 1: Xã, Huyện
  subtitle: string;    // Dòng 2: Tỉnh
  coordinates: string;
  temp: number; feelsLike: number; humidity: number; pressure: number; windSpeed: number; windDir: number; cloudCover: number;
  status: string;
}

// --- MAP STYLE (COLORFUL OSM) ---
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
      minzoom: 0, maxzoom: 19,
      paint: { 'raster-opacity': 1 }
    }
  ]
} as StyleSpecification;

const SafeWaveApp = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreInstance | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  
  const [inputLocation, setInputLocation] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [isAIConsoleOpen, setIsAIConsoleOpen] = useState(true);

  const [dashboardInfo, setDashboardInfo] = useState<DashboardData>({ 
    title: 'Sẵn sàng', subtitle: 'Chọn điểm trên bản đồ', coordinates: '--', 
    temp: 0, feelsLike: 0, humidity: 0, pressure: 0, windSpeed: 0, windDir: 0, cloudCover: 0, status: 'Standby' 
  });

  // --- MAP INIT ---
  useEffect(() => {
    if (mapRef.current) return;
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [106.41, 10.53], // Focus vào khu vực Phường Khánh Hậu (Long An) để test
      zoom: 12, 
      pitch: 60, 
      bearing: 0, 
      maxPitch: 85, 
      attributionControl: false
    });
    mapRef.current = map;

    map.on('load', () => {
      // 1. TERRAIN & HILLSHADE (Đổ bóng địa hình)
      map.addSource('terrain-source', { 
        type: 'raster-dem', 
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], 
        encoding: 'terrarium', tileSize: 256, maxzoom: 12 
      });
      map.setTerrain({ source: 'terrain-source', exaggeration: 1.5 });

      map.addLayer({
        id: 'hillshade-layer',
        type: 'hillshade',
        source: 'terrain-source',
        layout: { visibility: 'visible' },
        paint: {
          'hillshade-shadow-color': '#000000', 
          'hillshade-highlight-color': '#ffffff', 
          'hillshade-exaggeration': 1.0, 
          'hillshade-opacity': 0.4 
        }
      });

      // 2. HIGHLIGHT RANH GIỚI (Admin Boundaries)
      // Thêm Tỉnh (Cấp 1) - Đường viền đậm
      map.addSource('admin-province', { type: 'geojson', data: GEO_PROVINCE });
      map.addLayer({
        id: 'border-province',
        type: 'line',
        source: 'admin-province',
        paint: {
          'line-color': '#4f46e5', // Màu Indigo đậm
          'line-width': 2,
          'line-opacity': 0.8
        }
      });

      // Thêm Huyện (Cấp 2) - Đường viền nét đứt hoặc mỏng hơn
      map.addSource('admin-district', { type: 'geojson', data: GEO_DISTRICT });
      map.addLayer({
        id: 'border-district',
        type: 'line',
        source: 'admin-district',
        minzoom: 8, // Chỉ hiện khi zoom vào đủ sâu
        paint: {
          'line-color': '#6366f1', // Màu Indigo nhạt hơn
          'line-width': 1,
          'line-dasharray': [2, 2], // Nét đứt
          'line-opacity': 0.6
        }
      });

      // 3. EVENTS (Click & Marker)
      map.on('click', async (e) => {
        const { lng, lat } = e.lngLat;
        const coordsText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

        // A. MARKER
        if (markerRef.current) markerRef.current.remove();
        const el = document.createElement('div');
        el.className = 'neon-marker-container';
        el.innerHTML = `<div class="neon-core"></div><div class="neon-pulse"></div>`;
        const newMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
        markerRef.current = newMarker;

        // B. XỬ LÝ ĐỊA CHỈ (Logic mới: Cấp 3, 2 / Cấp 1)
        let line1 = 'Đang tải...'; // Cấp 3, Cấp 2
        let line2 = '';            // Cấp 1
        
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
            const data = await res.json();
            if (data && data.address) {
                const a = data.address;
                
                // Lấy Cấp 3 (Phường/Xã/Thị trấn)
                const level3 = a.quarter || a.village || a.hamlet || a.town || a.ward || a.neighbourhood || '';
                
                // Lấy Cấp 2 (Quận/Huyện/Thị xã)
                const level2 = a.suburb || a.district || a.county || a.city_district || '';
                
                // Lấy Cấp 1 (Tỉnh/Thành phố)
                const level1 = a.city || a.state || '';

                // Logic ghép chuỗi
                // Nếu có Cấp 3: "Phường X, Quận Y"
                // Nếu không có Cấp 3: "Quận Y"
                const topParts = [level3, level2].filter(Boolean); // Lọc bỏ rỗng
                line1 = topParts.length > 0 ? topParts.join(', ') : (a.road || 'Vị trí chưa xác định');
                
                line2 = level1; // Dòng dưới luôn là Tỉnh/TP
            }
        } catch (err) { 
            line1 = 'Lỗi kết nối'; 
        }
        
        const fullName = `${line1}${line2 ? `, ${line2}` : ''}`;
        setInputLocation(fullName);

        // C. THỜI TIẾT
        try {
            const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,pressure_msl,wind_speed_10m,wind_direction_10m,cloud_cover&wind_speed_unit=kmh`);
            const wData = await wRes.json();
            if (wData.current) {
                 setDashboardInfo({
                    title: line1,
                    subtitle: line2,
                    coordinates: coordsText,
                    temp: wData.current.temperature_2m,
                    feelsLike: wData.current.apparent_temperature,
                    humidity: wData.current.relative_humidity_2m,
                    pressure: wData.current.pressure_msl,
                    windSpeed: wData.current.wind_speed_10m,
                    windDir: wData.current.wind_direction_10m,
                    cloudCover: wData.current.cloud_cover,
                    status: 'Live'
                 });
            }
        } catch (e) { console.error(e); }

        // D. POPUP UI (Cập nhật style hiển thị 2 dòng)
        if (popupRef.current) popupRef.current.remove();
        
        const popupContent = `
            <div class="flex flex-col min-w-[200px]">
                <div class="text-[13px] font-bold text-white leading-tight mb-0.5">${line1}</div>
                ${line2 ? `<div class="text-[11px] text-gray-300 font-medium uppercase tracking-wide border-b border-white/10 pb-2 mb-2">${line2}</div>` : ''}
                <div class="flex items-center gap-2 text-[10px] text-cyan-400 font-mono bg-cyan-950/40 p-1.5 rounded w-fit">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                    ${coordsText}
                </div>
            </div>
        `;

        const newPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 25, className: 'custom-dark-popup' })
            .setLngLat([lng, lat])
            .setHTML(popupContent)
            .addTo(map);
        popupRef.current = newPopup;
      });
    });
  }, []);

  return (
    <div className="relative w-full h-screen bg-[#05060a] text-slate-200 overflow-hidden font-sans">
      {/* CSS RIÊNG CHO MARKER & POPUP */}
      <style>{`
        .neon-marker-container { position: relative; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; }
        .neon-core { width: 10px; height: 10px; background-color: #fff; border-radius: 50%; z-index: 2; box-shadow: 0 0 8px #22d3ee; }
        .neon-pulse { position: absolute; width: 100%; height: 100%; border-radius: 50%; background-color: rgba(34, 211, 238, 0.6); animation: neon-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite; z-index: 1; }
        @keyframes neon-ping { 75%, 100% { transform: scale(2.5); opacity: 0; } }

        .custom-dark-popup .maplibregl-popup-content {
          background: rgba(11, 15, 22, 0.9) !important;
          backdrop-filter: blur(12px) !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          border-radius: 12px !important;
          padding: 14px !important;
          color: white !important;
        }
        .custom-dark-popup .maplibregl-popup-tip { border-top-color: rgba(11, 15, 22, 0.9) !important; }
        .custom-dark-popup .maplibregl-popup-close-button { color: #64748b; top: 8px; right: 8px; }
        .custom-dark-popup .maplibregl-popup-close-button:hover { color: white; background: none; }
      `}</style>

      {/* MAP CONTAINER */}
      <div className="absolute inset-0 z-0"><div ref={mapContainerRef} className="w-full h-full bg-gray-900"/></div>

      {/* DASHBOARD CARD (Đã cập nhật hiển thị Cấp 3,2 / Cấp 1) */}
      <div className="absolute top-6 left-6 z-20 w-[340px] bg-[#0b0f16]/80 backdrop-blur-xl border border-white/10 rounded-[24px] shadow-2xl overflow-hidden group hover:border-white/20 transition-all">
        {/* Header */}
        <div className="p-5 border-b border-white/5 bg-gradient-to-r from-transparent to-white/5">
          <div className="flex items-center gap-2 mb-2">
            <div className="px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 text-[9px] font-bold tracking-wider uppercase flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span></span>
              Live Data
            </div>
          </div>
          {/* Dòng 1: Cấp 3, Cấp 2 */}
          <h2 className="text-xl font-bold text-white leading-tight mb-1 break-words">{dashboardInfo.title}</h2>
          {/* Dòng 2: Cấp 1 */}
          {dashboardInfo.subtitle && <p className="text-sm text-gray-400 font-medium uppercase tracking-wide">{dashboardInfo.subtitle}</p>}
          
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
            <MapPin size={12} className="text-cyan-400"/>
            <span className="text-[10px] font-mono text-cyan-200/70 tracking-wide">{dashboardInfo.coordinates}</span>
          </div>
        </div>
        
        {/* Stats Grid */}
        <div className="p-5">
           <div className="flex items-end justify-between mb-6">
              <div>
                 <div className="text-5xl font-bold text-white tracking-tighter">{Math.round(dashboardInfo.temp)}°</div>
                 <div className="text-[11px] text-gray-400 font-medium mt-1">Cảm giác: <span className="text-gray-200">{Math.round(dashboardInfo.feelsLike)}°</span></div>
              </div>
              <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5 text-blue-300 text-[10px] uppercase font-bold mb-1"><Wind size={12}/> Gió</div>
                  <div className="text-lg font-bold text-white">{dashboardInfo.windSpeed}<span className="text-xs text-gray-500 font-normal ml-1">km/h</span></div>
              </div>
           </div>

           <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Độ ẩm', val: dashboardInfo.humidity + '%', icon: Droplets, color: 'text-cyan-400' },
                { label: 'Áp suất', val: dashboardInfo.pressure + 'hPa', icon: Gauge, color: 'text-purple-400' },
                { label: 'Mây', val: dashboardInfo.cloudCover + '%', icon: Sun, color: 'text-yellow-400' }
              ].map((item, i) => (
                <div key={i} className="bg-white/5 p-2.5 rounded-2xl border border-white/5 flex flex-col items-center justify-center gap-1 hover:bg-white/10 transition">
                    <item.icon size={14} className={item.color} />
                    <span className="text-xs font-bold text-white mt-1">{item.val}</span>
                    <span className="text-[9px] text-gray-500 uppercase font-medium">{item.label}</span>
                </div>
              ))}
           </div>
        </div>
      </div>

      {/* AI CONSOLE */}
      {isAIConsoleOpen ? (
        <div className="absolute top-6 z-40 w-[360px] bg-[#0b0f16]/90 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden" style={{ right: 24 }}>
           <div className="p-4 border-b border-white/10 flex justify-between items-center"><div className="flex gap-2 items-center"><ShieldCheck className="text-blue-400" size={18}/><span className="text-white font-bold text-sm">AI Analysis</span></div><button onClick={() => setIsAIConsoleOpen(false)}><X size={16} className="text-gray-500 hover:text-white"/></button></div>
           <div className="p-4">
              <input value={inputLocation} onChange={e => setInputLocation(e.target.value)} className="w-full bg-black/40 border border-gray-700 focus:border-blue-500 rounded-xl p-3 text-sm mb-3 outline-none text-white transition" placeholder="Chọn vị trí để phân tích..."/>
              <button onClick={() => setAnalyzing(true)} disabled={analyzing} className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-xl text-white text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-lg shadow-blue-900/20">{analyzing ? <Activity className="animate-spin" size={16}/> : <ShieldAlert size={16}/>} Chạy mô phỏng rủi ro</button>
           </div>
        </div>
      ) : (
        <button onClick={() => setIsAIConsoleOpen(true)} className="absolute top-6 z-30 bg-[#0b0f16]/80 px-4 py-2 rounded-2xl text-white text-xs border border-white/10 shadow-lg hover:border-blue-500 transition-colors" style={{ right: 24 }}>Open Console</button>
      )}
    </div>
  );
};

export default SafeWaveApp;