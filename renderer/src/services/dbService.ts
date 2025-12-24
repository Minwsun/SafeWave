// Database Service for SafeWave
// Wrapper around Electron IPC calls

interface Location {
  latitude: number;
  longitude: number;
  title: string;
  subtitle?: string;
  province?: string;
  elevation?: number;
}

interface WeatherData {
  temp: number;
  feelsLike: number;
  tempMin: number;
  tempMax: number;
  humidity: number;
  pressureSea: number;
  pressureGround: number;
  windSpeed: number;
  windDir: number;
  windGusts: number;
  cloudCover: number;
  uvIndex: number;
  soilMoisture?: number;
}

interface RainStats {
  h1: number;
  h2: number;
  h3: number;
  h5: number;
  h12: number;
  h24: number;
  d3: number;
  d7: number;
  d14: number;
}

interface RiskAnalysis {
  level: number;
  label: string;
  score?: number;
  confidence?: number;
  actions?: string;
  terrainType?: string;
  soilType?: string;
  saturation?: number;
}

interface RiskReason {
  code: string;
  score: number;
  description: string;
  source: string;
}

interface AlertData {
  externalId?: string;
  locationName: string;
  province?: string;
  level: string;
  type: string;
  latitude: number;
  longitude: number;
  rainAmount?: number;
  windSpeed?: number;
  description?: string;
  source?: string;
  isCluster?: boolean;
  clusterCount?: number;
  expiresAt?: string;
}

interface HistoryItem {
  id: number;
  location: string;
  risk: string;
  type: string;
  created_at: string;
  is_favorite?: number;
}

export interface ProvinceRainSample {
  province: string;
  h1: number;
  h3: number;
  h24: number;
  d3: number;
  d7: number;
  d14: number;
  recorded_at: string;
}

export interface ShelterItem {
  shelter_id: number;
  name: string;
  province: string;
  address?: string;
  latitude: number;
  longitude: number;
  capacity?: number;
  contact?: string;
  status?: string;
}

export interface HistoricRainRecord {
  province: string;
  h24: number;
  recorded_at: string;
  source?: string;
  location_note?: string;
}

export interface HistoryDetail {
  id: number;
  risk: string;
  type: string;
  created_at: string;
  location: {
    title: string;
    subtitle?: string;
    province?: string;
    latitude?: number;
    longitude?: number;
    elevation?: number;
  };
  analysis: {
    level: number;
    label: string;
    score?: number;
    confidence?: number;
    actions?: string;
    terrainType?: string;
    soilType?: string;
    saturation?: number;
  };
  weather: {
    temp?: number;
    feelsLike?: number;
    tempMin?: number;
    tempMax?: number;
    humidity?: number;
    pressureSea?: number;
    pressureGround?: number;
    windSpeed?: number;
    windDir?: number;
    windGusts?: number;
    cloudCover?: number;
    uvIndex?: number;
    soilMoisture?: number;
  };
  rainStats: {
    h1?: number;
    h2?: number;
    h3?: number;
    h5?: number;
    h12?: number;
    h24?: number;
    d3?: number;
    d7?: number;
    d14?: number;
  };
  reasons: Array<{ code: string; score: number; description: string; source: string }>;
}

declare global {
  interface Window {
    safewave?: {
      db?: {
        saveAnalysis: (data: {
          location: Location;
          weatherData: WeatherData;
          rainStats: RainStats;
          analysis: RiskAnalysis;
          reasons?: RiskReason[];
        }) => Promise<{ success: boolean; data?: any; error?: string }>;
        getHistory: (limit?: number) => Promise<{ success: boolean; data?: HistoryItem[]; error?: string }>;
        saveAlert: (alert: AlertData) => Promise<{ success: boolean; error?: string }>;
        getAlerts: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
        clearExpiredAlerts: () => Promise<{ success: boolean; error?: string }>;
        toggleFavorite: (historyId: number) => Promise<{ success: boolean; isFavorite?: boolean; error?: string }>;
        deleteHistory: (historyId: number) => Promise<{ success: boolean; error?: string }>;
        getHistoryDetail: (historyId: number) => Promise<{ success: boolean; data?: any; error?: string }>;
        getProvinceList: () => Promise<{ success: boolean; data?: Array<{ province: string }>; error?: string }>;
        getProvinceRainHistory: (province: string, limit?: number) => Promise<{ success: boolean; data?: ProvinceRainSample[]; error?: string }>;
        getShelters: () => Promise<{ success: boolean; data?: ShelterItem[]; error?: string }>;
        getHistoricProvinceRecords: (province: string) => Promise<{ success: boolean; data?: HistoricRainRecord[]; error?: string }>;
      };
      fetchGdacs?: () => Promise<any>; // Thêm dòng này
    };
  }
}

const getDbApi = () => window.safewave?.db;
let hasWarnedUnavailable = false;
const ensureDbAvailable = (): boolean => {
  if (typeof window === 'undefined' || !getDbApi()) {
    if (!hasWarnedUnavailable && import.meta.env.MODE !== 'production') {
      console.warn('Database API not available');
      hasWarnedUnavailable = true;
    }
    return false;
  }
  return true;
};

class DatabaseService {
  async saveAnalysis(
    location: Location,
    weatherData: WeatherData,
    rainStats: RainStats,
    analysis: RiskAnalysis,
    reasons?: RiskReason[]
  ) {
    if (!ensureDbAvailable()) {
      return { success: false, error: 'Database not available' };
    }

    try {
      const result = await getDbApi()!.saveAnalysis({
        location,
        weatherData,
        rainStats,
        analysis,
        reasons,
      });
      return result;
    } catch (error) {
      console.error('Error saving analysis:', error);
      return { success: false, error: String(error) };
    }
  }

  async getHistory(limit: number = 100): Promise<HistoryItem[]> {
    if (!ensureDbAvailable()) {
      return [];
    }

    try {
      const result = await getDbApi()!.getHistory(limit);
      if (result.success && result.data) {
        // Transform database format to UI format
        return result.data.map((item: any) => ({
          id: item.id,
          location: item.location || 'Unknown',
          risk: item.risk,
          type: item.type,
          created_at: item.created_at,
          is_favorite: item.is_favorite ?? 0,
        }));
      }
      return [];
    } catch (error) {
      console.error('Error getting history:', error);
      return [];
    }
  }

  async saveAlert(alert: AlertData) {
    if (!ensureDbAvailable()) {
      return { success: false, error: 'Database not available' };
    }

    try {
      return await getDbApi()!.saveAlert(alert);
    } catch (error) {
      console.error('Error saving alert:', error);
      return { success: false, error: String(error) };
    }
  }

  async getAlerts() {
    if (!ensureDbAvailable()) {
      return [];
    }

    try {
      const result = await getDbApi()!.getAlerts();
      if (result.success && result.data) {
        return result.data;
      }
      return [];
    } catch (error) {
      console.error('Error getting alerts:', error);
      return [];
    }
  }

  async clearExpiredAlerts() {
    if (!ensureDbAvailable()) {
      return { success: false, error: 'Database not available' };
    }

    try {
      return await getDbApi()!.clearExpiredAlerts();
    } catch (error) {
      console.error('Error clearing alerts:', error);
      return { success: false, error: String(error) };
    }
  }

  async toggleFavorite(historyId: number) {
    if (!ensureDbAvailable()) {
      return { success: false, error: 'Database not available' };
    }

    try {
      return await getDbApi()!.toggleFavorite(historyId);
    } catch (error) {
      console.error('Error toggling favorite:', error);
      return { success: false, error: String(error) };
    }
  }

  async deleteHistory(historyId: number) {
    if (!ensureDbAvailable()) {
      return { success: false, error: 'Database not available' };
    }

    try {
      return await getDbApi()!.deleteHistory(historyId);
    } catch (error) {
      console.error('Error deleting history:', error);
      return { success: false, error: String(error) };
    }
  }

  async getProvinceList(): Promise<string[]> {
    if (!ensureDbAvailable()) {
      return [];
    }
    try {
      const result = await getDbApi()!.getProvinceList();
      if (result.success && result.data) {
        return result.data.map((item: { province: string }) => item.province);
      }
      return [];
    } catch (error) {
      console.error('Error getting province list:', error);
      return [];
    }
  }

  async getProvinceRainHistory(province: string, limit = 30): Promise<ProvinceRainSample[]> {
    if (!ensureDbAvailable()) {
      return [];
    }
    try {
      const result = await getDbApi()!.getProvinceRainHistory(province, limit);
      if (result.success && result.data) {
        return result.data;
      }
      return [];
    } catch (error) {
      console.error('Error getting province rain history:', error);
      return [];
    }
  }

  async getShelters(): Promise<ShelterItem[]> {
    if (!ensureDbAvailable()) {
      return [];
    }
    try {
      const result = await getDbApi()!.getShelters();
      if (result.success && result.data) {
        return result.data;
      }
      return [];
    } catch (error) {
      console.error('Error getting shelters:', error);
      return [];
    }
  }

  async getHistoricProvinceRecords(province: string): Promise<HistoricRainRecord[]> {
    if (!ensureDbAvailable()) {
      return [];
    }
    try {
      const result = await getDbApi()!.getHistoricProvinceRecords(province);
      if (result.success && result.data) {
        return result.data;
      }
      return [];
    } catch (error) {
      console.error('Error getting historic rain records:', error);
      return [];
    }
  }

  async getHistoryDetail(historyId: number): Promise<HistoryDetail | null> {
    if (!ensureDbAvailable()) {
      return null;
    }
    try {
      const result = await getDbApi()!.getHistoryDetail(historyId);
      if (!result.success || !result.data) {
        return null;
      }
      const raw = result.data;
      return {
        id: raw.id,
        risk: raw.risk,
        type: raw.type,
        created_at: raw.created_at,
        location: {
          title: raw.location_title || 'Unknown location',
          subtitle: raw.location_subtitle || undefined,
          province: raw.location_province || undefined,
          latitude: raw.location_latitude ?? undefined,
          longitude: raw.location_longitude ?? undefined,
          elevation: raw.location_elevation ?? undefined,
        },
        analysis: {
          level: raw.analysis_level ?? 0,
          label: raw.analysis_label || raw.risk || 'N/A',
          score: raw.analysis_score ?? undefined,
          confidence: raw.analysis_confidence ?? undefined,
          actions: raw.analysis_actions ?? undefined,
          terrainType: raw.analysis_terrain ?? undefined,
          soilType: raw.analysis_soil ?? undefined,
          saturation: raw.analysis_saturation ?? undefined,
        },
        weather: {
          temp: raw.weather_temp ?? undefined,
          feelsLike: raw.weather_feels_like ?? undefined,
          tempMin: raw.weather_temp_min ?? undefined,
          tempMax: raw.weather_temp_max ?? undefined,
          humidity: raw.weather_humidity ?? undefined,
          pressureSea: raw.weather_pressure_sea ?? undefined,
          pressureGround: raw.weather_pressure_ground ?? undefined,
          windSpeed: raw.weather_wind_speed ?? undefined,
          windDir: raw.weather_wind_dir ?? undefined,
          windGusts: raw.weather_wind_gusts ?? undefined,
          cloudCover: raw.weather_cloud_cover ?? undefined,
          uvIndex: raw.weather_uv_index ?? undefined,
          soilMoisture: raw.weather_soil_moisture ?? undefined,
        },
        rainStats: {
          h1: raw.rain_h1 ?? undefined,
          h2: raw.rain_h2 ?? undefined,
          h3: raw.rain_h3 ?? undefined,
          h5: raw.rain_h5 ?? undefined,
          h12: raw.rain_h12 ?? undefined,
          h24: raw.rain_h24 ?? undefined,
          d3: raw.rain_d3 ?? undefined,
          d7: raw.rain_d7 ?? undefined,
          d14: raw.rain_d14 ?? undefined,
        },
        reasons: Array.isArray(raw.reasons) ? raw.reasons : [],
      };
    } catch (error) {
      console.error('Error getting history detail:', error);
      return null;
    }
  }
}

export const dbService = new DatabaseService();

