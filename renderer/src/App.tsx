import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl, { type Map as MapLibreInstance, type StyleSpecification, type LngLatBoundsLike, Marker, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { dbService, type ProvinceRainSample, type ShelterItem, type HistoricRainRecord, type HistoryDetail } from './services/dbService';
import { VIETNAM_PROVINCES } from './data/provinces';
import PROVINCE_CENTROIDS from './data/province-centroids';
import {
  Activity, Droplets, Gauge, MapPin, 
  ShieldCheck, Sun, Wind, X, Search,
  History, AlertTriangle, Minus, LayoutDashboard,

  RefreshCw, Maximize2, Siren, Mountain, ArrowUp, ArrowDown, Waves, Umbrella, Navigation, Info, Clock, Tornado, CloudRain, Star, Trash2, Building, PhoneCall, Users, Map
} from 'lucide-react';

// --- CẤU HÌNH API & DỮ LIỆU ---
const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'carto-voyager': { 
        type: 'raster', 
        tiles: ['https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'], 
        tileSize: 256, 
        attribution: '&copy; CartoDB' 
    }
  },
  layers: [{ 
      id: 'carto-layer', 
      type: 'raster', 
      source: 'carto-voyager', 
      minzoom: 0, 
      maxzoom: 19,
      paint: {} 
  }] 
} as StyleSpecification;

const ASIA_BOUNDS: LngLatBoundsLike = [[60.0, -15.0], [150.0, 55.0]];

const WINDY_RADAR_TILES = 'https://tiles.windy.com/tiles/radar/{z}/{x}/{y}.png';
const WINDY_ATTRIBUTION = 'Windy.com';

type ProvinceCentroidMap = Record<string, { latitude: number; longitude: number }>;

const PROVINCE_CENTROID_MAP: ProvinceCentroidMap = PROVINCE_CENTROIDS.reduce<ProvinceCentroidMap>((acc, centroid) => {
    acc[centroid.province] = { latitude: centroid.latitude, longitude: centroid.longitude };
    return acc;
}, {});

const buildWindyEmbedUrl = (lat: number, lon: number, zoom: number) => {
    const params = new URLSearchParams({
        lat: lat.toFixed(3),
        lon: lon.toFixed(3),
        detailLat: lat.toFixed(3),
        detailLon: lon.toFixed(3),
        zoom: Math.min(12, Math.max(3, Math.round(zoom))).toString(),
        level: 'surface',
        overlay: 'wind',
        product: 'ecmwf',
        type: 'map',
        location: 'coordinates',
        detail: 'true',
        metricWind: 'default',
        metricTemp: 'default',
        calendar: 'now',
        pressure: 'true',
        message: 'true',
        menu: '',
        marker: 'true',
        radarRange: '-1'
    });
    return `https://embed.windy.com/embed2.html?${params.toString()}`;
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
  soilMoisture?: number;
  status: string;
}

type RiskLevel = 'Nguy hiểm' | 'Cảnh báo' | 'Nhẹ' | 'An toàn';

interface HistoryItem {

  id: number; location: string; risk: RiskLevel; type: string; is_favorite?: number; created_at?: string;
}

interface AlertItem {
  id: string | number; 
  location: string; province: string; 
  level: RiskLevel; 
  type: string; timestamp: string; 
  rainAmount: number; windSpeed: number; 
  description: string; coords: [number, number]; 
  isCluster?: boolean; 
  count?: number;      
  source?: 'JTWC' | 'GDACS' | 'FALLBACK';
  trackData?: any[]; 
  coneGeoJSON?: any; 
}


interface LiveMonitoringOptions {
  presetTitle?: string;
  presetSubtitle?: string;
  provinceOverride?: string;
  persist?: boolean;
  focusAnalysis?: boolean;
}

// ==========================================
// --- ADVANCED RISK ENGINE (LOGIC MỚI) ---
// ==========================================

// 1. Định nghĩa các Types cho Logic mới
interface RiskReason {
  code: string;
  score: number;
  description: string;
  source: 'Weather' | 'Geo' | 'Storm' | 'Hydro' | 'Manual';
}

interface AdvancedRiskOutput {
  level: number; // 1: An toàn, 2: Nhẹ, 3: Cảnh báo, 4: Nguy hiểm
  label: RiskLevel;
  score: number;
  confidence: number;
  reasons: RiskReason[];
  actions: string;
  factors: {
     terrain: TerrainType;
     soil: string;
     saturation: number;
     wScore: number; // Để tương thích UI cũ
     sScore: number; // Để tương thích UI cũ
     tScore: number; // Để tương thích UI cũ
  }
}

type TerrainType = 'Đồng bằng' | 'Lòng chảo/Thung lũng' | 'Taluy dương' | 'Đỉnh đồi/Núi cao' | 'Ven sông/Suối' | 'Ven biển' | 'Chân núi';

// Để tương thích với UI cũ đang dùng RiskAnalysisResult
interface RiskAnalysisResult {
    level: number; 
    riskLabel: RiskLevel;
    title: string;
    description: string;
    factors: {
        terrain: TerrainType;
        soil: string;
        saturation: number;
        wScore?: number;
        sScore?: number;
        tScore?: number;
    }
}

// 2. Hàm xác định địa hình & Multiplier (Dựa trên cao độ thực tế)
const determineTerrain = (elevation: number): { type: TerrainType, multiplier: number } => {
    if (elevation < 5) return { type: 'Ven biển', multiplier: 1.4 }; // Dễ ngập/triều cường
    if (elevation < 20) return { type: 'Đồng bằng', multiplier: 1.0 };
    if (elevation > 50 && elevation < 200) return { type: 'Chân núi', multiplier: 1.5 }; // Dễ tụ thủy
    if (elevation >= 200 && elevation < 500) return { type: 'Taluy dương', multiplier: 1.7 }; // Sạt lở
    if (elevation >= 500) return { type: 'Đỉnh đồi/Núi cao', multiplier: 1.7 };
    return { type: 'Đồng bằng', multiplier: 1.0 };
};


const hasValidLocationName = (name: string): boolean => {
    if (!name) return false;
    const normalized = name.trim().toLowerCase();
    if (normalized.length < 5) return false;
    if (normalized.includes('đang xác định') || normalized.includes('không thể lấy')) return false;
    if (normalized === 'khu vực tự nhiên' || normalized === 'việt nam') return false;
    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(normalized)) return false;
    return true;
};

// 3. Hàm tính toán Confidence (Độ tin cậy)
const calculateConfidence = (hasStormAlert: boolean, hasRealtimeRain: boolean): number => {
    let conf = 0.5; // Base
    if (hasStormAlert) conf += 0.15; // Có cảnh báo bão chính thức
    if (hasRealtimeRain) conf += 0.1; // Có dữ liệu quan trắc mưa thực tế
    // Cap confidence
    return Math.min(0.99, Math.max(0.1, conf));
};

// 4. MAIN ENGINE: Tính toán rủi ro chi tiết
const calculateAdvancedRisk = (data: DashboardData, distToStorm: number): AdvancedRiskOutput => {
    const reasons: RiskReason[] = [];
    let rawScore = 0;
    
    // --- A. PHÂN TÍCH MƯA (RAIN) ---
    // Mưa 1h (Hiện tại)
    if (data.rainStats.h1 >= 50) { 
        rawScore += 5; reasons.push({ code: 'rain_very_heavy', score: 5, description: `Mưa rất to (${data.rainStats.h1.toFixed(0)}mm/h)`, source: 'Weather' }); 
    } else if (data.rainStats.h1 >= 20) { 
        rawScore += 3; reasons.push({ code: 'rain_heavy', score: 3, description: `Mưa to (${data.rainStats.h1.toFixed(0)}mm/h)`, source: 'Weather' });
    } else if (data.rainStats.h1 >= 5) { 
        rawScore += 2; reasons.push({ code: 'rain_moderate', score: 2, description: `Mưa vừa`, source: 'Weather' });
    } else if (data.rainStats.h1 > 0.5) { 
        rawScore += 1; reasons.push({ code: 'rain_light', score: 1, description: `Mưa nhỏ`, source: 'Weather' });
    }

    // Mưa tích lũy (Cumulative/Persistence)
    // Mưa 3h cường suất lớn
    if (data.rainStats.h3 > 100) {
        rawScore += 5; reasons.push({ code: 'rain_cumulative_extreme', score: 5, description: `Mưa cực lớn 3h (${data.rainStats.h3.toFixed(0)}mm)`, source: 'Weather' });
    }
    // Mưa kéo dài (Dự báo 3 ngày tới hoặc tích lũy)
    if (data.rainStats.d3 > 200) {
        rawScore += 4; reasons.push({ code: 'rain_persistent_heavy', score: 4, description: `Mưa tích lũy lớn dài ngày`, source: 'Weather' });
    } else if (data.rainStats.d3 > 50) {
        rawScore += 2; reasons.push({ code: 'rain_light_continuous', score: 2, description: `Mưa dầm dài ngày`, source: 'Weather' });
    }

    // --- B. PHÂN TÍCH GIÓ (WIND) ---
    const gustKmh = data.windGusts;
    
    if (gustKmh > 100) { // > Cấp 10
        rawScore += 6; reasons.push({ code: 'wind_extreme', score: 6, description: `Gió giật >100km/h (Cấp 10+)`, source: 'Weather' });
    } else if (gustKmh >= 62) { // Cấp 8-9
        rawScore += 4; reasons.push({ code: 'wind_strong', score: 4, description: `Gió mạnh cấp 8-9`, source: 'Weather' });
    } else if (gustKmh >= 39) { // Cấp 6-7
        rawScore += 2; reasons.push({ code: 'wind_moderate', score: 2, description: `Gió cấp 6-7`, source: 'Weather' });
    }

    // Combo Gió + Mưa
    if (gustKmh >= 62 && data.rainStats.h1 > 10) {
        rawScore += 2; reasons.push({ code: 'combo_wind_rain', score: 2, description: `Gió mạnh kèm mưa lớn`, source: 'Weather' });
    }

    // --- C. BÃO / ÁP THẤP (STORM) ---
    const inStormPath = distToStorm < 100; // Giả định nằm trong vùng tâm bão 100km
    const nearStorm = distToStorm < 300; // Vùng hoàn lưu

    if (inStormPath) {
        rawScore += 7; reasons.push({ code: 'storm_path', score: 7, description: `Nằm trong đường đi/tâm bão (<100km)`, source: 'Storm' });
    } else if (nearStorm) {
        rawScore += 4; reasons.push({ code: 'storm_near', score: 4, description: `Ảnh hưởng hoàn lưu bão (<300km)`, source: 'Storm' });
    }

    // --- D. KHÍ TƯỢNG NÂNG CAO (METADATA) ---
    // Áp suất giảm thấp (dấu hiệu bão/áp thấp đến gần)
    if (data.pressureSea < 990) {
        rawScore += 2; reasons.push({ code: 'pressure_drop', score: 2, description: `Áp suất giảm thấp (${data.pressureSea}hPa)`, source: 'Weather' });
    }
    // Độ ẩm bão hòa
    if (data.humidity >= 95) {
        rawScore += 1; // Nhẹ
    }

    // --- E. ĐỊA CHẤT / ĐỊA HÌNH (MULTIPLIER) ---
    const terrainInfo = determineTerrain(data.elevation);
    const multiplier = terrainInfo.multiplier;
    
    // Đất bão hòa (Soil Saturation)
    const soilSat = (data.soilMoisture || 0.3) * 100;
    let geoBonus = 0;
    
    if (soilSat > 80 && multiplier > 1.2) {
        // Đất ướt + Địa hình dốc/yếu -> Tăng multiplier thực tế
        geoBonus += 2; 
        reasons.push({ code: 'geo_risk', score: 0, description: `Đất bão hòa (${soilSat.toFixed(0)}%) tại ${terrainInfo.type}`, source: 'Geo' });
    }

    // --- TÍNH TỔNG ĐIỂM (SCORE CALCULATION) ---
    let totalScore = (rawScore * multiplier) + geoBonus;
    
    // --- 5. QUY TẮC OVERRIDE (KILL SWITCH) ---
    let overrideLevel = 0;
    let overrideReason = '';

    // Rule 1: Trong tâm bão + (Gió to HOẶC Mưa to) -> Nguy hiểm
    if (inStormPath && (gustKmh >= 62 || data.rainStats.h3 > 50)) {
        overrideLevel = 4; overrideReason = 'Tâm bão quét qua + Thời tiết cực đoan';
    }
    
    // Rule 2: Combo 2 điều kiện cực đoan -> Nguy hiểm
    // Ví dụ: Lũ quét (Mưa d3 > 200) + Đất bão hòa cao + Địa hình dốc
    if (data.rainStats.d3 > 200 && soilSat > 85 && terrainInfo.multiplier >= 1.5) {
        overrideLevel = 4; overrideReason = 'Nguy cơ sạt lở đất/lũ quét cực cao';
    }

    // Rule 3: Gió giật cấp 12 trở lên -> Nguy hiểm
    if (gustKmh > 118) {
        overrideLevel = 4; overrideReason = 'Gió giật cấp 12 (Sức phá hoại lớn)';
    }

    // Rule 4: Triều cường/Ngập lụt ven biển (Giả lập: Ven biển + Gió mạnh + Mưa)
    if (terrainInfo.type === 'Ven biển' && gustKmh > 75 && data.rainStats.h24 > 100) {
        overrideLevel = 4; overrideReason = 'Nước dâng do bão/Ngập lụt ven biển';
    }

    // --- 6. PHÂN LOẠI LEVEL & ACTION ---
    let finalLevel = 1;
    let label: RiskLevel = 'An toàn';
    let actions = 'Theo dõi các bản tin dự báo thời tiết thường xuyên.';

    // Phân tầng theo Score
    if (totalScore >= 13) finalLevel = 4;
    else if (totalScore >= 7) finalLevel = 3;
    else if (totalScore >= 3) finalLevel = 2;
    else finalLevel = 1;

    // Áp dụng Override
    if (overrideLevel > finalLevel) {
        finalLevel = overrideLevel;
        reasons.unshift({ code: 'OVERRIDE', score: 99, description: `KÍCH HOẠT KHẨN CẤP: ${overrideReason}`, source: 'Manual' });
    }

    // Mapping Label & Actions
    switch (finalLevel) {
        case 4:
            label = 'Nguy hiểm';
            actions = 'SƠ TÁN KHẨN CẤP. Tìm nơi trú ẩn an toàn. Cắt điện, gia cố nhà cửa. Không di chuyển qua vùng ngập/sạt lở.';
            break;
        case 3:
            label = 'Cảnh báo';
            actions = 'Hạn chế ra đường. Chuẩn bị nhu yếu phẩm. Kiểm tra hệ thống thoát nước/mái nhà. Sẵn sàng di dời nếu cần.';
            break;
        case 2:
            label = 'Nhẹ';
            actions = 'Cảnh giác khi tham gia giao thông. Mang theo áo mưa/ô. Tránh các hoạt động ngoài trời kéo dài.';
            break;
        case 1:
        default:
            label = 'An toàn';
            actions = 'Điều kiện thuận lợi. Sinh hoạt và làm việc bình thường.';
            break;
    }

    return {
        level: finalLevel,
        label: label,
        score: totalScore,
        confidence: calculateConfidence(distToStorm < 1000, data.rainStats.h1 > 0),
        reasons: reasons,
        actions: actions,
        factors: {
            terrain: terrainInfo.type,
            soil: 'Đất tự nhiên',
            saturation: soilSat,
            wScore: Math.min(100, (rawScore / 15) * 100), // Mapping ảo để hiển thị UI cũ
            sScore: Math.min(100, (inStormPath ? 95 : nearStorm ? 60 : 10)), // Mapping ảo
            tScore: Math.min(100, (multiplier - 1) * 100) // Mapping ảo
        }
    };
};

// 5. Wrapper tương thích ngược với UI cũ
const calculateComplexRisk = (data: DashboardData, distToStorm: number = 9999): RiskAnalysisResult => {
    const advancedResult = calculateAdvancedRisk(data, distToStorm);

    // Tạo description từ reasons
    let desc = '';
    if (advancedResult.reasons.length > 0) {
        // Lấy 3 lý do quan trọng nhất (điểm cao nhất)
        const topReasons = advancedResult.reasons
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(r => r.description);
        desc = topReasons.join('. ') + '.';
    } else {
        desc = 'Thời tiết ổn định, không có yếu tố rủi ro đáng kể.';
    }

    // Thêm action vào description cho UI hiện tại
    if (advancedResult.level > 1) {
        desc += ` \nKHUYẾN NGHỊ: ${advancedResult.actions}`;
    }

    return {
        level: advancedResult.level,
        riskLabel: advancedResult.label,
        title: advancedResult.level === 4 ? 'BÁO ĐỘNG ĐỎ' : advancedResult.level === 3 ? 'CẢNH BÁO CAM' : advancedResult.level === 2 ? 'LƯU Ý VÀNG' : 'AN TOÀN',
        description: desc,
        factors: advancedResult.factors
    };
};

// ==========================================
// --- UTILS & COMPONENTS (GIỮ NGUYÊN) ---
// ==========================================

const formatHistoryTime = (timestamp: number) => {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const dateStr = new Date(timestamp).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    if (diffDays === 0) return diffHours < 1 ? `Vừa xong • ${dateStr}` : `${diffHours} giờ trước • ${dateStr}`;
    return `${diffDays} ngày trước • ${dateStr}`;
};

const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; 
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const clusterAlerts = (alerts: AlertItem[], thresholdKm: number = 50): AlertItem[] => {
    const clustered: AlertItem[] = [];
    const visited = new Set<string>(); 
    const priority = { 'Nguy hiểm': 3, 'Cảnh báo': 2, 'Nhẹ': 1, 'An toàn': 0 };
    const sorted = [...alerts].sort((a, b) => priority[b.level] - priority[a.level]);

    for (let i = 0; i < sorted.length; i++) {
        if (visited.has(String(sorted[i].id))) continue;
        const main = sorted[i];
        visited.add(String(main.id));
        let count = 1;
        for (let j = i + 1; j < sorted.length; j++) {
            if (visited.has(String(sorted[j].id))) continue;
            const other = sorted[j];
            const dist = haversineKm(main.coords[1], main.coords[0], other.coords[1], other.coords[0]);
            if (dist < thresholdKm) { visited.add(String(other.id)); count++; }
        }
        if (count > 1) {
            clustered.push({
                ...main, location: `${main.province} (Khu vực)`, isCluster: true, count: count,
                description: `${count} điểm cảnh báo thiên tai trong bán kính ${thresholdKm}km.`
            });
        } else { clustered.push(main); }
    }
    return clustered;
};

const getAlertStyles = (level: RiskLevel) => {
    switch (level) {
        case 'Nguy hiểm':
            return {
                border: 'border-red-500/20', shadow: 'shadow-[0_0_50px_rgba(239,68,68,0.2)]',
                iconBg: 'bg-red-500/20 border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.4)]', iconText: 'text-red-500',
                titleText: 'text-red-400', riskText: 'text-red-400 shadow-red-500',
                barBg: 'bg-red-500/5 border-red-500/20', barFill: 'from-red-500 to-red-600 shadow-[0_0_10px_red]', barWidth: 'w-full',
                quoteBorder: 'border-red-500/50', btnBg: 'bg-red-600 hover:bg-red-500 shadow-[0_0_20px_rgba(220,38,38,0.4)]',
                markerSize: 'w-10 h-10', markerColor: 'bg-red-500', markerShadow: 'shadow-[0_0_25px_rgba(239,68,68,0.8)]'
            };
        case 'Cảnh báo':
            return {
                border: 'border-orange-500/20', shadow: 'shadow-[0_0_50px_rgba(249,115,22,0.2)]',
                iconBg: 'bg-orange-500/20 border-orange-500/30 shadow-[0_0_20px_rgba(249,115,22,0.4)]', iconText: 'text-orange-500',
                titleText: 'text-orange-400', riskText: 'text-orange-400 shadow-orange-500',
                barBg: 'bg-orange-500/5 border-orange-500/20', barFill: 'from-orange-400 to-orange-600 shadow-[0_0_10px_orange]', barWidth: 'w-[75%]',
                quoteBorder: 'border-orange-500/50', btnBg: 'bg-orange-600 hover:bg-orange-500 shadow-[0_0_20px_rgba(234,88,12,0.4)]',
                markerSize: 'w-7 h-7', markerColor: 'bg-orange-500', markerShadow: 'shadow-[0_0_20px_rgba(249,115,22,0.6)]'
            };
        case 'Nhẹ':
            return {
                border: 'border-yellow-400/20', shadow: 'shadow-[0_0_50px_rgba(250,204,21,0.2)]',
                iconBg: 'bg-yellow-400/20 border-yellow-400/30 shadow-[0_0_20px_rgba(250,204,21,0.4)]', iconText: 'text-yellow-400',
                titleText: 'text-yellow-300', riskText: 'text-yellow-400 shadow-yellow-400',
                barBg: 'bg-yellow-400/5 border-yellow-400/20', barFill: 'from-yellow-300 to-yellow-500 shadow-[0_0_10px_yellow]', barWidth: 'w-[50%]',
                quoteBorder: 'border-yellow-400/50', btnBg: 'bg-yellow-600 hover:bg-yellow-500 text-black shadow-[0_0_20px_rgba(202,138,4,0.4)]',
                markerSize: 'w-5 h-5', markerColor: 'bg-yellow-400', markerShadow: 'shadow-[0_0_15px_rgba(250,204,21,0.5)]'
            };
        case 'An toàn':
        default:
            return {
                border: 'border-emerald-500/20', shadow: 'shadow-[0_0_50px_rgba(16,185,129,0.2)]',
                iconBg: 'bg-emerald-500/20 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.4)]', iconText: 'text-emerald-500',
                titleText: 'text-emerald-400', riskText: 'text-emerald-400 shadow-emerald-500',
                barBg: 'bg-emerald-500/5 border-emerald-500/20', barFill: 'from-emerald-400 to-emerald-600 shadow-[0_0_10px_emerald]', barWidth: 'w-[25%]',
                quoteBorder: 'border-emerald-500/50', btnBg: 'bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_20px_rgba(5,150,105,0.4)]',
                markerSize: 'w-3 h-3', markerColor: 'bg-emerald-500', markerShadow: 'shadow-[0_0_10px_rgba(16,185,129,0.4)]'
            };
    }
};

// --- DATA FETCHING & CACHING HELPERS ---
const cache = {
    jtwc: { data: null as any, time: 0 },
    gdacs: { data: null as any, time: 0 },
    ttl: 5 * 60 * 1000 // 5 minutes
};

const fetchWithBackoff = async (url: string, retries = 2, delay = 1000): Promise<any> => {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        if (retries > 0) {
            await new Promise(r => setTimeout(r, delay));
            return fetchWithBackoff(url, retries - 1, delay * 2);
        }
        throw err;
    }
};

const SafeWaveApp = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreInstance | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const alertMarkersRef = useRef<Marker[]>([]);
  const stormMarkersRef = useRef<Marker[]>([]); 

  const shelterMarkersRef = useRef<Marker[]>([]);
  const nationalAlertsRef = useRef<AlertItem[]>([]); // Ref to access data in listeners
  
  // --- STATE SYSTEM ---
  const [inputLocation, setInputLocation] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [isAIConsoleOpen, setIsAIConsoleOpen] = useState(true);
  const [isDashboardOpen, setIsDashboardOpen] = useState(true);

  const [consoleTab, setConsoleTab] = useState<'analysis' | 'alerts' | 'history' | 'rain' | 'shelters'>('analysis');
  
  const [dashboardInfo, setDashboardInfo] = useState<DashboardData>({ 
    title: 'Sẵn sàng', subtitle: 'Hệ thống đang chờ lệnh', coordinates: '--', 
    temp: 0, feelsLike: 0, tempMin: 0, tempMax: 0, humidity: 0, pressureSea: 0, pressureGround: 0,
    windSpeed: 0, windDir: 0, windGusts: 0, cloudCover: 0, elevation: 0, uvIndex: 0,
    rainStats: { h1: 0, h2: 0, h3: 0, h5: 0, h12: 0, h24: 0, d3: 0, d7: 0, d14: 0 },
    status: 'Standby' 
  });

  const [aiResult, setAiResult] = useState<RiskAnalysisResult | null>(null);
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [nationalAlerts, setNationalAlerts] = useState<AlertItem[]>([]);
  const [lastScanTime, setLastScanTime] = useState<string>('--:--');
  const [isScanning, setIsScanning] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<AlertItem | null>(null); 

  const [showRainLayer, setShowRainLayer] = useState(false);
  const [rainLayerTime, setRainLayerTime] = useState<number | null>(null); 
  const [provinceOptions, setProvinceOptions] = useState<string[]>([...VIETNAM_PROVINCES]);
  const [selectedProvince, setSelectedProvince] = useState<string>('');
  const [provinceRainHistory, setProvinceRainHistory] = useState<ProvinceRainSample[]>([]);
  const [shelters, setShelters] = useState<ShelterItem[]>([]);
  const [shelterFilter, setShelterFilter] = useState<string>('Tất cả');
  const [historicRecords, setHistoricRecords] = useState<HistoricRainRecord[]>([]);
  const [activeShelterId, setActiveShelterId] = useState<number | null>(null);
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<HistoryDetail | null>(null);
  const [historyDetailLoadingId, setHistoryDetailLoadingId] = useState<number | null>(null);
  const liveMonitoringRunnerRef = useRef<((lat: number, lng: number, options?: LiveMonitoringOptions) => Promise<void>) | null>(null);
  const [showWindyOverlay, setShowWindyOverlay] = useState<boolean>(false);
  const [windyEmbedUrl, setWindyEmbedUrl] = useState<string>('');

  const handleWindyOverlayClick = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!showWindyOverlay) return;
    const map = mapRef.current;
    if (!map || !liveMonitoringRunnerRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const lngLat = map.unproject([x, y]);
    map.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: map.getZoom(), speed: 1.2 });
    await liveMonitoringRunnerRef.current(lngLat.lat, lngLat.lng, { focusAnalysis: true, persist: true });
  }, [showWindyOverlay]);

  const focusProvinceOnMap = (province: string): void => {
    const centroid = PROVINCE_CENTROID_MAP[province];
    const map = mapRef.current;
    if (!centroid || !map) {
      return;
    }
    setIsDashboardOpen(true);
    map.flyTo({ center: [centroid.longitude, centroid.latitude], zoom: 7.2, speed: 1.1 });
    if (liveMonitoringRunnerRef.current) {
      void liveMonitoringRunnerRef.current(centroid.latitude, centroid.longitude, {
        presetTitle: province,
        presetSubtitle: province,
        provinceOverride: province,
        persist: false,
        focusAnalysis: false
      });
    }
  };

  const updateProvinceSelection = async (province: string) => {
    setSelectedProvince(province);
    focusProvinceOnMap(province);
    if (!province) {
      setProvinceRainHistory([]);
      setHistoricRecords([]);
      return;
    }
    const history = await dbService.getProvinceRainHistory(province, 20);
    setProvinceRainHistory(history);
    const historic = await dbService.getHistoricProvinceRecords(province);
    setHistoricRecords(historic);
  };

  const focusShelterOnMap = (shelter: ShelterItem) => {
    const map = mapRef.current;
    if (!map) return;
    setIsAIConsoleOpen(true);
    setIsDashboardOpen(true);
    setConsoleTab('shelters');
    setShelterFilter(shelter.province);
    setActiveShelterId(shelter.shelter_id);
    map.flyTo({ center: [shelter.longitude, shelter.latitude], zoom: 12, speed: 1.3 });
    if (liveMonitoringRunnerRef.current) {
      void liveMonitoringRunnerRef.current(shelter.latitude, shelter.longitude, {
        presetTitle: shelter.name,
        presetSubtitle: shelter.address || shelter.province,
        provinceOverride: shelter.province,
        persist: false,
        focusAnalysis: false
      });
    }
  };

  const focusHistoryLocation = (detail: HistoryDetail) => {
    const map = mapRef.current;
    const lat = detail.location.latitude;
    const lng = detail.location.longitude;
    if (!map || lat === undefined || lng === undefined) {
      return;
    }
    setIsDashboardOpen(true);
    map.flyTo({ center: [lng, lat], zoom: 12, speed: 1.2 });
    if (markerRef.current) markerRef.current.remove();
    const el = document.createElement('div');
    el.className = 'neon-marker-container';
    el.innerHTML = `<div class="neon-core"></div><div class="neon-pulse"></div>`;
    markerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(map);
  };

  const openHistoryDetail = async (historyId: number) => {
    setHistoryDetailLoadingId(historyId);
    try {
      const detail = await dbService.getHistoryDetail(historyId);
      if (!detail) {
        window.alert('Không tìm thấy dữ liệu chi tiết cho mục này.');
        return;
      }
      setSelectedHistoryDetail(detail);
      focusHistoryLocation(detail);
      setIsAIConsoleOpen(true);
    } catch (error) {
      console.error('Failed to load history detail:', error);
      window.alert('Không thể tải chi tiết. Vui lòng thử lại.');
    } finally {
      setHistoryDetailLoadingId(null);
    }
  };

  const closeHistoryDetail = () => {
    setSelectedHistoryDetail(null);
  };

  liveMonitoringRunnerRef.current = async (lat: number, lng: number, options: LiveMonitoringOptions = {}) => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const { presetTitle, presetSubtitle, provinceOverride, persist = true, focusAnalysis = true } = options;
    const coordsText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    if (focusAnalysis) {
      setConsoleTab('analysis');
      setAnalyzing(true);
    } else {
      setAnalyzing(false);
    }
    if (!isDashboardOpen) {
      setIsDashboardOpen(true);
    }

    if (markerRef.current) markerRef.current.remove();
    const markerEl = document.createElement('div');
    markerEl.className = 'neon-marker-container';
    markerEl.innerHTML = `<div class="neon-core"></div><div class="neon-pulse"></div>`;
    markerRef.current = new maplibregl.Marker({ element: markerEl, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);

    let line1 = presetTitle || 'Đang xác định vị trí...';
    let line2 = presetSubtitle || '';
    let provinceName = provinceOverride || 'Việt Nam';

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=vi`);
      const data = await res.json();
      if (data?.address) {
        const a = data.address;
        const specific = a.house_number || a.road || a.hamlet || a.path || '';
        const ward = a.suburb || a.town || a.village || a.neighbourhood || a.quarter || '';
        const district = a.city_district || a.district || a.county || '';
        const details = [specific, ward, district].filter(Boolean);
        line1 = details.length === 0 ? (data.name || line1) : details.join(', ');
        line2 = a.city || a.state || a.province || line2 || 'Việt Nam';
        provinceName = a.state || a.province || a.city || provinceName || 'Việt Nam';
      }
    } catch {
      if (!presetTitle) line1 = 'Không thể lấy tên địa điểm';
      if (!presetSubtitle) line2 = coordsText;
      if (!provinceOverride) provinceName = 'Không xác định';
    }

    const subtitleValue = line2 || provinceName || 'Việt Nam';
    const locationIsNamed = hasValidLocationName(line1);
    const shouldPersist = persist && locationIsNamed;
    setInputLocation(`${line1}, ${subtitleValue}`);

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,wind_gusts_10m,precipitation,soil_moisture_0_to_1cm&hourly=precipitation&daily=temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum&timezone=auto&forecast_days=14`;
      const wRes = await fetch(url);
      const wData = await wRes.json();
      if (wData.current && wData.hourly && wData.daily) {
        const current = wData.current;
        const hourlyRain = wData.hourly.precipitation;
        const dailyRain = wData.daily.precipitation_sum;
        const currentHourIndex = new Date().getHours();

        const sumRain = (startIdx: number, hoursCount: number) => {
          let total = 0;
          for (let i = startIdx; i < startIdx + hoursCount; i++) {
            if (hourlyRain[i] !== undefined && hourlyRain[i] !== null) total += hourlyRain[i];
          }
          return total;
        };
        const sumRainDays = (daysCount: number) => {
          let total = 0;
          for (let i = 0; i < daysCount; i++) {
            if (dailyRain[i] !== undefined) total += dailyRain[i];
          }
          return total;
        };

        const newData: DashboardData = {
          title: line1,
          subtitle: subtitleValue,
          coordinates: coordsText,
          temp: current.temperature_2m,
          feelsLike: current.apparent_temperature,
          tempMin: wData.daily.temperature_2m_min[0],
          tempMax: wData.daily.temperature_2m_max[0],
          humidity: current.relative_humidity_2m,
          pressureSea: current.pressure_msl,
          pressureGround: current.surface_pressure,
          windSpeed: current.wind_speed_10m,
          windDir: current.wind_direction_10m,
          windGusts: current.wind_gusts_10m || current.wind_speed_10m * 1.3,
          cloudCover: current.cloud_cover,
          elevation: wData.elevation || 0,
          uvIndex: wData.daily.uv_index_max[0],
          rainStats: {
            h1: sumRain(currentHourIndex, 1),
            h2: sumRain(currentHourIndex, 2),
            h3: sumRain(currentHourIndex, 3),
            h5: sumRain(currentHourIndex, 5),
            h12: sumRain(currentHourIndex, 12),
            h24: sumRain(currentHourIndex, 24),
            d3: sumRainDays(3),
            d7: sumRainDays(7),
            d14: sumRainDays(14)
          },
          soilMoisture: current.soil_moisture_0_to_1cm || 0.4,
          status: 'Live'
        };

        setDashboardInfo(newData);

        const storms = nationalAlertsRef.current.filter(a => a.type.includes('Bão') || a.type.includes('ATNĐ'));
        let minDistToStorm = 9999;
        storms.forEach(s => {
          const d = haversineKm(lat, lng, s.coords[1], s.coords[0]);
          if (d < minDistToStorm) minDistToStorm = d;
        });

        setTimeout(async () => {
          const result = calculateComplexRisk(newData, minDistToStorm);
          setAiResult(result);
          setAnalyzing(false);

          if (!shouldPersist) {
            return;
          }

          try {
            const advancedResult = calculateAdvancedRisk(newData, minDistToStorm);
            await dbService.saveAnalysis(
              {
                latitude: lat,
                longitude: lng,
                title: line1,
                subtitle: subtitleValue,
                elevation: newData.elevation,
                province: provinceName
              },
              {
                temp: newData.temp,
                feelsLike: newData.feelsLike,
                tempMin: newData.tempMin,
                tempMax: newData.tempMax,
                humidity: newData.humidity,
                pressureSea: newData.pressureSea,
                pressureGround: newData.pressureGround,
                windSpeed: newData.windSpeed,
                windDir: newData.windDir,
                windGusts: newData.windGusts,
                cloudCover: newData.cloudCover,
                uvIndex: newData.uvIndex,
                soilMoisture: newData.soilMoisture
              },
              newData.rainStats,
              {
                level: advancedResult.level,
                label: advancedResult.label,
                score: advancedResult.score,
                confidence: advancedResult.confidence,
                actions: advancedResult.actions,
                terrainType: advancedResult.factors.terrain,
                soilType: advancedResult.factors.soil,
                saturation: advancedResult.factors.saturation
              },
              advancedResult.reasons
            );

            const history = await dbService.getHistory(100);
            const transformedHistory = history.map(item => ({
              id: item.id,
              location: item.location,
              risk: item.risk as RiskLevel,
              type: item.type,
              is_favorite: item.is_favorite || 0,
              created_at: item.created_at
            }));
            setHistoryList(transformedHistory);

            if (provinceName && provinceName === selectedProvince) {
              const rainHistory = await dbService.getProvinceRainHistory(provinceName, 20);
              setProvinceRainHistory(rainHistory);
            }
          } catch (error) {
            console.error('Error saving to database:', error);
            if (shouldPersist && result.level >= 2) {
              setHistoryList(prev => {
                const now = Date.now();
                const newItem: HistoryItem = {
                  id: now,
                  location: line1,
                  risk: result.riskLabel,
                  type: result.level === 4 ? 'Nguy hiểm' : 'Thời tiết xấu'
                };
                return [newItem, ...prev].filter(item => (now - item.id) < 864000000);
              });
            }
          }
        }, 800);
      }
    } catch (err) {
      console.error('Failed to refresh live monitoring:', err);
      setAnalyzing(false);
    }
  };

  // Load history from database on mount
  useEffect(() => {
    const loadHistory = async () => {
      const history = await dbService.getHistory(100);
      // Transform to match HistoryItem interface
      const transformedHistory = history.map(item => ({
        id: item.id,
        location: item.location,
        risk: item.risk as RiskLevel,
        type: item.type,
        is_favorite: item.is_favorite || 0,
        created_at: item.created_at
      }));
      setHistoryList(transformedHistory);
    };
    loadHistory();
  }, []);

  useEffect(() => {
    const loadProvinceContext = async () => {
      const provinces = await dbService.getProvinceList();
      const options = [...VIETNAM_PROVINCES];
      setProvinceOptions(options);
      const initialProvince = provinces[0] || options[0] || '';
      await updateProvinceSelection(initialProvince);
    };

    const loadShelterData = async () => {
      const shelterItems = await dbService.getShelters();
      setShelters(shelterItems);
    };

    loadProvinceContext();
    loadShelterData();
  }, []);

  useEffect(() => {
    if (!showWindyOverlay) {
      setWindyEmbedUrl('');
      return;
    }
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const updateEmbed = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      setWindyEmbedUrl(buildWindyEmbedUrl(center.lat, center.lng, zoom));
    };
    updateEmbed();
    map.on('moveend', updateEmbed);
    return () => {
      map.off('moveend', updateEmbed);
    };
  }, [showWindyOverlay]);

  useEffect(() => {
    if (consoleTab !== 'shelters' || activeShelterId === null) return;
    const card = document.getElementById(`shelter-card-${activeShelterId}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeShelterId, consoleTab]);

  // Sync ref with state
  useEffect(() => {
    nationalAlertsRef.current = nationalAlerts;
  }, [nationalAlerts]);


  // Toggle rain layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    
    // Wait for layer to be created, then toggle
    const toggleRainLayer = (retries = 0) => {
      if (map.getLayer('rain-layer')) {
        const visibility = showRainLayer ? 'visible' : 'none';
        map.setLayoutProperty('rain-layer', 'visibility', visibility);
        console.log('Rain layer toggled to:', visibility, 'showRainLayer:', showRainLayer);
      } else {
        // Layer not ready yet, retry after short delay (max 5 seconds)
        if (retries < 50) {
          setTimeout(() => toggleRainLayer(retries + 1), 100);
        } else {
          console.warn('Rain layer not found after 5 seconds');
        }
      }
    };
    
    toggleRainLayer();
  }, [showRainLayer]);

  // --- SYSTEM SCAN: REAL DATA ONLY (GDACS) ---
  const fetchRealStorms = async () => {
    setIsScanning(true);
    const alerts: AlertItem[] = [];
    const now = Date.now();

    try {
        // 1. Fetch GDACS
        let gdacsData = null;
        if (cache.gdacs.data && (now - cache.gdacs.time < cache.ttl)) {
            gdacsData = cache.gdacs.data;
        } else {
            // Luôn thử dùng IPC handler trước (hoạt động cả dev và production)
            if (window.safewave?.fetchGdacs) {
                try {
                    gdacsData = await window.safewave.fetchGdacs();
                } catch (ipcError) {
                    console.warn('IPC fetch failed, trying proxy:', ipcError);
                    // Fallback: thử proxy trong dev hoặc fetch trực tiếp
            const gdacsUrl = '/api-gdacs/gdacsapi/api/events/geteventlist/MAP?eventtypes=TC';
            gdacsData = await fetchWithBackoff(gdacsUrl);
                }
            } else {
                // Fallback nếu không có IPC (shouldn't happen)
                const gdacsUrl = '/api-gdacs/gdacsapi/api/events/geteventlist/MAP?eventtypes=TC';
                gdacsData = await fetchWithBackoff(gdacsUrl);
            }
            cache.gdacs = { data: gdacsData, time: now };
        }

        // 3. Process Data
        const detectedStorms: AlertItem[] = [];

        if (gdacsData && gdacsData.features) {
            for (const f of gdacsData.features) {
                const props = f.properties;
                const coords = f.geometry.coordinates;

                // MỞ RỘNG PHẠM VI (Indo, Malay, Phil...)
                if (coords[0] >= 70 && coords[0] <= 170 && coords[1] >= -20 && coords[1] <= 50) {
                    
                    // --- SỬA LOGIC: LUÔN LÀ CẢNH BÁO HOẶC NGUY HIỂM ---
                    let level: RiskLevel = 'Cảnh báo'; 
                    let wind = 60; 
                    
                    const desc = props.description || "";
                    const windMatch = desc.match(/(\d+)\s*km\/h/);
                    if (windMatch) wind = parseInt(windMatch[1]);
                    
                    if (props.alertlevel === 'Red' || wind >= 100) {
                        level = 'Nguy hiểm';
                    } else {
                        level = 'Cảnh báo'; // Ép buộc mức thấp nhất là Cảnh báo
                    }

                    const stormItem: AlertItem = {
                        id: props.eventid,
                        location: props.name || props.eventname || 'Áp thấp / Bão',
                        province: props.country || 'Khu vực Biển Đông / TBD',
                        level: level,
                        type: 'Bão / ATNĐ',
                        timestamp: new Date(props.todate).toLocaleTimeString('vi-VN'),
                        rainAmount: 0,
                        windSpeed: wind,
                        description: `Di chuyển hướng Tây. ${props.severitydata?.severitytext || ''}`,
                        coords: [coords[0], coords[1]],
                        source: 'GDACS',
                        coneGeoJSON: f.geometry 
                    };
                    
                    alerts.push(stormItem);
                    detectedStorms.push(stormItem);
                }
            }
        }

        // UPDATE LAYER CHO TẤT CẢ BÃO (Hiển thị đa điểm)
        updateStormLayers(detectedStorms.length > 0 ? detectedStorms : null);


        const clusteredAlerts = clusterAlerts(alerts, 50);
        setNationalAlerts(clusteredAlerts);
        setLastScanTime(new Date().toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'}));

        
        // Save alerts to database
        try {
            for (const alert of clusteredAlerts) {
                await dbService.saveAlert({
                    externalId: String(alert.id),
                    locationName: alert.location,
                    province: alert.province,
                    level: alert.level,
                    type: alert.type,
                    latitude: alert.coords[1],
                    longitude: alert.coords[0],
                    rainAmount: alert.rainAmount,
                    windSpeed: alert.windSpeed,
                    description: alert.description,
                    source: alert.source || 'GDACS',
                    isCluster: alert.isCluster || false,
                    clusterCount: alert.count || 1
                });
            }
        } catch (error) {
            console.error('Error saving alerts to database:', error);
        }

    } catch (e) {
        console.error("System Scan Critical Error:", e);
    } finally {
        setIsScanning(false);
    }
  };

  // --- LOGIC VẼ BÃO (MULTI-STORM SUPPORT) ---
  const updateStormLayers = (storms: AlertItem[] | null) => {
      const map = mapRef.current;
      if (!map) return;

      // Clear old markers
      stormMarkersRef.current.forEach(m => m.remove());
      stormMarkersRef.current = [];

      if (!storms || storms.length === 0) {
          if (map.getSource('storm-wind-source')) {
            (map.getSource('storm-wind-source') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
            (map.getSource('storm-track-source') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
          }
          return;
      }

      const allTracks: any[] = [];
      const allWinds: any[] = [];

      storms.forEach(stormData => {
          // 1. Tạo Icon Tâm Bão (Chấm đỏ nháy)
          const el = document.createElement('div');
          el.className = 'flex items-center justify-center';
          el.innerHTML = `<div class="relative w-12 h-12 flex items-center justify-center"><div class="absolute inset-0 border-2 border-red-500 rounded-full animate-ping opacity-50"></div><div class="absolute inset-0 border border-white/30 rounded-full"></div><div class="animate-spin text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 22a2.5 2.5 0 0 1-2.5-2.5v-15a2.5 2.5 0 0 1 4.96-.44 2.5 2.5 0 0 1 2.96 3.08 3 3 0 0 1 .34 5.58 2.5 2.5 0 0 1-1.32 4.24 2.5 2.5 0 0 1-1.98 3 2.5 2.5 0 0 1-2.46 1.04Z"/></svg></div></div>`;
          const stormMarker = new maplibregl.Marker({ element: el }).setLngLat(stormData.coords).addTo(map);
          stormMarkersRef.current.push(stormMarker);

          // 2. Track Data
          allTracks.push({
              type: 'Feature',
              geometry: {
                  type: 'LineString',
                  coordinates: [
                      [stormData.coords[0] + 5, stormData.coords[1]], 
                      [stormData.coords[0] + 2, stormData.coords[1] + 0.5],
                      stormData.coords
                  ]
              },
              properties: {}
          });

          // 3. Wind Circles
          const createGeoJSONCircle = (center: [number, number], radiusInKm: number, points = 64) => {
            const coords = { latitude: center[1], longitude: center[0] };
            const km = radiusInKm;
            const ret = [];
            const distanceX = km / (111.320 * Math.cos(coords.latitude * Math.PI / 180));
            const distanceY = km / 110.574;
            for(let i=0; i<points; i++) {
                const theta = (i / points) * (2 * Math.PI);
                const x = distanceX * Math.cos(theta);
                const y = distanceY * Math.sin(theta);
                ret.push([coords.longitude + x, coords.latitude + y]);
            }
            ret.push(ret[0]); 
            return ret;
          };

          allWinds.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [createGeoJSONCircle(stormData.coords, 200)] }, properties: { level: 2 } });
          allWinds.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [createGeoJSONCircle(stormData.coords, 60)] }, properties: { level: 3 } });
      });

      if (map.getSource('storm-track-source')) (map.getSource('storm-track-source') as GeoJSONSource).setData({ type: 'FeatureCollection', features: allTracks });
      if (map.getSource('storm-wind-source')) (map.getSource('storm-wind-source') as GeoJSONSource).setData({ type: 'FeatureCollection', features: allWinds });
  };

  useEffect(() => {
    fetchRealStorms(); 
    const interval = setInterval(fetchRealStorms, 10 * 60 * 1000); 
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    alertMarkersRef.current.forEach(marker => marker.remove());
    alertMarkersRef.current = [];

    nationalAlerts.forEach(alert => {
        if (alert.type.includes('Bão') || alert.type.includes('ATNĐ')) return;

        const styles = getAlertStyles(alert.level);
        const el = document.createElement('div');
        el.className = 'flex items-center justify-center cursor-pointer group relative';
        
        if (alert.isCluster) {
            el.innerHTML = `<div class="absolute inset-0 rounded-full animate-ping opacity-75 ${styles.markerColor}"></div><div class="relative rounded-full border-2 border-white/50 w-12 h-12 ${styles.markerColor} ${styles.markerShadow} flex items-center justify-center transition-transform group-hover:scale-110 z-10"><span class="text-white font-bold text-xs">${alert.count}</span></div>`;
        } else {
            el.innerHTML = `<div class="absolute inset-0 rounded-full animate-ping opacity-75 ${styles.markerColor}"></div><div class="relative rounded-full border-2 border-white/20 ${styles.markerSize} ${styles.markerColor} ${styles.markerShadow} transition-transform group-hover:scale-125 z-10"></div>`;
        }

        const marker = new maplibregl.Marker({ element: el }).setLngLat(alert.coords).addTo(map);
        el.addEventListener('click', (e) => { e.stopPropagation(); setSelectedAlert(alert); map.flyTo({ center: alert.coords, zoom: alert.isCluster ? 9 : 11, speed: 1.5 }); });
        alertMarkersRef.current.push(marker);
    });
  }, [nationalAlerts]);


  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    shelterMarkersRef.current.forEach(marker => marker.remove());
    shelterMarkersRef.current = [];
    shelters.forEach(shelter => {
      const el = document.createElement('div');
      el.className = 'flex items-center justify-center cursor-pointer group';
      el.innerHTML = `<div class="relative rounded-full border-2 border-white/40 bg-emerald-500/80 text-white w-8 h-8 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.5)]">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path d="M3 10l9-7 9 7" />
          <path d="M4 10v10h16V10" />
          <path d="M9 21V12h6v9" />
        </svg>
      </div>`;
      const marker = new maplibregl.Marker({ element: el }).setLngLat([shelter.longitude, shelter.latitude]).addTo(map);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        focusShelterOnMap(shelter);
      });
      shelterMarkersRef.current.push(marker);
    });
  }, [shelters]);

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
      
      map.addLayer({ 
        id: 'hillshade-layer', 
        type: 'hillshade', 
        source: 'terrain-source', 
        paint: { 
            'hillshade-shadow-color': 'rgba(0, 0, 0, 0.15)', 
            'hillshade-highlight-color': 'rgba(255, 255, 255, 0.2)', 
            'hillshade-accent-color': 'rgba(0,0,0,0.1)',
            'hillshade-exaggeration': 0.5
        } 
      });

      map.addSource('storm-wind-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('storm-track-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('storm-cone-source', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} } });

      map.addLayer({
          id: 'storm-cone-layer', type: 'fill', source: 'storm-cone-source',
          paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.1 }
      });
      map.addLayer({
          id: 'storm-wind-layer', type: 'fill', source: 'storm-wind-source',
          paint: {
              'fill-color': ['match', ['get', 'level'], 1, '#facc15', 2, '#f97316', 3, '#ef4444', '#cccccc'],
              'fill-opacity': 0.3,
              'fill-outline-color': ['match', ['get', 'level'], 1, '#facc15', 2, '#f97316', 3, '#ef4444', '#cccccc']
          }
      });
      map.addLayer({
          id: 'storm-track-layer', type: 'line', source: 'storm-track-source',
          paint: { 'line-color': '#06b6d4', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.8 }
      });


      const loadRainLayer = () => {
        if (map.getSource('rain-source')) {
          return;
        }
        const tiles = [`${WINDY_RADAR_TILES}?t=${Date.now()}`];
        map.addSource('rain-source', { 
          type: 'raster', 
          tiles,
          tileSize: 256,
          attribution: WINDY_ATTRIBUTION
        });
        map.addLayer({ 
          id: 'rain-layer', 
          type: 'raster', 
          source: 'rain-source', 
          paint: { 'raster-opacity': 0.7 },
          layout: { visibility: showRainLayer ? 'visible' : 'none' }
        });
        setRainLayerTime(Math.floor(Date.now() / 1000));
        console.log('Windy radar layer initialized.');
      };
      loadRainLayer();

      // --- LOGIC CLICK ---
      map.on('click', async (e) => {
        const { lng, lat } = e.lngLat;

        if (liveMonitoringRunnerRef.current) {
          await liveMonitoringRunnerRef.current(lat, lng, { focusAnalysis: true, persist: true });
            }
      });
    });
  }, []); 



  const latestProvinceSample = provinceRainHistory[0];
  const historicMaxRecord = historicRecords.reduce<HistoricRainRecord | null>((top, record) => {
    if (!top || record.h24 > top.h24) {
      return record;
    }
    return top;
  }, null);
  const shelterProvinceOptions = Array.from(new Set(shelters.map(s => s.province))).sort();
  const filteredShelters = shelterFilter === 'Tất cả' ? shelters : shelters.filter(s => s.province === shelterFilter);

  return (
    <div className="relative w-full h-screen bg-[#020408] text-slate-200 overflow-hidden font-sans selection:bg-cyan-500/30">
      
      {/* MAP CONTAINER */}
      <div className="absolute inset-0 z-0"><div ref={mapContainerRef} className="w-full h-full bg-[#05060a]"/></div>

      <div
        className={`absolute inset-0 transition-opacity duration-300 ${showWindyOverlay ? 'z-20 opacity-100 cursor-crosshair' : 'pointer-events-none opacity-0'}`}
        onClick={handleWindyOverlayClick}
      >
        {showWindyOverlay && windyEmbedUrl && (
          <iframe
            src={windyEmbedUrl}
            title="Windy Overlay"
            className="w-full h-full border-none"
            frameBorder="0"
            allowFullScreen
            style={{ pointerEvents: 'none' }}
          />
        )}
      </div>

      {/* DASHBOARD CARD */}
      {isDashboardOpen ? (
        <div className="absolute top-6 left-6 z-20 w-[420px] glass-card rounded-3xl overflow-hidden group transition-all duration-300 flex flex-col max-h-[90vh]">
          <div className="p-5 border-b border-white/5 relative bg-gradient-to-b from-white/5 to-transparent">
            <button onClick={() => setIsDashboardOpen(false)} className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition"><Minus size={16} /></button>
            <div className="flex items-center gap-2 mb-2">
              <div className={`px-2 py-0.5 rounded-full border text-[9px] font-bold tracking-wider uppercase flex items-center gap-1.5 bg-red-500/10 border-red-500/20 text-red-400`}>
                <span className={`relative flex h-1.5 w-1.5`}><span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-red-400`}></span><span className={`relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500`}></span></span>
                Live Monitoring
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
                 <div className="bg-white/5 rounded-xl p-3 border border-white/5 relative overflow-hidden"><div className="text-[10px] text-gray-500 uppercase font-bold mb-1 flex items-center gap-1"><Waves size={10}/> Gió giật</div><div className="text-xl font-bold text-white">{dashboardInfo.windGusts.toFixed(1)}<span className="text-xs text-gray-400 font-normal ml-0.5">km/h</span></div><div className="text-[10px] text-red-300 mt-1">Cấp gió {dashboardInfo.windGusts > 90 ? '10-11' : dashboardInfo.windGusts > 60 ? '8-9' : '<7'}</div></div>
             </div>
             <div className="grid grid-cols-3 gap-2 mt-2">
                 {[{ l: 'Độ ẩm', v: dashboardInfo.humidity + '%', c: 'text-blue-400', i: Droplets }, { l: 'Áp suất', v: dashboardInfo.pressureSea, u: 'hPa', c: 'text-purple-400', i: Gauge }, { l: 'Mây', v: dashboardInfo.cloudCover + '%', c: 'text-gray-400', i: Sun }].map((d,i) => (<div key={i} className="bg-white/5 rounded-lg p-2 text-center border border-white/5"><d.i size={14} className={`mx-auto mb-1 ${d.c}`}/><div className="text-sm font-bold text-white leading-none">{d.v}</div><div className="text-[8px] text-gray-500 mt-1 font-bold uppercase">{d.l}</div></div>))}
             </div>
             <div className="mt-4 bg-[#0b0f16]/60 rounded-xl border border-white/10 p-3">
                 <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/5"><Umbrella size={14} className="text-blue-400"/><span className="text-xs font-bold text-white uppercase tracking-wider">Lượng mưa & Dự báo</span></div>
                 <div className="mb-3"><div className="text-[9px] text-gray-500 uppercase font-bold mb-2">Ngắn hạn (Giờ)</div><div className="grid grid-cols-6 gap-1 text-center">{[{ l: '1h', v: dashboardInfo.rainStats.h1 }, { l: '2h', v: dashboardInfo.rainStats.h2 }, { l: '3h', v: dashboardInfo.rainStats.h3 }, { l: '5h', v: dashboardInfo.rainStats.h5 }, { l: '12h', v: dashboardInfo.rainStats.h12 }, { l: '24h', v: dashboardInfo.rainStats.h24 }].map((r, idx) => (<div key={idx} className={`rounded-md p-1 border ${r.v > 0 ? 'bg-blue-500/10 border-blue-500/30' : 'bg-transparent border-white/5'}`}><div className={`text-[10px] font-bold ${r.v > 5 ? 'text-red-400' : r.v > 0 ? 'text-blue-300' : 'text-gray-600'}`}>{r.v.toFixed(1)}</div><div className="text-[8px] text-gray-500 mt-0.5">{r.l}</div></div>))}</div></div>
                 <div><div className="text-[9px] text-gray-500 uppercase font-bold mb-2">Dự báo sớm (Ngày)</div><div className="grid grid-cols-3 gap-2 text-center">{[{ l: '3 Ngày tới', v: dashboardInfo.rainStats.d3 }, { l: '7 Ngày tới', v: dashboardInfo.rainStats.d7 }, { l: '14 Ngày tới', v: dashboardInfo.rainStats.d14 }].map((r, idx) => (<div key={idx} className="flex items-center justify-between bg-white/5 px-2 py-1.5 rounded-lg border border-white/5"><span className="text-[9px] text-gray-400 font-bold">{r.l}</span><span className={`text-xs font-bold ${r.v > 150 ? 'text-red-500 animate-pulse' : r.v > 50 ? 'text-orange-400' : r.v > 10 ? 'text-blue-300' : 'text-white'}`}>{r.v.toFixed(0)}mm</span></div>))}</div></div>
             </div>
             <div className="mt-2 flex justify-between text-[9px] text-gray-600 font-mono px-1"><span>Pressure (Ground): {dashboardInfo.pressureGround} hPa</span><span>Soil Saturation Est: {aiResult ? Math.round(aiResult.factors.saturation) : '--'}%</span></div>
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

                  {[{ id: 'analysis', label: 'Phân tích', color: 'cyan' }, { id: 'alerts', label: 'Cảnh báo', color: 'red' }, { id: 'history', label: 'Lịch sử', color: 'purple' }, { id: 'rain', label: 'Mưa tỉnh', color: 'blue' }, { id: 'shelters', label: 'Điểm trú', color: 'emerald' }].map(tab => (
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
                        <div className="flex flex-col items-center justify-center py-10 gap-4">
                            <div className="loader-spin border-t-cyan-400 border-r-cyan-400"></div>
                            <div className="text-center"><span className="text-xs font-mono text-cyan-400 animate-pulse block">Đang tổng hợp dữ liệu...</span></div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-5">
                            {aiResult ? (
                                <div className="bg-[#0b0f16]/40 border border-white/5 rounded-2xl p-5 flex flex-col gap-4 relative overflow-hidden">
                                    <div className={`absolute inset-0 opacity-10 blur-3xl ${aiResult.level === 4 ? 'bg-red-600' : aiResult.level === 3 ? 'bg-orange-600' : 'bg-green-600'}`}></div>
                                    <div className="flex items-end justify-between gap-3 h-[100px] relative z-10 px-4">
                                        {[{ lvl: 1, label: 'An toàn', color: 'bg-emerald-500' }, { lvl: 2, label: 'Nhẹ', color: 'bg-yellow-400' }, { lvl: 3, label: 'Cảnh báo', color: 'bg-orange-500' }, { lvl: 4, label: 'Nguy hiểm', color: 'bg-red-500' }].map((item) => (
                                            <div key={item.lvl} className="flex-1 flex flex-col items-center justify-end gap-3 group h-full">
                                                <div className={`w-1.5 rounded-full transition-all duration-700 relative ${aiResult.level === item.lvl ? `h-full ${item.color} opacity-100 shadow-[0_0_15px_currentColor]` : 'h-2 bg-gray-700/50 opacity-30'}`}></div>
                                                <span className={`text-[9px] font-bold uppercase tracking-wider ${aiResult.level === item.lvl ? 'text-white opacity-100' : 'text-gray-600 opacity-40'}`}>{item.label}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-2 pt-4 border-t border-white/5 z-10">
                                        <div className={`text-2xl font-bold mb-2 ${aiResult.level === 4 ? 'text-white text-glow-red' : 'text-white'}`}>{aiResult.title}</div>
                                        <p className="text-xs text-gray-300 leading-relaxed font-light">{aiResult.description}</p>
                                    </div>
                                    <div className="flex gap-2 text-[10px] text-gray-500 uppercase font-bold mt-2 pt-2 border-t border-white/5 border-dashed">
                                        <span>Terrain: {aiResult.factors.terrain}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center text-gray-500 text-xs py-4">Chưa có dữ liệu phân tích. Hãy chọn một điểm trên bản đồ.</div>
                            )}
                            <button onClick={() => setAnalyzing(true)} className="w-full bg-cyan-600/10 hover:bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 group relative overflow-hidden"><span className="relative flex h-2 w-2 mr-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span></span>Cập nhật dữ liệu</button>
                        </div>
                    )}
                </div>
              )}

              {/* TAB 2: CẢNH BÁO */}
              {consoleTab === 'alerts' && (
                 <div className="flex flex-col h-full">
                     <div className="flex justify-between items-center mb-4"><div className="flex items-center gap-2"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span></span><span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Hệ thống giám sát 24/7</span></div><div className="flex items-center gap-2"><span className="text-[10px] text-gray-500 font-mono">{lastScanTime}</span><button onClick={fetchRealStorms} disabled={isScanning} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition disabled:opacity-50"><RefreshCw size={12} className={isScanning ? 'animate-spin' : ''}/></button></div></div>
                     {isScanning ? (
                         <div className="flex-1 flex flex-col items-center justify-center gap-3"><div className="loader-spin border-t-red-500 border-r-red-500 w-8 h-8"></div><div className="text-xs text-red-400 animate-pulse font-mono">Đang quét toàn bộ lãnh thổ...</div></div>
                     ) : (
                         <div className="flex flex-col gap-3 pb-4">
                             {nationalAlerts.length === 0 ? <div className="text-center py-10 text-gray-500 text-xs">Không phát hiện sự kiện thiên tai nghiêm trọng trong khu vực.</div> : nationalAlerts.map((alert) => (
                                 <div key={alert.id} onClick={() => { setSelectedAlert(alert); mapRef.current?.flyTo({ center: alert.coords, zoom: alert.isCluster ? 9 : 11, speed: 1.5 }); }} className="bg-[#0b0f16]/60 border border-white/5 hover:border-red-500/30 hover:bg-red-500/5 rounded-xl p-3 transition flex gap-3 items-start group cursor-pointer relative overflow-hidden">
                                     <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${alert.level === 'Nguy hiểm' ? 'bg-red-500/20 text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]' : alert.level === 'Cảnh báo' ? 'bg-orange-500/20 text-orange-500' : alert.level === 'Nhẹ' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-green-500/20 text-green-500'}`}>
                                        {alert.type.includes('Bão') ? <Tornado size={20} className="animate-spin-slow"/> : alert.isCluster ? <Activity size={20} /> : (alert.level === 'Nguy hiểm' ? <Siren size={20} className="animate-pulse"/> : alert.level === 'Cảnh báo' ? <AlertTriangle size={20}/> : <Info size={20}/>)}
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

                      {historyList.length === 0 ? (
                          <div className="text-center py-8 text-gray-500 text-xs">Chưa có dữ liệu rủi ro.</div>
                      ) : (
                          historyList.map((item) => {
                              const isFavorite = item.is_favorite === 1;
                              const isLoadingDetail = historyDetailLoadingId === item.id;
                              return (
                                  <div
                                      key={item.id}
                                      onClick={() => openHistoryDetail(item.id)}
                                      className="bg-[#0b0f16]/60 border border-white/5 hover:border-white/15 rounded-xl p-3 transition flex gap-3 items-center group relative cursor-pointer"
                                  >
                                      {isLoadingDetail && (
                                          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm rounded-xl flex items-center justify-center text-xs font-bold text-white">
                                              Đang tải...
                                          </div>
                                      )}
                                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${item.risk === 'Nguy hiểm' ? 'bg-red-500/10 text-red-500' : item.risk === 'Cảnh báo' ? 'bg-orange-500/10 text-orange-500' : item.risk === 'Nhẹ' ? 'bg-yellow-500/10 text-yellow-500' : 'bg-green-500/10 text-green-500'}`}>
                                          <History size={18}/>
                                      </div>
                              <div className="flex-1 min-w-0">
                                  <div className="flex justify-between items-start">

                                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                                  {isFavorite && <Star size={12} className="text-yellow-400 fill-yellow-400 shrink-0"/>}
                                                  <h4 className="text-xs font-bold text-gray-200 truncate">{item.location}</h4>
                                  </div>

                                              <span className="text-[9px] font-mono text-gray-500 shrink-0 flex items-center gap-1 ml-2"><Clock size={8}/> {item.created_at ? formatHistoryTime(new Date(item.created_at).getTime()) : '--'}</span>
                              </div>

                                          <div className="flex items-center gap-2 mt-1">
                                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-white/5 border-white/10 text-gray-400">{item.type}</span>
                          </div>

                                      </div>
                                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <button
                                              onClick={async (e) => {
                                                  e.stopPropagation();
                                                  const result = await dbService.toggleFavorite(item.id);
                                                  if (result.success) {
                                                      // Reload history
                                                      const history = await dbService.getHistory(100);
                                                      const transformedHistory = history.map(h => ({
                                                          id: h.id,
                                                          location: h.location,
                                                          risk: h.risk as RiskLevel,
                                                          type: h.type,
                                                          is_favorite: h.is_favorite || 0,
                                                          created_at: h.created_at
                                                      }));
                                                      setHistoryList(transformedHistory);
                                                  }
                                              }}
                                              className={`p-1.5 rounded-lg transition ${
                                                  isFavorite 
                                                      ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30' 
                                                      : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-yellow-400'
                                              }`}
                                              title={isFavorite ? 'Bỏ yêu thích' : 'Đánh dấu yêu thích'}
                                          >
                                              <Star size={14} className={isFavorite ? 'fill-current' : ''}/>
                                          </button>
                                          <button
                                              onClick={async (e) => {
                                                  e.stopPropagation();
                                                  e.preventDefault();
                                                  if (window.confirm('Bạn có chắc muốn xóa mục này?')) {
                                                      try {
                                                          console.log('Deleting history item with ID:', item.id, 'Type:', typeof item.id);
                                                          const result = await dbService.deleteHistory(item.id);
                                                          console.log('Delete result:', result);
                                                          if (result.success) {
                                                              // Remove from list
                                                              setHistoryList(prev => prev.filter(h => h.id !== item.id));
                                                          } else {
                                                              console.error('Delete failed:', result.error);
                                                              window.alert('Không thể xóa: ' + (result.error || 'Lỗi không xác định'));
                                                          }
                                                      } catch (error) {
                                                          console.error('Delete error:', error);
                                                          window.alert('Lỗi khi xóa: ' + String(error));
                                                      }
                                                  }
                                              }}
                                              className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-red-500/20 hover:text-red-400 transition"
                                              title="Xóa mục này"
                                          >
                                              <Trash2 size={14}/>
                                          </button>
                                      </div>
                                  </div>
                              );
                          })
                      )}
                  </div>
              )}

              {/* TAB 4: MƯA THEO TỈNH */}
              {consoleTab === 'rain' && (
                  <div className="flex flex-col gap-4">
                      <div>
                          <label className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Chọn tỉnh / thành phố</label>
                          <div className="flex items-center gap-2 mt-2">
                              <Map size={14} className="text-blue-400" />
                              <select
                                  value={selectedProvince}
                                  onChange={(e) => updateProvinceSelection(e.target.value)}
                                  className="flex-1 bg-[#05060a]/50 border border-white/10 rounded-xl py-2 px-3 text-xs text-white focus:border-blue-500/50 outline-none"
                              >
                                  {provinceOptions.map((province) => (
                                      <option key={province} value={province}>{province}</option>
                                  ))}
                              </select>
                  </div>

                        </div>
                        {latestProvinceSample ? (
                            <>
                          <div className="bg-[#0b0f16]/60 border border-white/5 rounded-2xl p-4 flex flex-col gap-4">
                              <div className="flex items-center justify-between">
                                  <div>
                                      <div className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Tổng hợp 24h qua</div>
                                      <div className="text-lg font-bold text-white">{selectedProvince}</div>
                                  </div>
                                  <div className="text-[10px] text-gray-500">{new Date(latestProvinceSample.recorded_at).toLocaleString('vi-VN')}</div>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                  {[{ label: '1h', value: latestProvinceSample.h1, tone: 'text-blue-300' },
                                    { label: '3h', value: latestProvinceSample.h3, tone: 'text-cyan-300' },
                                    { label: '24h', value: latestProvinceSample.h24, tone: 'text-indigo-300' },
                                    { label: '3 ngày', value: latestProvinceSample.d3, tone: 'text-emerald-300' },
                                    { label: '7 ngày', value: latestProvinceSample.d7, tone: 'text-amber-300' },
                                    { label: '14 ngày', value: latestProvinceSample.d14, tone: 'text-red-300' }].map((item, idx) => (
                                      <div key={idx} className="bg-white/5 rounded-lg p-3 border border-white/5">
                                          <div className="text-[9px] uppercase text-gray-500 font-bold">{item.label}</div>
                                          <div className={`text-xl font-bold ${item.tone}`}>{item.value.toFixed(1)}<span className="text-[10px] text-gray-400 ml-1">mm</span></div>
                                      </div>
                                  ))}
                              </div>
                          </div>
                            <div className="mt-4 bg-white/5 rounded-xl p-3 border border-white/5">
                                <div className="flex items-center justify-between text-[10px] text-gray-500 uppercase font-bold">
                                    <span className="flex items-center gap-1"><CloudRain size={12}/> Lịch sử mưa lớn nhất</span>
                                    {historicMaxRecord && historicMaxRecord.h24 > 0 && (
                                        <span>{new Date(historicMaxRecord.recorded_at).toLocaleDateString('vi-VN')}</span>
              )}
           </div>
                                {historicMaxRecord && historicMaxRecord.h24 > 0 ? (
                                    <>
                                        <div className="mt-2 text-2xl font-bold text-blue-300">
                                            {historicMaxRecord.h24.toFixed(1)}
                                            <span className="text-sm text-gray-400 ml-1">mm</span>
                                        </div>
                                        <div className="mt-1 text-[11px] text-gray-400">
                                            {historicMaxRecord.location_note || selectedProvince}
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-xs text-gray-500 mt-2">Chưa có thống kê cho tỉnh này.</div>
                                )}
                            </div>
                            </>
                        ) : (
                          <div className="text-xs text-gray-500 text-center py-6">Chưa có dữ liệu realtime cho tỉnh này. Hệ thống sẽ tự động cập nhật khi collector lấy mẫu mới.</div>
                      )}
                      {/* Removed historical press list per request */}
                  </div>
              )}

              {/* TAB 5: ĐIỂM TRÚ BÃO */}
              {consoleTab === 'shelters' && (
                  <div className="flex flex-col gap-4">
                      <div>
                          <label className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Lọc theo khu vực</label>
                          <div className="flex items-center gap-2 mt-2">
                              <Building size={14} className="text-emerald-400" />
                              <select
                                  value={shelterFilter}
                                  onChange={(e) => setShelterFilter(e.target.value)}
                                  className="flex-1 bg-[#05060a]/50 border border-white/10 rounded-xl py-2 px-3 text-xs text-white focus:border-emerald-500/50 outline-none"
                              >
                                  <option value="Tất cả">Tất cả</option>
                                  {shelterProvinceOptions.map((province) => (
                                      <option key={province} value={province}>{province}</option>
                                  ))}
                              </select>
                          </div>
                      </div>
                      {filteredShelters.length === 0 ? (
                          <div className="text-xs text-gray-500 text-center py-6">Chưa có điểm trú phù hợp bộ lọc.</div>
                      ) : (
                          filteredShelters.map((shelter) => {
                              const isActive = activeShelterId === shelter.shelter_id;
                              return (
                              <div
                                  key={shelter.shelter_id}
                                  id={`shelter-card-${shelter.shelter_id}`}
                                  className={`bg-[#0b0f16]/60 border rounded-2xl p-4 flex flex-col gap-2 transition ${
                                      isActive ? 'border-emerald-400/80 bg-emerald-500/10 shadow-[0_0_30px_rgba(16,185,129,0.25)]' : 'border-white/5 hover:border-emerald-400/40'
                                  }`}
                              >
                                  <div className="flex items-center justify-between gap-3">
                                      <div>
                                          <div className="text-xs font-bold text-white">{shelter.name}</div>
                                          <div className="text-[10px] text-gray-500">{shelter.address || 'Đang cập nhật'} · {shelter.province}</div>
                                      </div>
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${shelter.status === 'Limited' ? 'border-amber-400/40 text-amber-300' : 'border-emerald-400/40 text-emerald-300'}`}>
                                          {shelter.status || 'Available'}
                                      </span>
                                  </div>
                                  <div className="flex items-center gap-3 text-[10px] text-gray-400">
                                      <span className="flex items-center gap-1"><Users size={12}/> {shelter.capacity ? `${shelter.capacity} người` : 'Chưa rõ'}</span>
                                      <span className="flex items-center gap-1"><PhoneCall size={12}/> {shelter.contact || '---'}</span>
                                  </div>
                                  <button
                                      onClick={() => focusShelterOnMap(shelter)}
                                      className="mt-2 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-emerald-400 hover:text-white bg-emerald-500/10 border border-emerald-500/20 rounded-xl py-2 px-3 transition"
                                  >
                                      <MapPin size={12}/> Định vị trên bản đồ
                                  </button>
                              </div>
                          );})
                      )}
                  </div>
              )}
           </div>
        </div>
      ) : (
        <button onClick={() => setIsAIConsoleOpen(true)} className="absolute top-6 z-30 h-12 px-5 rounded-2xl bg-[#05060a]/80 backdrop-blur-md border border-white/10 flex items-center gap-2 shadow-xl hover:border-blue-500/50 transition-all group" style={{ right: 24 }}><ShieldCheck size={18} className="text-blue-400 group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]"/><span className="text-white text-xs font-bold">AI Reports</span></button>
      )}


      {/* RAIN LAYER TOGGLE BUTTON */}
      <button
        onClick={() => setShowRainLayer(!showRainLayer)}
        className={`absolute top-24 right-6 z-30 h-12 px-4 rounded-2xl backdrop-blur-md border flex items-center gap-2 shadow-xl transition-all group ${
          showRainLayer 
            ? 'bg-blue-600/20 border-blue-500/50 hover:bg-blue-600/30' 
            : 'bg-[#05060a]/80 border-white/10 hover:border-blue-500/50'
        }`}
        title={showRainLayer ? 'Tắt hiển thị mưa' : 'Bật hiển thị mưa'}
      >
        <CloudRain 
          size={18} 
          className={showRainLayer ? 'text-blue-400 group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]' : 'text-gray-400 group-hover:text-blue-400'} 
        />
        <span className={`text-xs font-bold ${showRainLayer ? 'text-blue-400' : 'text-white'}`}>
          {showRainLayer ? 'Mưa: BẬT' : 'Mưa: TẮT'}
        </span>
        {showRainLayer && (
          <div className="absolute inset-0 rounded-2xl bg-blue-500/10 animate-pulse"></div>
        )}
      </button>

      <button
        onClick={() => setShowWindyOverlay(!showWindyOverlay)}
        className={`absolute top-40 right-6 z-30 h-12 px-4 rounded-2xl backdrop-blur-md border flex items-center gap-2 shadow-xl transition-all group ${
          showWindyOverlay
            ? 'bg-emerald-600/20 border-emerald-500/50 hover:bg-emerald-600/30'
            : 'bg-[#05060a]/80 border-white/10 hover:border-emerald-500/50'
        }`}
        title={showWindyOverlay ? 'Tắt lớp gió Windy' : 'Bật lớp gió Windy'}
      >
        <Wind size={18} className={showWindyOverlay ? 'text-emerald-300' : 'text-gray-400 group-hover:text-emerald-300'} />
        <span className={`text-xs font-bold ${showWindyOverlay ? 'text-emerald-300' : 'text-white'}`}>
          {showWindyOverlay ? 'Windy: BẬT' : 'Windy: TẮT'}
        </span>
        {showWindyOverlay && (
          <div className="absolute inset-0 rounded-2xl bg-emerald-500/10 animate-pulse"></div>
        )}
      </button>

      {/* RAIN LAYER INFO */}
      {showRainLayer && rainLayerTime && (
        <div className="absolute bottom-6 right-6 z-30 px-3 py-2 rounded-xl bg-[#05060a]/90 backdrop-blur-md border border-blue-500/30 text-xs text-blue-300">
          <div className="flex items-center gap-2">
            <CloudRain size={14} />
            <span>Radar mưa (Windy): {new Date(rainLayerTime * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      )}

      {/* POPUP MODAL */}
      {selectedAlert && (
          (() => {
              const styles = getAlertStyles(selectedAlert.level);
              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className={`w-full max-w-md glass-card rounded-3xl p-6 relative border ${styles.border} ${styles.shadow}`}>
                        <button onClick={() => setSelectedAlert(null)} className="absolute top-4 right-4 text-gray-400 hover:text-white transition"><X size={20}/></button>
                        <div className="flex items-center gap-3 mb-6">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${styles.iconBg} ${styles.iconText}`}>{selectedAlert.type.includes('Bão') ? <Tornado size={24} className="animate-spin-slow"/> : selectedAlert.level === 'Nguy hiểm' ? <Siren size={24} className="animate-pulse"/> : selectedAlert.level === 'Cảnh báo' ? <AlertTriangle size={24}/> : <Info size={24}/>}</div>
                            <div><div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${styles.titleText}`}>Cảnh báo khẩn cấp</div><h3 className="text-xl font-bold text-white leading-none">{selectedAlert.location}</h3><span className="text-sm text-gray-400">{selectedAlert.province}</span></div>
                        </div>
                        <div className="space-y-4">
                            <div className={`p-4 rounded-xl ${styles.barBg}`}><div className="flex justify-between items-center mb-2"><span className="text-xs text-gray-400 uppercase font-semibold">Mức độ rủi ro</span><span className={`font-bold text-sm drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] ${styles.riskText}`}>{selectedAlert.level.toUpperCase()}</span></div><div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden mt-3"><div className={`h-full bg-gradient-to-r ${styles.barFill} ${styles.barWidth} transition-all duration-500`}></div></div></div>
                            {!selectedAlert.isCluster && (<div className="grid grid-cols-2 gap-3"><div className="bg-white/5 rounded-xl p-3 border border-white/5"><div className="text-[10px] text-gray-500 uppercase mb-1">Dữ liệu nguồn</div><div className="text-lg font-bold text-blue-300">{selectedAlert.source || 'GDACS'}</div></div><div className="bg-white/5 rounded-xl p-3 border border-white/5"><div className="text-[10px] text-gray-500 uppercase mb-1">Gió giật</div><div className="text-lg font-bold text-teal-300">{selectedAlert.windSpeed + 'km/h'}</div></div></div>)}
                            <div className={`text-sm text-gray-300 leading-relaxed italic border-l-2 pl-3 ${styles.quoteBorder}`}>"{selectedAlert.description}"</div>
                            <button onClick={() => { if (mapRef.current) { mapRef.current.flyTo({ center: selectedAlert.coords, zoom: 12, speed: 1.5 }); if (markerRef.current) markerRef.current.remove(); const el = document.createElement('div'); el.className = 'neon-marker-container'; el.innerHTML = `<div class="neon-core"></div><div class="neon-pulse"></div>`; markerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(selectedAlert.coords).addTo(mapRef.current); } setSelectedAlert(null); }} className={`w-full py-3 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${styles.btnBg}`}><Maximize2 size={16}/> Xem trên bản đồ</button>
                        </div>
                    </div>
                </div>
              );
          })()
      )}


      {selectedHistoryDetail && (
          (() => {
              const detail = selectedHistoryDetail;
              const rainStats = detail.rainStats;
              const weather = detail.weather;
              const analysis = detail.analysis;
              return (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                      <div className="w-full max-w-xl bg-[#05060a]/95 border border-white/10 rounded-3xl p-6 relative shadow-2xl">
                          <button onClick={closeHistoryDetail} className="absolute top-4 right-4 text-gray-400 hover:text-white transition"><X size={18}/></button>
                          <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
                              <div>
                                  <div className="text-[10px] uppercase text-gray-500 font-bold">Lưu lúc {new Date(detail.created_at).toLocaleString('vi-VN')}</div>
                                  <h3 className="text-xl font-bold text-white leading-tight mt-1">{detail.location.title}</h3>
                                  <div className="text-sm text-gray-400">{detail.location.subtitle || detail.location.province || 'Không rõ'}</div>
                              </div>
                              <div className={`px-3 py-1 rounded-xl text-[11px] font-bold ${detail.risk === 'Nguy hiểm' ? 'bg-red-500/15 text-red-300 border border-red-500/40' : detail.risk === 'Cảnh báo' ? 'bg-orange-500/15 text-orange-300 border border-orange-500/40' : detail.risk === 'Nhẹ' ? 'bg-yellow-500/10 text-yellow-300 border border-yellow-500/30' : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'}`}>
                                  {detail.risk}
                              </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3 mt-4">
                              <div className="bg-white/5 rounded-2xl p-3 border border-white/5">
                                  <div className="text-[10px] text-gray-500 uppercase font-bold mb-1">Nhiệt độ</div>
                                  <div className="text-3xl font-bold text-white">{weather.temp !== undefined ? `${Math.round(weather.temp)}°` : '--'}</div>
                                  <div className="text-[10px] text-gray-400">Feels like {weather.feelsLike !== undefined ? `${Math.round(weather.feelsLike)}°` : '--'}</div>
                              </div>
                              <div className="bg-white/5 rounded-2xl p-3 border border-white/5">
                                  <div className="text-[10px] text-gray-500 uppercase font-bold mb-1">Độ ẩm</div>
                                  <div className="text-3xl font-bold text-blue-300">{weather.humidity !== undefined ? `${weather.humidity}%` : '--'}</div>
                                  <div className="text-[10px] text-gray-400">Áp suất {weather.pressureSea !== undefined ? `${weather.pressureSea} hPa` : '--'}</div>
                              </div>
                              <div className="bg-white/5 rounded-2xl p-3 border border-white/5">
                                  <div className="text-[10px] text-gray-500 uppercase font-bold mb-1 flex items-center gap-1"><Wind size={12}/> Gió trung bình</div>
                                  <div className="text-2xl font-bold text-white">{weather.windSpeed !== undefined ? `${weather.windSpeed.toFixed(1)} km/h` : '--'}</div>
                                  <div className="text-[10px] text-gray-400">Hướng {weather.windDir ?? '--'}° · Giật {weather.windGusts ? `${weather.windGusts.toFixed(1)} km/h` : '--'}</div>
                              </div>
                              <div className="bg-white/5 rounded-2xl p-3 border border-white/5">
                                  <div className="text-[10px] text-gray-500 uppercase font-bold mb-1"><Droplets size={12}/> Độ bão hòa</div>
                                  <div className="text-2xl font-bold text-emerald-300">{analysis.saturation !== undefined ? `${Math.round(analysis.saturation)}%` : '--'}</div>
                                  <div className="text-[10px] text-gray-400">Độ tin cậy {analysis.confidence !== undefined ? `${Math.round(analysis.confidence * 100)}%` : '--'}</div>
                              </div>
                          </div>
                          <div className="mt-4">
                              <div className="text-[10px] text-gray-500 uppercase font-bold mb-2 flex items-center gap-2"><CloudRain size={12}/> Lượng mưa ghi nhận</div>
                              <div className="grid grid-cols-3 gap-2 text-center">
                                  {[{ label: '1h', value: rainStats.h1 }, { label: '3h', value: rainStats.h3 }, { label: '24h', value: rainStats.h24 }, { label: '3 ngày', value: rainStats.d3 }, { label: '7 ngày', value: rainStats.d7 }, { label: '14 ngày', value: rainStats.d14 }].map((rs, idx) => (
                                      <div key={idx} className="bg-[#0b0f16]/70 border border-white/5 rounded-xl p-2">
                                          <div className="text-[9px] text-gray-500 uppercase font-bold">{rs.label}</div>
                                          <div className="text-lg font-bold text-white">{rs.value !== undefined ? rs.value.toFixed(1) : '--'}<span className="text-[10px] text-gray-500 ml-1">mm</span></div>
                                      </div>
                                  ))}
                              </div>
                          </div>
                          {detail.reasons.length > 0 && (
                              <div className="mt-4">
                                  <div className="text-[10px] text-gray-500 uppercase font-bold mb-2">Nguyên nhân chính</div>
                                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                                      {detail.reasons.map((reason, idx) => (
                                          <div key={`${reason.code}-${idx}`} className="bg-white/5 border border-white/5 rounded-xl p-2 text-sm text-gray-300">
                                              <div className="font-semibold text-white">{reason.description || reason.code}</div>
                                              <div className="text-[10px] text-gray-500 mt-0.5 uppercase flex justify-between">
                                                  <span>{reason.source}</span>
                                                  <span className="text-emerald-300 font-bold">+{reason.score?.toFixed(1) || '0'}</span>
                                              </div>
                                          </div>
                                      ))}
                                  </div>
                              </div>
                          )}
                          {analysis.actions && (
                              <div className="mt-4 bg-amber-500/10 border border-amber-500/20 text-amber-100 text-sm rounded-2xl p-3">
                                  <div className="text-[10px] uppercase font-bold mb-1">Khuyến nghị</div>
                                  <p>{analysis.actions}</p>
                              </div>
                          )}
                          <div className="mt-5 flex items-center justify-between gap-3">
                              <button
                                  onClick={() => focusHistoryLocation(detail)}
                                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 transition"
                              >
                                  <MapPin size={14}/> Định vị trên bản đồ
                              </button>
                              <button
                                  onClick={closeHistoryDetail}
                                  className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-white/10 hover:bg-white/20 border border-white/20 transition"
                              >
                                  Đóng
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