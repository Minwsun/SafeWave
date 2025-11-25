import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreInstance, type StyleSpecification, type LngLatBoundsLike, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Activity, CloudRain, Droplets, Gauge, MapPin, 
  ShieldCheck, Sun, Wind, X, Zap, Search,
  History, AlertTriangle, CheckCircle2, Minus, LayoutDashboard,
  RefreshCw, Maximize2, Siren, Mountain, ArrowUp, ArrowDown, Waves, Umbrella, Navigation, Info, Clock,
  Gamepad2, Radio
} from 'lucide-react';

// --- CẤU HÌNH API & DỮ LIỆU ---
const OWM_API_KEY = import.meta.env.VITE_OWM_API_KEY || ''; 
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

// Bảng màu
const RISK_COLORS = {
  safe: '#10b981',      
  normal: '#facc15',    
  medium: '#f97316',    
  critical: '#ef4444',  
  default: 'rgba(255,255,255,0.05)' 
};

// --- TYPES ---
interface RainStats {
  h1: number; h2: number; h3: number; h5: number; h12: number; h24: number;
  d3: number; d7: number; d14: number;
}

interface DashboardData {
  title: string; subtitle: string; coordinates: string;
  temp: number; feelsLike: number; 
  tempMin: number; tempMax: number; 
  humidity: number; 
  pressureSea: number; pressureGround: number; 
  windSpeed: number; windDir: number; 
  windGusts: number; 
  cloudCover: number; 
  elevation: number; 
  uvIndex: number; 
  rainStats: RainStats; 
  status: string;
}

type RiskLevel = 'Nguy hiểm' | 'Cảnh báo' | 'Nhẹ' | 'An toàn';

interface HistoryItem {
  id: number; // Timestamp
  location: string; 
  risk: RiskLevel; 
  type: string;
}

interface AlertItem {
  id: number; location: string; province: string; 
  level: RiskLevel; 
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

// --- UTILS: TIME FORMATTER ---
const formatHistoryTime = (timestamp: number) => {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    const dateStr = new Date(timestamp).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    
    if (diffDays === 0) {
        if (diffHours < 1) return `Vừa xong • ${dateStr}`;
        return `${diffHours} giờ trước • ${dateStr}`;
    }
    return `${diffDays} ngày trước • ${dateStr}`;
};

// --- MOCK ALERTS GENERATOR (Used for Simulation) ---
const PROVINCES_MOCK = ['Lào Cai', 'Yên Bái', 'Hà Giang', 'Cao Bằng', 'Quảng Ninh', 'Hải Phòng', 'Thanh Hóa', 'Nghệ An', 'Quảng Bình', 'Thừa Thiên Huế'];
const ALERT_TYPES = ['Sạt lở đất', 'Lũ quét', 'Ngập úng diện rộng', 'Giông lốc mạnh'];

const generateMockAlerts = (isSim: boolean): AlertItem[] => {
  const alerts: AlertItem[] = [];
  // Nếu là Sim Mode: Tạo nhiều cảnh báo nguy hiểm giả lập
  const count = isSim ? Math.floor(Math.random() * 5) + 3 : 0; 
  
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    let level: RiskLevel = 'An toàn';
    // Sim mode: Tỉ lệ nguy hiểm cao
    if (r > 0.4) level = 'Nguy hiểm';      
    else if (r > 0.2) level = 'Cảnh báo';   
    else level = 'Nhẹ';        
    
    const prov = PROVINCES_MOCK[Math.floor(Math.random() * PROVINCES_MOCK.length)];
    // Tọa độ random quanh khu vực miền Bắc/Trung
    const lat = 19 + Math.random() * 4; 
    const lng = 104 + Math.random() * 4;

    alerts.push({
      id: Date.now() + i,
      location: `Huyện ${['Bảo Yên', 'Bát Xát', 'Mù Cang Chải', 'Bắc Hà', 'Nguyên Bình'][Math.floor(Math.random()*5)]}`,
      province: prov, level: level, type: ALERT_TYPES[Math.floor(Math.random() * ALERT_TYPES.length)],
      timestamp: new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'}),
      rainAmount: Math.floor(Math.random() * 150) + 50, windSpeed: Math.floor(Math.random() * 80) + 20,
      description: level === 'Nguy hiểm' ? 'Đất bão hòa nước >95%. Nguy cơ sạt lở rất cao.' : (level === 'Cảnh báo' ? 'Mưa lớn kéo dài, nguy cơ ngập úng vùng trũng.' : 'Mưa kéo dài, đất đá có dấu hiệu sạt trượt nhẹ.'),
      coords: [lng, lat] as [number, number]
    });
  }
  const priority = { 'Nguy hiểm': 3, 'Cảnh báo': 2, 'Nhẹ': 1, 'An toàn': 0 };
  return alerts.sort((a, b) => priority[b.level] - priority[a.level]);
};

// Styles Helper
const getAlertStyles = (level: RiskLevel) => {
    switch (level) {
        case 'Nguy hiểm':
            return {
                border: 'border-red-500/20', shadow: 'shadow-[0_0_50px_rgba(239,68,68,0.2)]',
                iconBg: 'bg-red-500/20 border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.4)]', iconText: 'text-red-500',
                titleText: 'text-red-400', riskText: 'text-red-400 shadow-red-500',
                barBg: 'bg-red-500/5 border-red-500/20', barFill: 'from-red-500 to-red-600 shadow-[0_0_10px_red]', barWidth: 'w-full',
                quoteBorder: 'border-red-500/50',
                btnBg: 'bg-red-600 hover:bg-red-500 shadow-[0_0_20px_rgba(220,38,38,0.4)]',
                // New props for Marker
                markerSize: 'w-10 h-10', markerColor: 'bg-red-500', markerShadow: 'shadow-[0_0_25px_rgba(239,68,68,0.8)]'
            };
        case 'Cảnh báo':
            return {
                border: 'border-orange-500/20', shadow: 'shadow-[0_0_50px_rgba(249,115,22,0.2)]',
                iconBg: 'bg-orange-500/20 border-orange-500/30 shadow-[0_0_20px_rgba(249,115,22,0.4)]', iconText: 'text-orange-500',
                titleText: 'text-orange-400', riskText: 'text-orange-400 shadow-orange-500',
                barBg: 'bg-orange-500/5 border-orange-500/20', barFill: 'from-orange-400 to-orange-600 shadow-[0_0_10px_orange]', barWidth: 'w-[75%]',
                quoteBorder: 'border-orange-500/50',
                btnBg: 'bg-orange-600 hover:bg-orange-500 shadow-[0_0_20px_rgba(234,88,12,0.4)]',
                markerSize: 'w-7 h-7', markerColor: 'bg-orange-500', markerShadow: 'shadow-[0_0_20px_rgba(249,115,22,0.6)]'
            };
        case 'Nhẹ':
            return {
                border: 'border-yellow-400/20', shadow: 'shadow-[0_0_50px_rgba(250,204,21,0.2)]',
                iconBg: 'bg-yellow-400/20 border-yellow-400/30 shadow-[0_0_20px_rgba(250,204,21,0.4)]', iconText: 'text-yellow-400',
                titleText: 'text-yellow-300', riskText: 'text-yellow-400 shadow-yellow-400',
                barBg: 'bg-yellow-400/5 border-yellow-400/20', barFill: 'from-yellow-300 to-yellow-500 shadow-[0_0_10px_yellow]', barWidth: 'w-[50%]',
                quoteBorder: 'border-yellow-400/50',
                btnBg: 'bg-yellow-600 hover:bg-yellow-500 text-black shadow-[0_0_20px_rgba(202,138,4,0.4)]',
                markerSize: 'w-5 h-5', markerColor: 'bg-yellow-400', markerShadow: 'shadow-[0_0_15px_rgba(250,204,21,0.5)]'
            };
        case 'An toàn':
        default:
            return {
                border: 'border-emerald-500/20', shadow: 'shadow-[0_0_50px_rgba(16,185,129,0.2)]',
                iconBg: 'bg-emerald-500/20 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.4)]', iconText: 'text-emerald-500',
                titleText: 'text-emerald-400', riskText: 'text-emerald-400 shadow-emerald-500',
                barBg: 'bg-emerald-500/5 border-emerald-500/20', barFill: 'from-emerald-400 to-emerald-600 shadow-[0_0_10px_emerald]', barWidth: 'w-[25%]',
                quoteBorder: 'border-emerald-500/50',
                btnBg: 'bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_20px_rgba(5,150,105,0.4)]',
                markerSize: 'w-3 h-3', markerColor: 'bg-emerald-500', markerShadow: 'shadow-[0_0_10px_rgba(16,185,129,0.4)]'
            };
    }
};

const SafeWaveApp = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreInstance | null>(null);
  const markerRef = useRef<Marker | null>(null); // Marker cho user click
  const alertMarkersRef = useRef<Marker[]>([]);   // Mảng marker cho alerts
  
  // --- STATE SYSTEM ---
  const [isSimMode, setIsSimMode] = useState(false); // Toggle giữa Realtime & Simulation

  const [inputLocation, setInputLocation] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  
  const [isAIConsoleOpen, setIsAIConsoleOpen] = useState(true);
  const [isDashboardOpen, setIsDashboardOpen] = useState(true);
  
  const [consoleTab, setConsoleTab] = useState<'analysis' | 'alerts' | 'history'>('analysis');
  // Mặc định bật adminMap và Storm, các layer khác có thể ẩn hoặc hiển thị mặc định
  const [activeLayers, setActiveLayers] = useState<LayerState>({ storm: true, rain: false, wind: false, temp: false, adminMap: true });
  
  const [dashboardInfo, setDashboardInfo] = useState<DashboardData>({ 
    title: 'Sẵn sàng', subtitle: 'Hệ thống đang chờ lệnh', coordinates: '--', 
    temp: 0, feelsLike: 0, tempMin: 0, tempMax: 0,
    humidity: 0, pressureSea: 0, pressureGround: 0,
    windSpeed: 0, windDir: 0, windGusts: 0, cloudCover: 0, 
    elevation: 0, uvIndex: 0,
    rainStats: { h1: 0, h2: 0, h3: 0, h5: 0, h12: 0, h24: 0, d3: 0, d7: 0, d14: 0 },
    status: 'Standby' 
  });

  const [historyList, setHistoryList] = useState<HistoryItem[]>([
    { id: Date.now() - 3600000 * 2, location: 'Đa Nghịt, Lạc Dương', risk: 'Nguy hiểm', type: 'Sạt lở đất' }, 
    { id: Date.now() - 86400000 * 3, location: 'Phường 12, Đà Lạt', risk: 'Nhẹ', type: 'Ngập úng' },
  ]);
  const [nationalAlerts, setNationalAlerts] = useState<AlertItem[]>([]);
  const [lastScanTime, setLastScanTime] = useState<string>('--:--');
  const [isScanning, setIsScanning] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<AlertItem | null>(null); 

  // [UPDATED] Function to create fake simulation data with REALISTIC RAIN DISTRIBUTION
  const createSimulationData = (lat: number, lng: number): DashboardData => {
     // Tạo base rain ngẫu nhiên từ 30mm - 60mm (Mưa rất to)
     const baseHourlyRain = 30 + Math.random() * 30; 
     
     // Hàm biến thiên để giả lập các đợt mưa không đều
     const noise = (factor: number) => 0.8 + Math.random() * factor;

     return {
        title: 'Vùng tâm bão (SIM)', subtitle: 'Dữ liệu mô phỏng cực đoan', 
        coordinates: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        temp: 24 + Math.random() * 3, feelsLike: 22,
        tempMin: 21, tempMax: 26,
        humidity: 96 + Math.random() * 4,
        pressureSea: 965 + Math.random() * 10,
        pressureGround: 960,
        windSpeed: 90 + Math.random() * 40, windDir: Math.floor(Math.random() * 360), windGusts: 140 + Math.random() * 40,
        cloudCover: 100, elevation: 150, uvIndex: 0,
        
        // LOGIC MƯA TÍCH LŨY THÔNG MINH (Smart Accumulation)
        rainStats: { 
            // Ngắn hạn: Tính theo giờ với độ biến thiên
            h1: baseHourlyRain, 
            h2: baseHourlyRain * 1.8 * noise(0.2), 
            h3: baseHourlyRain * 2.6 * noise(0.2), 
            h5: baseHourlyRain * 4.2 * noise(0.3), 
            h12: baseHourlyRain * 9.5 * noise(0.4), 
            h24: baseHourlyRain * 16.0 * noise(0.5), // ~500-800mm (Mức thảm họa)
            
            // Dài hạn: Giả lập bão đi qua sau 3 ngày -> mưa giảm dần
            d3: baseHourlyRain * 24 * 1.5, 
            d7: baseHourlyRain * 24 * 1.8,
            d14: baseHourlyRain * 24 * 2.0 
        },
        status: 'Simulation'
     };
  };

  const runSystemScan = () => {
    setIsScanning(true);
    setTimeout(() => {
      // Logic phân biệt Real/Sim cho Alerts
      if (isSimMode) {
          const newAlerts = generateMockAlerts(true);
          setNationalAlerts(newAlerts);
      } else {
          // Real mode: Ở đây ta không có API sạt lở thực, nên trả về 1 thông báo an toàn hoặc monitoring
          setNationalAlerts([]); // Clear nếu không có dữ liệu thực
      }
      setLastScanTime(new Date().toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'}));
      setIsScanning(false);
    }, 2000);
  };

  useEffect(() => {
    runSystemScan(); 
    // Khi đổi mode, chạy lại scan ngay
  }, [isSimMode]);

  useEffect(() => {
    const interval = setInterval(runSystemScan, 30 * 60 * 1000); 
    return () => clearInterval(interval);
  }, []);

  const simulateAdminRisk = (map: MapLibreInstance) => {
    ['source-province', 'source-district', 'source-ward'].forEach(sourceId => {
        const features = map.querySourceFeatures(sourceId, { sourceLayer: sourceId }); 
        features.forEach((f) => {
            if (!f.id) return;
            // Nếu SimMode: Random màu đỏ/cam. Nếu RealMode: Xanh (An toàn)
            let level = 0;
            if (isSimMode) {
                const r = Math.random();
                level = r > 0.85 ? 3 : (r > 0.6 ? 2 : (r > 0.3 ? 1 : 0));
            } else {
                level = 0; 
            }
            map.setFeatureState({ source: sourceId, id: f.id }, { riskLevel: level });
        });
    });
  };

  // Re-run risk map simulation when mode changes
  useEffect(() => {
    if(mapRef.current) simulateAdminRisk(mapRef.current);
  }, [isSimMode]);

  // --- LOGIC HIỂN THỊ ALERT MARKERS ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 1. Xóa các marker cũ
    alertMarkersRef.current.forEach(marker => marker.remove());
    alertMarkersRef.current = [];

    // 2. Tạo marker mới dựa trên nationalAlerts
    nationalAlerts.forEach(alert => {
        const styles = getAlertStyles(alert.level);
        
        // Tạo DOM element cho marker (Pin tròn)
        const el = document.createElement('div');
        el.className = 'flex items-center justify-center cursor-pointer group relative';
        
        // Inner HTML: Hiệu ứng pulse + core
        el.innerHTML = `
            <div class="absolute inset-0 rounded-full animate-ping opacity-75 ${styles.markerColor}"></div>
            <div class="relative rounded-full border-2 border-white/20 ${styles.markerSize} ${styles.markerColor} ${styles.markerShadow} transition-transform group-hover:scale-125 z-10"></div>
        `;

        // Tạo Marker của MapLibre
        const marker = new maplibregl.Marker({ element: el })
            .setLngLat(alert.coords)
            .addTo(map);
        
        // Thêm sự kiện click
        el.addEventListener('click', (e) => {
            e.stopPropagation(); // Ngăn click lan ra bản đồ
            setSelectedAlert(alert);
            map.flyTo({ center: alert.coords, zoom: 11, speed: 1.5 });
        });

        alertMarkersRef.current.push(marker);
    });

  }, [nationalAlerts]); // Chạy lại khi danh sách cảnh báo thay đổi

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

      // OpenWeatherMap Layers
      if (OWM_API_KEY) {
          map.addSource('wind-source', { type: 'raster', tiles: [`https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`], tileSize: 256 });
          map.addLayer({ id: 'wind-layer', type: 'raster', source: 'wind-source', paint: { 'raster-opacity': 0.6 }, layout: { visibility: 'none' } });
          map.addSource('temp-source', { type: 'raster', tiles: [`https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`], tileSize: 256 });
          map.addLayer({ id: 'temp-layer', type: 'raster', source: 'temp-source', paint: { 'raster-opacity': 0.5 }, layout: { visibility: 'none' } });
      }

      map.addSource('storm-source', { type: 'geojson', data: STORM_TRACK_GEOJSON as any, lineMetrics: true });
      map.addLayer({ id: 'storm-track', type: 'line', source: 'storm-source', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' }, paint: { 'line-width': 6, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#22c55e', 0.5, '#f59e0b', 1, '#ef4444'] } });
      map.addLayer({ id: 'storm-glow', type: 'line', source: 'storm-source', layout: { visibility: 'visible' }, paint: { 'line-width': 18, 'line-color': '#ef4444', 'line-opacity': 0.3, 'line-blur': 12 } }, 'storm-track');
      
      const riskFillPaint: any = {
        'fill-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false], '#ffffff', 
            ['match', ['feature-state', 'riskLevel'], 
                3, RISK_COLORS.critical,
                2, RISK_COLORS.medium,
                1, RISK_COLORS.normal,
                0, RISK_COLORS.safe,
                RISK_COLORS.default]
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
        
        if (markerRef.current) markerRef.current.remove();
        const el = document.createElement('div'); el.className = 'neon-marker-container'; 
        el.innerHTML = `<div class="neon-core"></div><div class="neon-pulse"></div>`;
        markerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);

        setConsoleTab('analysis'); 
        setAnalyzing(true);
        if(!isDashboardOpen) setIsDashboardOpen(true);

        // 1. Get Address
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

        // 2. Get Weather Data (Logic Fork: Sim vs Real)
        if (isSimMode) {
             // Simulation Mode: Fake Everything with new Random Logic
             setTimeout(() => {
                 const mock = createSimulationData(lat, lng);
                 mock.title = line1; mock.subtitle = line2; 
                 setDashboardInfo(mock);
             }, 800);
        } else {
             // Real-Time Mode: Call API with EXACT CUMULATIVE RAIN LOGIC
             try {
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,wind_gusts_10m,precipitation&hourly=precipitation&daily=temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum&timezone=auto&forecast_days=14`;
                const wRes = await fetch(url);
                const wData = await wRes.json();
                if (wData.current && wData.hourly && wData.daily) {
                     const current = wData.current;
                     const hourlyRain = wData.hourly.precipitation; // Array 24*14
                     const dailyRain = wData.daily.precipitation_sum;
                     
                     // Get current hour index to map with hourly array (starts at 00:00 today)
                     const currentHourIndex = new Date().getHours(); 

                     // Helper to sum continuous hours correctly (handling array overflow)
                     const sumRain = (startIdx: number, hoursCount: number) => {
                        let total = 0;
                        for (let i = startIdx; i < startIdx + hoursCount; i++) {
                            if (hourlyRain[i] !== undefined && hourlyRain[i] !== null) {
                                total += hourlyRain[i];
                            }
                        }
                        return total;
                     };

                     const sumRainDays = (daysCount: number) => {
                         let total = 0;
                         for(let i = 0; i < daysCount; i++) {
                             if (dailyRain[i] !== undefined) total += dailyRain[i];
                         }
                         return total;
                     };

                     setDashboardInfo({
                        title: line1, subtitle: line2, coordinates: coordsText,
                        temp: current.temperature_2m, feelsLike: current.apparent_temperature,
                        tempMin: wData.daily.temperature_2m_min[0], tempMax: wData.daily.temperature_2m_max[0],
                        humidity: current.relative_humidity_2m, pressureSea: current.pressure_msl, pressureGround: current.surface_pressure,
                        windSpeed: current.wind_speed_10m, windDir: current.wind_direction_10m, windGusts: current.wind_gusts_10m,
                        cloudCover: current.cloud_cover, elevation: wData.elevation || 0, uvIndex: wData.daily.uv_index_max[0],
                        // Updated Rain Stats
                        rainStats: { 
                            h1: sumRain(currentHourIndex, 1), 
                            h2: sumRain(currentHourIndex, 2), 
                            h3: sumRain(currentHourIndex, 3), 
                            h5: sumRain(currentHourIndex, 5), 
                            h12: sumRain(currentHourIndex, 12), 
                            h24: sumRain(currentHourIndex, 24), // Correctly spans next day if needed
                            d3: sumRainDays(3), 
                            d7: sumRainDays(7), 
                            d14: sumRainDays(14) 
                        },
                        status: 'Live'
                     });
                }
            } catch (err) {}
        }

        setTimeout(() => {
            setAnalyzing(false);
            
            // Logic Risk Analysis based on Data
            let riskLevel: RiskLevel = 'An toàn';
            let type = 'An toàn';

            if (isSimMode) {
                 // Sim Mode: Force Dangerous
                 riskLevel = 'Nguy hiểm';
                 type = 'Cảnh báo sạt lở (Mô phỏng)';
            } else {
                 riskLevel = 'An toàn';
                 type = 'An toàn';
            }
            
            if (riskLevel !== 'An toàn') {
                setHistoryList(prev => {
                    const now = Date.now();
                    const tenDaysInMs = 10 * 24 * 60 * 60 * 1000;
                    const newItem: HistoryItem = { 
                        id: now, location: line1, 
                        risk: riskLevel, type: type 
                    };
                    return [newItem, ...prev].filter(item => (now - item.id) < tenDaysInMs);
                });
            }
        }, 1500);
      });
    });
  }, [isSimMode]); 

  // --- DELETE LAYER CONTROLS (Removed toggleLayer function and UI) ---

  return (
    <div className="relative w-full h-screen bg-[#020408] text-slate-200 overflow-hidden font-sans selection:bg-cyan-500/30">
      
      {/* MAP CONTAINER */}
      <div className="absolute inset-0 z-0"><div ref={mapContainerRef} className="w-full h-full bg-[#05060a]"/></div>

      {/* ĐÃ XÓA LAYER CONTROLS Ở ĐÂY */}

      {/* MODE TOGGLE BUTTON */}
      <div className="absolute bottom-6 right-6 z-30">
        <button 
            onClick={() => setIsSimMode(!isSimMode)}
            className={`h-12 px-4 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-xl backdrop-blur-md border ${isSimMode ? 'bg-purple-900/80 border-purple-500 text-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.4)]' : 'bg-[#05060a]/80 border-cyan-500/50 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)]'}`}
        >
            {isSimMode ? <Gamepad2 size={20} className="animate-pulse"/> : <Radio size={20} className={!isSimMode ? "animate-pulse" : ""}/>}
            <span className="text-xs font-bold uppercase tracking-wider">{isSimMode ? 'SIMULATION' : 'REAL-TIME'}</span>
        </button>
      </div>

      {/* DASHBOARD CARD */}
      {isDashboardOpen ? (
        <div className="absolute top-6 left-6 z-20 w-[420px] glass-card rounded-3xl overflow-hidden group transition-all duration-300 flex flex-col max-h-[90vh]">
          <div className="p-5 border-b border-white/5 relative bg-gradient-to-b from-white/5 to-transparent">
            <button onClick={() => setIsDashboardOpen(false)} className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition"><Minus size={16} /></button>
            <div className="flex items-center gap-2 mb-2">
              <div className={`px-2 py-0.5 rounded-full border text-[9px] font-bold tracking-wider uppercase flex items-center gap-1.5 ${isSimMode ? 'bg-purple-500/10 border-purple-500/20 text-purple-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                <span className={`relative flex h-1.5 w-1.5`}>
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSimMode ? 'bg-purple-400' : 'bg-red-400'}`}></span>
                    <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${isSimMode ? 'bg-purple-500' : 'bg-red-500'}`}></span>
                </span>
                {isSimMode ? 'Simulation Mode' : 'Live Monitoring'}
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
             <div className="flex items-center justify-between py-4 border-b border-white/5">
                <div><div className="text-5xl font-bold text-white tracking-tighter text-glow-cyan leading-none">{Math.round(dashboardInfo.temp)}°</div><div className="text-[10px] text-gray-400 font-medium mt-1">Cảm giác: <span className="text-gray-200 font-bold">{Math.round(dashboardInfo.feelsLike)}°</span></div></div>
                <div className="flex flex-col gap-1 text-right">
                    <div className="flex items-center justify-end gap-1 text-xs font-medium text-red-300"><ArrowUp size={12}/> Max: {Math.round(dashboardInfo.tempMax)}°</div>
                    <div className="flex items-center justify-end gap-1 text-xs font-medium text-blue-300"><ArrowDown size={12}/> Min: {Math.round(dashboardInfo.tempMin)}°</div>
                    <div className="mt-1 px-2 py-0.5 bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[10px] rounded font-bold inline-block ml-auto">UV: {dashboardInfo.uvIndex}</div>
                </div>
             </div>
             <div className="grid grid-cols-2 gap-2 mt-4">
                 <div className="bg-white/5 rounded-xl p-3 border border-white/5 relative overflow-hidden"><div className="text-[10px] text-gray-500 uppercase font-bold mb-1 flex items-center gap-1"><Wind size={10}/> Tốc độ gió</div><div className="text-xl font-bold text-white">{dashboardInfo.windSpeed.toFixed(1)}<span className="text-xs text-gray-400 font-normal ml-0.5">km/h</span></div><div className="text-[10px] text-cyan-300 mt-1 flex items-center gap-1"><Navigation size={10} style={{transform: `rotate(${dashboardInfo.windDir}deg)`}}/> {dashboardInfo.windDir}°</div></div>
                 <div className="bg-white/5 rounded-xl p-3 border border-white/5 relative overflow-hidden"><div className="text-[10px] text-gray-500 uppercase font-bold mb-1 flex items-center gap-1"><Waves size={10}/> Áp lực gió</div><div className="text-xl font-bold text-white">{dashboardInfo.windGusts.toFixed(1)}<span className="text-xs text-gray-400 font-normal ml-0.5">km/h</span></div><div className="text-[10px] text-red-300 mt-1">Gió giật mạnh</div></div>
             </div>
             <div className="grid grid-cols-3 gap-2 mt-2">
                 {[{ l: 'Độ ẩm', v: dashboardInfo.humidity + '%', c: 'text-blue-400', i: Droplets }, { l: 'Áp suất', v: dashboardInfo.pressureSea, u: 'hPa', c: 'text-purple-400', i: Gauge }, { l: 'Mây', v: dashboardInfo.cloudCover + '%', c: 'text-gray-400', i: Sun }].map((d,i) => (<div key={i} className="bg-white/5 rounded-lg p-2 text-center border border-white/5"><d.i size={14} className={`mx-auto mb-1 ${d.c}`}/><div className="text-sm font-bold text-white leading-none">{d.v}</div><div className="text-[8px] text-gray-500 mt-1 font-bold uppercase">{d.l}</div></div>))}
             </div>
             <div className="mt-4 bg-[#0b0f16]/60 rounded-xl border border-white/10 p-3">
                 <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/5"><Umbrella size={14} className="text-blue-400"/><span className="text-xs font-bold text-white uppercase tracking-wider">Lượng mưa tích lũy</span></div>
                 <div className="mb-3"><div className="text-[9px] text-gray-500 uppercase font-bold mb-2">Ngắn hạn (Giờ)</div><div className="grid grid-cols-6 gap-1 text-center">{[{ l: '1h', v: dashboardInfo.rainStats.h1 }, { l: '2h', v: dashboardInfo.rainStats.h2 }, { l: '3h', v: dashboardInfo.rainStats.h3 }, { l: '5h', v: dashboardInfo.rainStats.h5 }, { l: '12h', v: dashboardInfo.rainStats.h12 }, { l: '24h', v: dashboardInfo.rainStats.h24 }].map((r, idx) => (<div key={idx} className={`rounded-md p-1 border ${r.v > 0 ? 'bg-blue-500/10 border-blue-500/30' : 'bg-transparent border-white/5'}`}><div className={`text-[10px] font-bold ${r.v > 5 ? 'text-red-400' : r.v > 0 ? 'text-blue-300' : 'text-gray-600'}`}>{r.v.toFixed(1)}</div><div className="text-[8px] text-gray-500 mt-0.5">{r.l}</div></div>))}</div></div>
                 <div><div className="text-[9px] text-gray-500 uppercase font-bold mb-2">Dự báo (Ngày)</div><div className="grid grid-cols-3 gap-2 text-center">{[{ l: '3 Ngày', v: dashboardInfo.rainStats.d3 }, { l: '7 Ngày', v: dashboardInfo.rainStats.d7 }, { l: '14 Ngày', v: dashboardInfo.rainStats.d14 }].map((r, idx) => (<div key={idx} className="flex items-center justify-between bg-white/5 px-2 py-1.5 rounded-lg border border-white/5"><span className="text-[9px] text-gray-400 font-bold">{r.l}</span><span className={`text-xs font-bold ${r.v > 50 ? 'text-red-400' : r.v > 10 ? 'text-yellow-400' : 'text-white'}`}>{r.v.toFixed(0)}mm</span></div>))}</div></div>
             </div>
             <div className="mt-2 flex justify-between text-[9px] text-gray-600 font-mono px-1"><span>Pressure (Ground): {dashboardInfo.pressureGround} hPa</span><span>Sea Level Rise: N/A</span></div>
          </div>
        </div>
      ) : (
        <button onClick={() => setIsDashboardOpen(true)} className="absolute top-6 left-6 z-20 h-12 px-4 rounded-2xl bg-[#05060a]/80 backdrop-blur-md border border-white/10 flex items-center gap-3 shadow-xl hover:bg-[#05060a]/95 transition-all group"><div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_red]"></div><div className="flex flex-col items-start leading-none gap-1"><span className="text-white font-bold text-sm">{Math.round(dashboardInfo.temp)}°C</span><span className="text-[10px] text-gray-400 font-medium max-w-[100px] truncate">{dashboardInfo.title}</span></div><LayoutDashboard size={16} className="text-gray-400 group-hover:text-cyan-400 transition ml-2"/></button>
      )}

      {/* AI CONSOLE */}
      {isAIConsoleOpen ? (
        <div className="absolute top-6 z-40 w-[420px] glass-card rounded-3xl overflow-hidden flex flex-col transition-all duration-300" style={{ right: 24, maxHeight: 'calc(100vh - 48px)' }}>
           <div className="bg-white/5 border-b border-white/5">
               <div className="p-4 flex justify-between items-center">
                  <div className="flex gap-2.5 items-center"><ShieldCheck className="text-blue-400" size={18}/><span className="text-white font-bold text-sm tracking-wide text-glow">SafeWave AI</span></div>
                  <button onClick={() => setIsAIConsoleOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition"><Minus size={16}/></button>
               </div>
               <div className="flex px-4 pb-0 gap-6 text-sm font-medium relative">
                  {[{ id: 'analysis', label: 'Phân tích', color: 'cyan' }, { id: 'alerts', label: 'Cảnh báo', color: 'red' }, { id: 'history', label: 'Lịch sử', color: 'purple' }].map(tab => (
                    <button key={tab.id} onClick={() => setConsoleTab(tab.id as any)} className={`pb-3 relative transition-colors ${consoleTab === tab.id ? `text-${tab.color}-400 text-glow-${tab.color === 'cyan' || tab.color === 'red' ? tab.color : 'purple'}` : 'text-gray-500 hover:text-gray-300'}`}>{tab.label}{consoleTab === tab.id && <span className={`absolute bottom-0 left-0 w-full h-0.5 bg-${tab.color}-400 shadow-[0_0_10px_${tab.color === 'cyan' ? '#22d3ee' : tab.color === 'red' ? '#ef4444' : '#c084fc'}]`}></span>}</button>
                  ))}
               </div>
           </div>
           
           <div className="p-5 flex-1 overflow-y-auto custom-scrollbar relative">
              {/* TAB 1: PHÂN TÍCH */}
              {consoleTab === 'analysis' && (
                <div className="flex flex-col gap-4">
                    <div className="relative"><Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"/><input value={inputLocation} onChange={e => setInputLocation(e.target.value)} className="w-full bg-[#05060a]/50 border border-white/10 focus:border-cyan-500/50 rounded-xl py-3 pl-10 pr-4 text-xs text-white placeholder-gray-600 outline-none transition-all" placeholder="Địa điểm đang chọn..." readOnly /></div>
                    {analyzing ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-4"><div className="loader-spin border-t-cyan-400 border-r-cyan-400"></div><span className="text-xs font-mono text-cyan-400 animate-pulse">AI đang tổng hợp dữ liệu...</span></div>
                    ) : (
                        <div className="flex flex-col gap-5">
                            {(() => {
                                // Logic Risk Analysis based on Data
                                const currentRiskLevel = isSimMode ? 4 : (dashboardInfo.rainStats.h24 > 50 ? 3 : 1);
                                const levels = [{ lvl: 1, label: 'An toàn', color: 'bg-emerald-500' }, { lvl: 2, label: 'Nhẹ', color: 'bg-yellow-400' }, { lvl: 3, label: 'Cảnh báo', color: 'bg-orange-500' }, { lvl: 4, label: 'Nguy hiểm', color: 'bg-red-500' }];
                                return (
                                    <div className="bg-[#0b0f16]/40 border border-white/5 rounded-2xl p-5 flex flex-col gap-4 relative overflow-hidden">
                                        <div className={`absolute inset-0 opacity-10 blur-3xl ${currentRiskLevel === 4 ? 'bg-red-600' : currentRiskLevel === 3 ? 'bg-orange-600' : 'bg-green-600'}`}></div>
                                        <div className="flex items-end justify-between gap-3 h-[100px] relative z-10 px-4">
                                            {levels.map((item) => (
                                                <div key={item.lvl} className="flex-1 flex flex-col items-center justify-end gap-3 group h-full">
                                                    <div className={`w-1.5 rounded-full transition-all duration-700 relative ${currentRiskLevel === item.lvl ? `h-full ${item.color} opacity-100 shadow-[0_0_15px_currentColor]` : 'h-2 bg-gray-700/50 opacity-30'}`}></div>
                                                    <span className={`text-[9px] font-bold uppercase tracking-wider ${currentRiskLevel === item.lvl ? 'text-white opacity-100' : 'text-gray-600 opacity-40'}`}>{item.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mt-2 pt-4 border-t border-white/5 z-10">
                                            <div className={`text-2xl font-bold mb-2 ${currentRiskLevel === 4 ? 'text-white text-glow-red' : 'text-white'}`}>{currentRiskLevel === 4 ? 'NGUY HIỂM' : currentRiskLevel === 1 ? 'AN TOÀN' : 'CẢNH BÁO'}</div>
                                            <p className="text-xs text-gray-300 leading-relaxed font-light">
                                                {currentRiskLevel === 4 
                                                    ? 'Mô phỏng: Đất bão hòa nước (>90%). Địa hình dốc cao. Nguy cơ sạt lở cực kỳ nguy hiểm.' 
                                                    : currentRiskLevel === 1 
                                                    ? 'Các chỉ số khí tượng nằm trong ngưỡng an toàn. Chưa phát hiện nguy cơ sạt lở.'
                                                    : 'Mưa lớn cục bộ có thể gây ngập úng nhẹ. Cần đề phòng.'}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })()}
                            <button onClick={() => setAnalyzing(true)} className="w-full bg-cyan-600/10 hover:bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 group relative overflow-hidden"><span className="relative flex h-2 w-2 mr-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span></span>Cập nhật dữ liệu</button>
                        </div>
                    )}
                </div>
              )}

              {/* TAB 2: CẢNH BÁO */}
              {consoleTab === 'alerts' && (
                 <div className="flex flex-col h-full">
                     <div className="flex justify-between items-center mb-4"><div className="flex items-center gap-2"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span></span><span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Hệ thống giám sát 24/7</span></div><div className="flex items-center gap-2"><span className="text-[10px] text-gray-500 font-mono">{lastScanTime}</span><button onClick={runSystemScan} disabled={isScanning} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition disabled:opacity-50"><RefreshCw size={12} className={isScanning ? 'animate-spin' : ''}/></button></div></div>
                     {isScanning ? (
                         <div className="flex-1 flex flex-col items-center justify-center gap-3"><div className="loader-spin border-t-red-500 border-r-red-500 w-8 h-8"></div><div className="text-xs text-red-400 animate-pulse font-mono">Đang quét toàn bộ lãnh thổ...</div></div>
                     ) : (
                         <div className="flex flex-col gap-3 pb-4">
                             {nationalAlerts.length === 0 ? <div className="text-center py-10 text-gray-500 text-xs">Không phát hiện rủi ro.</div> : nationalAlerts.map((alert) => (
                                 <div key={alert.id} onClick={() => { setSelectedAlert(alert); mapRef.current?.flyTo({ center: alert.coords, zoom: 11, speed: 1.5 }); }} className="bg-[#0b0f16]/60 border border-white/5 hover:border-red-500/30 hover:bg-red-500/5 rounded-xl p-3 transition flex gap-3 items-start group cursor-pointer relative overflow-hidden">
                                     <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${alert.level === 'Nguy hiểm' ? 'bg-red-500/20 text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]' : alert.level === 'Cảnh báo' ? 'bg-orange-500/20 text-orange-500' : alert.level === 'Nhẹ' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-green-500/20 text-green-500'}`}>
                                        {alert.level === 'Nguy hiểm' ? <Siren size={20} className="animate-pulse"/> : alert.level === 'Cảnh báo' ? <AlertTriangle size={20}/> : <Info size={20}/>}
                                     </div>
                                     <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start">
                                            <h4 className="text-xs font-bold text-gray-200 truncate pr-2">{alert.location}</h4>
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${alert.level === 'Nguy hiểm' ? 'bg-red-500/10 border-red-500/20 text-red-400' : alert.level === 'Cảnh báo' ? 'bg-orange-500/10 border-orange-500/20 text-orange-400' : alert.level === 'Nhẹ' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}>{alert.level}</span>
                                        </div>
                                        <div className="text-[10px] text-gray-500 mt-0.5">{alert.province}</div>
                                        <div className="text-[11px] text-gray-300 mt-2 font-medium flex items-center gap-1.5"><Activity size={10}/> {alert.type}</div>
                                     </div>
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
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${item.risk === 'Nguy hiểm' ? 'bg-red-500/10 text-red-500' : item.risk === 'Cảnh báo' ? 'bg-orange-500/10 text-orange-500' : item.risk === 'Nhẹ' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-green-500/10 text-green-500'}`}><History size={18}/></div>
                              <div className="flex-1 min-w-0">
                                  <div className="flex justify-between items-start">
                                      <h4 className="text-xs font-bold text-gray-200 truncate pr-2">{item.location}</h4>
                                      <span className="text-[9px] font-mono text-gray-500 shrink-0 flex items-center gap-1"><Clock size={8}/> {formatHistoryTime(item.id)}</span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-1"><span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-white/5 border-white/10 text-gray-400">{item.type}</span></div>
                              </div>
                          </div>
                      ))}
                  </div>
              )}
           </div>
        </div>
      ) : (
        <button onClick={() => setIsAIConsoleOpen(true)} className="absolute top-6 z-30 h-12 px-5 rounded-2xl bg-[#05060a]/80 backdrop-blur-md border border-white/10 flex items-center gap-2 shadow-xl hover:border-blue-500/50 transition-all group" style={{ right: 24 }}><ShieldCheck size={18} className="text-blue-400 group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]"/><span className="text-white text-xs font-bold">AI Reports</span></button>
      )}

      {/* POPUP MODAL */}
      {selectedAlert && (
          // [UPDATED] Lấy style động từ helper
          (() => {
              const styles = getAlertStyles(selectedAlert.level);
              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className={`w-full max-w-md glass-card rounded-3xl p-6 relative border ${styles.border} ${styles.shadow}`}>
                        <button onClick={() => setSelectedAlert(null)} className="absolute top-4 right-4 text-gray-400 hover:text-white transition"><X size={20}/></button>
                        
                        <div className="flex items-center gap-3 mb-6">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${styles.iconBg} ${styles.iconText}`}>
                                {selectedAlert.level === 'Nguy hiểm' ? <Siren size={24} className="animate-pulse"/> : selectedAlert.level === 'Cảnh báo' ? <AlertTriangle size={24}/> : <Info size={24}/>}
                            </div>
                            <div>
                                <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${styles.titleText}`}>Cảnh báo khẩn cấp</div>
                                <h3 className="text-xl font-bold text-white leading-none">{selectedAlert.location}</h3>
                                <span className="text-sm text-gray-400">{selectedAlert.province}</span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className={`p-4 rounded-xl ${styles.barBg}`}>
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-xs text-gray-400 uppercase font-semibold">Mức độ rủi ro</span>
                                    <span className={`font-bold text-sm drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] ${styles.riskText}`}>{selectedAlert.level.toUpperCase()}</span>
                                </div>
                                <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden mt-3">
                                    <div className={`h-full bg-gradient-to-r ${styles.barFill} ${styles.barWidth} transition-all duration-500`}></div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                                    <div className="text-[10px] text-gray-500 uppercase mb-1">Lượng mưa</div>
                                    <div className="text-lg font-bold text-blue-300">{selectedAlert.rainAmount}mm</div>
                                </div>
                                <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                                    <div className="text-[10px] text-gray-500 uppercase mb-1">Gió giật</div>
                                    <div className="text-lg font-bold text-teal-300">{selectedAlert.windSpeed}km/h</div>
                                </div>
                            </div>

                            <div className={`text-sm text-gray-300 leading-relaxed italic border-l-2 pl-3 ${styles.quoteBorder}`}>"{selectedAlert.description}"</div>
                            
                            <button 
                                onClick={() => { 
                                    if (mapRef.current) { 
                                        // Fly to location
                                        mapRef.current.flyTo({ center: selectedAlert.coords, zoom: 12, speed: 1.5 });
                                        // Drop Marker (User Selection)
                                        if (markerRef.current) markerRef.current.remove();
                                        const el = document.createElement('div'); el.className = 'neon-marker-container'; 
                                        el.innerHTML = `<div class="neon-core"></div><div class="neon-pulse"></div>`;
                                        markerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(selectedAlert.coords).addTo(mapRef.current);
                                    } 
                                    setSelectedAlert(null); 
                                }} 
                                className={`w-full py-3 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${styles.btnBg}`}
                            >
                                <Maximize2 size={16}/> Xem trên bản đồ
                            </button>
                        </div>
                    </div>
                </div>
              );
          })()
      )}
    </div>
  );
};

export default SafeWaveApp;