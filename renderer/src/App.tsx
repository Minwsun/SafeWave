import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type ExpressionSpecification, type LayerSpecification, type Map as MapLibreInstance, type StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Activity,
  ArrowUp,
  Bot,
  CheckCircle2,
  Clock,
  Droplets,
  Eye,
  EyeOff,
  Gauge,
  Layers,
  LineChart,
  Map as MapIcon,
  Mountain,
  Menu,
  MoveRight,
  Navigation,
  ShieldAlert,
  ShieldCheck,
  Target,
  Thermometer,
  ThermometerSnowflake,
  ThermometerSun,
  Tornado,
  TrendingUp,
  Waves,
  Wind,
  X
} from 'lucide-react';

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'ALERT';

interface ChartConfig {
  title: string;
  unit: string;
  data: number[];
  thresholds: number[];
}
interface Assessment {
  id: number;
  location: string;
  level: RiskLevel;
  desc: string;
  time: string;
  coords: [number, number];
}

interface LayerVisibility {
  storm: boolean;
  stormDir: boolean;
  wind: boolean;
  heat: boolean;
  cold: boolean;
  river: boolean;
  flow: boolean;
  waterLevel: boolean;
  tides: boolean;
  surge: boolean;
  elevation: boolean;
}

interface RiskZone {
  id: string;
  name: string;
  level: RiskLevel;
  description: string;
  coordinates: [number, number][][];
}

const VIETNAM_PROVINCES_URL = 'https://raw.githubusercontent.com/ao-do/vietnam-geojson/master/vietnam.geojson';
const RIVERS_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson';

const MAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap Contributors'
    },
    'terrain-source': {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      minzoom: 1
    }
  },
  layers: [
    {
      id: 'osm-layer',
      type: 'raster',
      source: 'osm',
      paint: { 'raster-opacity': 1 }
    }
  ],
  fog: {
    range: [0.5, 10],
    color: '#0B0C10',
    'horizon-blend': 0.1
  }
} as StyleSpecification;

const getRiskColor = (level: RiskLevel) => {
  switch (level) {
    case 'LOW':
      return '#10B981';
    case 'MEDIUM':
      return '#F59E0B';
    case 'HIGH':
      return '#EF4444';
    case 'ALERT':
      return '#7F1D1D';
    default:
      return '#3B82F6';
  }
};

const PROVINCE_COORDS: Record<string, { lat: number; lon: number }> = {
  'Ha Noi': { lat: 21.0278, lon: 105.8342 },
  'Da Nang': { lat: 16.0544, lon: 108.2022 },
  'Quang Nam': { lat: 15.5394, lon: 108.0191 },
  'Thua Thien - Hue': { lat: 16.4674, lon: 107.5905 },
  'Ho Chi Minh': { lat: 10.8231, lon: 106.6297 },
  'Hai Phong': { lat: 20.8449, lon: 106.6881 },
  'Can Tho': { lat: 10.0452, lon: 105.7469 },
  'Khanh Hoa': { lat: 12.2388, lon: 109.1967 }
};

type ProvinceRiskMap = Record<string, RiskLevel>;

const deriveRiskFromPrecip = (value: number): RiskLevel => {
  if (value >= 20) return 'ALERT';
  if (value >= 10) return 'HIGH';
  if (value >= 3) return 'MEDIUM';
  return 'LOW';
};

const buildProvinceExpression = (riskMap: ProvinceRiskMap): ExpressionSpecification => {
  const provinceStops: (string | number | ExpressionSpecification)[] = [];
  Object.entries(riskMap).forEach(([provinceName, risk]) => {
    provinceStops.push(provinceName, getRiskColor(risk));
  });

  return ([
    'match',
    ['get', 'Name'],
    ...provinceStops,
    'rgba(59, 130, 246, 0.1)'
  ] as unknown) as ExpressionSpecification;
};

const MOCK_CHARTS: Record<string, ChartConfig> = {
  WIND: { title: 'Tốc độ gió (24h qua)', unit: 'km/h', data: [10, 12, 11, 13, 15, 18, 16, 25, 35, 42], thresholds: [15, 25, 40] },
  TEMP: { title: 'Nhiệt độ (24h qua)', unit: '°C', data: [24, 25, 26, 28, 32, 36, 38, 36, 32, 28], thresholds: [30, 35, 38] },
  PRESSURE: { title: 'Áp suất khí quyển', unit: 'hPa', data: [1002, 1000, 998, 996, 995, 990, 985, 990, 995, 1000], thresholds: [995, 990, 985] },
  HOT_AIR: { title: 'Cường độ Khí nóng', unit: '%', data: [20, 30, 35, 45, 55, 65, 75, 85, 90, 95], thresholds: [40, 60, 80] },
  COLD_AIR: { title: 'Cường độ Khí lạnh', unit: '%', data: [5, 5, 10, 15, 20, 25, 30, 35, 40, 45], thresholds: [20, 30, 40] },
  RIVER: { title: 'Lưu lượng dòng chảy sông', unit: 'm³/s', data: [120, 125, 130, 140, 155, 170, 190, 210, 230, 250], thresholds: [150, 200, 240] },
  FLOW: { title: 'Tốc độ dòng chảy biển', unit: 'm/s', data: [0.8, 0.9, 1.0, 1.2, 1.5, 1.8, 2.0, 2.2, 2.5, 2.8], thresholds: [1.5, 2.0, 2.5] },
  SURGE: { title: 'Nước dâng do bão', unit: 'm', data: [0.2, 0.3, 0.5, 0.8, 1.2, 1.5, 1.8, 2.2, 2.5, 3.0], thresholds: [1.0, 2.0, 2.8] },
  TIDE: { title: 'Biên độ triều cường', unit: 'm', data: [1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.3, 2.0, 1.8], thresholds: [1.8, 2.2, 2.5] },
  SEALEVEL: { title: 'Mực nước biển trung bình', unit: 'cm', data: [14, 14.5, 15, 15.5, 16, 16.5, 17, 18, 19, 20], thresholds: [16, 18, 19.5] }
};

type MetricKey = keyof typeof MOCK_CHARTS;

const BASE_RISK_ZONES: RiskZone[] = [
  {
    id: 'central-vn',
    name: 'Quảng Nam - Đà Nẵng',
    level: 'HIGH',
    description: 'Địa hình trung du ven biển, nguy cơ ngập và sạt lở do bão.',
    coordinates: [
      [
        [107.8, 15.0],
        [108.8, 15.0],
        [108.8, 16.3],
        [107.8, 16.3],
        [107.8, 15.0]
      ]
    ]
  },
  {
    id: 'north-vn',
    name: 'Tây Bắc',
    level: 'MEDIUM',
    description: 'Địa hình núi cao, nguy cơ lũ quét và sạt lở theo sườn.',
    coordinates: [
      [
        [103.0, 20.0],
        [104.5, 20.0],
        [104.5, 22.0],
        [103.0, 22.0],
        [103.0, 20.0]
      ]
    ]
  },
  {
    id: 'mekong',
    name: 'Đồng bằng sông Cửu Long',
    level: 'LOW',
    description: 'Địa hình bằng phẳng, theo dõi xâm nhập mặn và triều cường.',
    coordinates: [
      [
        [105.0, 9.5],
        [106.4, 9.5],
        [106.4, 10.8],
        [105.0, 10.8],
        [105.0, 9.5]
      ]
    ]
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
  features: zones.map(
    (zone): Feature<Polygon> => ({
      type: 'Feature',
      properties: {
        name: zone.name,
        level: zone.level,
        color: getRiskColor(zone.level),
        description: zone.description
      },
      geometry: {
        type: 'Polygon',
        coordinates: zone.coordinates
      }
    })
  )
});

const DASHBOARD_WIDTH = 380;
const DASHBOARD_OFFSET = 12;
const DASHBOARD_GAP = 5;
const COLLAPSED_CARD_LEFT = 80;
const TRACKING_CARD_SHIFT = 10;
const AI_PANEL_WIDTH = 360;
const AI_TOGGLE_WIDTH = 120;
const SCREEN_MARGIN = 24;
const PANEL_GAP = 16;

const SafeWaveApp = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreInstance | null>(null);
  const provinceRiskRef = useRef<ProvinceRiskMap>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const [inputLocation, setInputLocation] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(true);
  const [isLayerManagerOpen, setIsLayerManagerOpen] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);
  const [isAIConsoleOpen, setIsAIConsoleOpen] = useState(true);
  const [riskZones, setRiskZones] = useState<RiskZone[]>(BASE_RISK_ZONES);
  const [provinceRisk, setProvinceRisk] = useState<ProvinceRiskMap>({});

  const [layers, setLayers] = useState<LayerVisibility>({
    storm: true,
    stormDir: true,
    wind: false,
    heat: false,
    cold: false,
    river: false,
    flow: false,
    waterLevel: false,
    tides: false,
    surge: false,
    elevation: true
  });

  const [dashboardInfo, setDashboardInfo] = useState({
    location: 'Vietnam',
    coordinates: '-',
    status: 'Monitoring'
  });

  const [activeStorm] = useState({
    name: 'BÃO SỐ 4 (NORU)',
    speed: '145 km/h',
    direction: 'Tây Tây Bắc',
    level: 'Cấp 13 (Giật cấp 16)',
    coords: [111.5, 16.2] as [number, number],
    radius: 150
  });

  const [assessments, setAssessments] = useState<Assessment[]>([
    {
      id: 1,
      location: 'Quần đảo Hoàng Sa',
      level: 'ALERT',
      desc: 'Tâm bão đi qua, sóng biển cao 8-10m. Rủi ro cực đại.',
      time: '11:00',
      coords: [111.5, 16.2]
    },
    {
      id: 2,
      location: 'Đà Nẵng',
      level: 'HIGH',
      desc: 'Ảnh hưởng hoàn lưu bão, mưa lớn diện rộng.',
      time: '10:35',
      coords: [108.2, 16.05]
    }
  ]);

  const riskGeoJson = useMemo(() => buildRiskGeoJson(riskZones), [riskZones]);
  const trackingCardLeft =
    (isDashboardOpen
      ? DASHBOARD_OFFSET + DASHBOARD_WIDTH + DASHBOARD_GAP
      : COLLAPSED_CARD_LEFT) + TRACKING_CARD_SHIFT;
  const layerRightOffset =
    SCREEN_MARGIN +
    (isAIConsoleOpen
      ? AI_PANEL_WIDTH + PANEL_GAP
      : AI_TOGGLE_WIDTH + PANEL_GAP);
  useEffect(() => {
    let cancelled = false;

    const fetchProvinceRisk = async () => {
      try {
        const entries = await Promise.all(
          Object.entries(PROVINCE_COORDS).map(async ([name, coords]) => {
            try {
              const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&hourly=precipitation`;
              const response = await fetch(url);
              const data = await response.json();
              const precipitation: number[] = data?.hourly?.precipitation ?? [];
              const maxPrecip = precipitation.reduce((acc: number, value: number) => Math.max(acc, value ?? 0), 0);
              return [name, deriveRiskFromPrecip(maxPrecip)] as const;
            } catch {
              return [name, 'LOW' as RiskLevel] as const;
            }
          })
        );

        if (!cancelled) {
          const riskMap = Object.fromEntries(entries) as ProvinceRiskMap;
          provinceRiskRef.current = riskMap;
          setProvinceRisk(riskMap);
        }
      } catch (error) {
        console.error('Failed to fetch province risks', error);
      }
    };

    fetchProvinceRisk();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const initialRiskGeoJson = buildRiskGeoJson(BASE_RISK_ZONES);

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [108.2, 16.0],
      zoom: 6,
      pitch: 60,
      bearing: -10,
      maxPitch: 85,
      hash: false,
      attributionControl: false
    });

    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 140, unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      map.addSource('terrain', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256
      });
      map.setTerrain({ source: 'terrain', exaggeration: 2.5 });

      map.addLayer({
        id: 'sky',
        type: 'sky',
        paint: {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0.0, 90.0],
          'sky-atmosphere-sun-intensity': 15
        }
      } as unknown as LayerSpecification);

      map.addSource('vietnam-provinces', {
        type: 'geojson',
        data: VIETNAM_PROVINCES_URL
      });

      map.addLayer({
        id: 'provinces-fill',
        type: 'fill',
        source: 'vietnam-provinces',
        paint: {
          'fill-color': buildProvinceExpression(provinceRiskRef.current),
          'fill-opacity': 0.6,
          'fill-outline-color': '#ffffff'
        }
      });

      map.addLayer({
        id: 'provinces-outline',
        type: 'line',
        source: 'vietnam-provinces',
        paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.5 }
      });

      map.addSource('rivers', {
        type: 'geojson',
        data: RIVERS_URL
      });

      map.addLayer({
        id: 'river-lines',
        type: 'line',
        source: 'rivers',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          visibility: 'none'
        },
        paint: {
          'line-color': '#06B6D4',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 10, 3, 15, 8],
          'line-opacity': 0.8
        }
      });

      map.addSource('risk-polygons', {
        type: 'geojson',
        data: initialRiskGeoJson
      });

      map.addLayer({
        id: 'risk-polygons-fill',
        type: 'fill',
        source: 'risk-polygons',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.35,
          'fill-outline-color': '#ffffff'
        }
      });

      map.addLayer({
        id: 'risk-polygons-outline',
        type: 'line',
        source: 'risk-polygons',
        paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.4 }
      });

      map.addSource('storm-eye', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: activeStorm.coords }
            }
          ]
        }
      });

      map.addLayer({
        id: 'storm-eye-circle',
        type: 'circle',
        source: 'storm-eye',
        paint: {
          'circle-radius': 50,
          'circle-color': '#EF4444',
          'circle-opacity': 0.6,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff'
        }
      });

      map.addSource('storm-path', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [activeStorm.coords, [107.5, 17.5], [105.0, 19.0]]
          }
        }
      });

      map.addLayer({
        id: 'storm-path-line',
        type: 'line',
        source: 'storm-path',
        paint: { 'line-color': '#FCA5A5', 'line-width': 4, 'line-dasharray': [2, 1] }
      });

      const windFeatures = Array.from({ length: 30 }, () => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates: [105 + Math.random() * 10, 14 + Math.random() * 10] }
      }));

      map.addSource('wind-data', { type: 'geojson', data: { type: 'FeatureCollection', features: windFeatures } });
      map.addLayer({
        id: 'wind-arrows',
        type: 'circle',
        source: 'wind-data',
        paint: { 'circle-radius': 3, 'circle-color': '#06B6D4' },
        layout: { visibility: 'none' }
      });

      map.addSource('temp-data', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { type: 'heat' },
              geometry: { type: 'Polygon', coordinates: [[[100, 10], [105, 10], [105, 15], [100, 15], [100, 10]]] }
            },
            {
              type: 'Feature',
              properties: { type: 'cold' },
              geometry: { type: 'Polygon', coordinates: [[[110, 20], [115, 20], [115, 25], [110, 25], [110, 20]]] }
            }
          ]
        }
      });

      map.addLayer({
        id: 'heat-poly',
        type: 'fill',
        source: 'temp-data',
        filter: ['==', 'type', 'heat'],
        paint: { 'fill-color': '#F97316', 'fill-opacity': 0.3 },
        layout: { visibility: 'none' }
      });

      map.addLayer({
        id: 'cold-poly',
        type: 'fill',
        source: 'temp-data',
        filter: ['==', 'type', 'cold'],
        paint: { 'fill-color': '#3B82F6', 'fill-opacity': 0.3 },
        layout: { visibility: 'none' }
      });

      const flowFeatures = Array.from({ length: 20 }, () => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates: [108 + Math.random() * 5, 15 + Math.random() * 8] }
      }));

      map.addSource('flow-data', { type: 'geojson', data: { type: 'FeatureCollection', features: flowFeatures } });
      map.addLayer({
        id: 'flow-arrows',
        type: 'circle',
        source: 'flow-data',
        paint: { 'circle-radius': 2, 'circle-color': '#ffffff' },
        layout: { visibility: 'none' }
      });

      map.addSource('water-data', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[[105, 10], [115, 10], [115, 22], [105, 22], [105, 10]]]
          }
        }
      });

      map.addLayer({
        id: 'water-level-fill',
        type: 'fill',
        source: 'water-data',
        paint: { 'fill-color': '#3B82F6', 'fill-opacity': 0.25 },
        layout: { visibility: 'none' }
      });

      map.on('click', (e) => {
        const { lng, lat } = e.lngLat;
        const coordsText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        setInputLocation(coordsText);
        setDashboardInfo({ location: 'Vị trí đã chọn', coordinates: coordsText, status: 'Selected Region' });
      });

      map.on('click', 'provinces-fill', (e) => {
        if (!e.features || e.features.length === 0) return;
        const feature = e.features[0];
        const name = (feature.properties?.Name as string) || 'Unknown';
        const risk = provinceRiskRef.current[name] || 'LOW';

        setDashboardInfo({
          location: name,
          coordinates: `${e.lngLat.lat.toFixed(4)}, ${e.lngLat.lng.toFixed(4)}`,
          status: `Risk Level: ${risk}`
        });

        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(`<div style="color:#0f172a"><strong>${name}</strong><br/>Risk: ${risk}</div>`)
          .addTo(map);
      });

      map.on('mouseenter', 'provinces-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', 'provinces-fill', () => {
        map.getCanvas().style.cursor = '';
      });

      setIsLoaded(true);
    });

    return () => {
      map.remove();
    };
  }, [activeStorm]);

  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;
    const source = map.getSource('risk-polygons') as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(riskGeoJson as GeoJSON.GeoJSON);
    }
  }, [riskGeoJson, isLoaded]);

  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;
    if (map.getLayer('provinces-fill')) {
      map.setPaintProperty('provinces-fill', 'fill-color', buildProvinceExpression(provinceRisk));
    }
  }, [provinceRisk, isLoaded]);

  useEffect(() => {
    provinceRiskRef.current = provinceRisk;
  }, [provinceRisk]);

  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;
    const toggle = (id: string, visible: boolean) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    };

    if (layers.elevation) {
      map.setTerrain({ source: 'terrain', exaggeration: 2.5 });
    } else {
      map.setTerrain(null);
    }

    toggle('storm-eye-circle', layers.storm);
    toggle('storm-path-line', layers.stormDir);
    toggle('wind-arrows', layers.wind);
    toggle('river-lines', layers.river);
    toggle('flow-arrows', layers.flow);
    toggle('heat-poly', layers.heat);
    toggle('cold-poly', layers.cold);

    const waterLayerVisible = layers.waterLevel || layers.surge || layers.tides;
    if (map.getLayer('water-level-fill')) {
      map.setLayoutProperty('water-level-fill', 'visibility', waterLayerVisible ? 'visible' : 'none');
      if (layers.surge) {
        map.setPaintProperty('water-level-fill', 'fill-color', '#EF4444');
      } else if (layers.tides) {
        map.setPaintProperty('water-level-fill', 'fill-color', '#8B5CF6');
      } else {
        map.setPaintProperty('water-level-fill', 'fill-color', '#3B82F6');
      }
    }
  }, [layers, isLoaded]);

  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const resizeHandle = setTimeout(() => mapRef.current?.resize(), 300);
    return () => clearTimeout(resizeHandle);
  }, [isDashboardOpen, isLoaded]);

  const handleAnalyze = async () => {
    if (!inputLocation) return;
    setAnalyzing(true);
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const nextLevel: RiskLevel = ['LOW', 'MEDIUM', 'HIGH', 'ALERT'][Math.floor(Math.random() * 4)] as RiskLevel;
    const targetZoneIndex = Math.floor(Math.random() * riskZones.length);

    setRiskZones((prev) =>
      prev.map((zone, idx) =>
        idx === targetZoneIndex
          ? { ...zone, level: nextLevel, description: `Gemma đánh giá ${zone.name} đạt mức ${nextLevel}.` }
          : zone
      )
    );

    setDashboardInfo({
      location: inputLocation,
      coordinates: inputLocation,
      status: `Gemma xác nhận mức ${nextLevel}`
    });

    setAssessments((prev) => {
      const next: Assessment[] = [
        {
          id: Date.now(),
          location: inputLocation,
          level: nextLevel,
          desc: `Gemma 3 (27B) xác nhận rủi ro ${nextLevel} dựa trên địa hình, mưa và lịch sử thiên tai.`,
          time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          coords: [108.2, 15.8]
        },
        ...prev
      ];
      return next.slice(0, 6);
    });

    setAnalyzing(false);
  };

  const toggleLayer = (key: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderChartModal = () => {
    if (!selectedMetric) return null;
    const chartConfig = MOCK_CHARTS[selectedMetric];
    const maxVal = Math.max(...chartConfig.data, ...(chartConfig.thresholds || [])) * 1.1;

  return (
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div className="bg-[#1A1C23] border border-gray-700 rounded-2xl shadow-2xl w-full max-w-xl p-6 relative">
          <button
            onClick={() => setSelectedMetric(null)}
            className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
            aria-label="Đóng"
          >
            <X size={20} />
          </button>

          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 rounded-lg bg-gray-900 border border-gray-700">
              <LineChart size={26} className="text-blue-500" />
            </div>
      <div>
              <h3 className="text-lg font-bold text-white">{chartConfig.title}</h3>
              <p className="text-xs text-gray-400">Biểu đồ điểm quan trắc</p>
            </div>
          </div>

          <div className="h-48 w-full border-b border-l border-gray-700 pb-3 pl-2 relative">
            {chartConfig.thresholds.map((threshold, idx) => {
              const bottomPct = (threshold / maxVal) * 100;
              const color = idx === 0 ? '#EAB308' : idx === 1 ? '#F97316' : '#EF4444';
              return (
                <div
                  key={`thresh-${idx}`}
                  className="absolute w-full border-t border-dashed pointer-events-none opacity-50 flex items-center text-[10px]"
                  style={{ bottom: `${bottomPct}%`, borderColor: color }}
                >
                  <span className="absolute right-0 -top-3 font-semibold" style={{ color }}>
                    Mốc {idx + 1}: {threshold} {chartConfig.unit}
                  </span>
                </div>
              );
            })}

            <div className="absolute inset-0 flex items-end justify-between px-2">
              {chartConfig.data.map((value, idx) => {
                const pointColor = getPointColor(value, chartConfig.thresholds);
                return (
                  <div key={idx} className="flex-1 relative h-full group">
                    <div
                      className="absolute left-1/2 -translate-x-1/2 w-px bottom-0 bg-gray-700 group-hover:bg-gray-500 transition-colors"
                      style={{ height: `${(value / maxVal) * 100}%` }}
                    />
                    <div
                      className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full shadow-lg border border-[#1A1C23] group-hover:scale-125 transition-transform cursor-pointer"
                      style={{ bottom: `${(value / maxVal) * 100}%`, backgroundColor: pointColor }}
                    >
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 border border-gray-600 whitespace-nowrap">
                        {value} {chartConfig.unit}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-between mt-2 text-[11px] text-gray-500 font-mono">
            <span>24h trước</span>
            <span>Hiện tại</span>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2 bg-black/30 p-3 rounded-xl text-[10px] text-gray-400">
            <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-blue-500 mr-2" /> Bình thường</div>
            <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-yellow-500 mr-2" /> Tăng nhẹ</div>
            <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-orange-500 mr-2" /> Cao</div>
            <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-red-500 mr-2" /> Rất cao</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="relative h-screen w-full bg-[#05060a] text-slate-200 overflow-hidden font-sans">
      <style>{`
        .storm-pulse { animation: pulse-red 2s infinite; }
        @keyframes pulse-red {
          0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.65); }
          70% { box-shadow: 0 0 0 14px rgba(239,68,68,0); }
          100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
        }
      `}</style>

      {renderChartModal()}

      <div className="relative h-full w-full">
        <div ref={mapContainerRef} className="absolute inset-0 bg-black" />

        <button
          onClick={() => setIsDashboardOpen(!isDashboardOpen)}
          className="absolute top-6 left-6 z-30 bg-[#0b0f16]/80 backdrop-blur border border-white/15 text-white text-xs font-semibold px-4 py-2 rounded-2xl shadow-lg hover:bg-[#121726] flex items-center gap-2"
        >
          <Menu size={14} className="text-blue-400" />
          {isDashboardOpen ? 'Ẩn dashboard' : 'Mở dashboard'}
        </button>

        <div
          className={`absolute top-6 left-12 bottom-6 w-[380px] transition-all duration-300 ${
            isDashboardOpen ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 -translate-x-4 pointer-events-none'
          }`}
        >
          <div className="h-full bg-[#111217]/95 backdrop-blur-xl border border-gray-800/60 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              <div className="bg-[#151823]/80 border border-gray-800 rounded-2xl p-4 space-y-4">
                <div
                  className="relative rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-900/30 via-[#1E2028] to-transparent p-4 overflow-hidden cursor-pointer group"
                  onClick={() => setSelectedMetric('SURGE')}
                >
                  <div className="absolute top-0 right-0 p-2 opacity-20">
                    <Tornado size={64} />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-red-400 font-semibold uppercase tracking-widest">
                    <span className="w-2 h-2 rounded-full bg-red-500 storm-pulse" />
                    Hiện tượng: Bão
                  </div>
                  <h3 className="text-2xl font-bold text-white mt-2">{activeStorm.name}</h3>
                  <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                    <div className="bg-black/40 p-3 rounded-xl border border-white/5 flex items-center justify-between">
                      <span className="text-gray-400">Gió</span>
                      <span className="text-white font-semibold">{activeStorm.speed}</span>
                    </div>
                    <div className="bg-black/40 p-3 rounded-xl border border-white/5 flex items-center justify-between">
                      <span className="text-gray-400">Hướng</span>
                      <span className="text-white font-semibold flex items-center gap-1">
                        <Navigation size={12} className="-rotate-45" />
                        {activeStorm.direction}
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400 italic mt-3">Nhấn để xem chi tiết</p>
                </div>
              </div>

              <section className="space-y-4 bg-[#151823]/80 border border-gray-800 rounded-2xl p-4">
                <header className="text-xs font-semibold text-yellow-500 uppercase flex items-center gap-2 border-b border-gray-800 pb-2">
                  <Wind size={14} />
                  Khí tượng
                </header>

                <div className="bg-[#1E2028]/70 p-4 rounded-2xl border border-gray-800 flex items-center justify-between cursor-pointer hover:bg-white/5 transition" onClick={() => setSelectedMetric('WIND')}>
                  <div>
                    <p className="text-[11px] text-gray-400">Hướng gió chủ đạo</p>
                    <p className="text-xl font-semibold text-white">Đông Bắc</p>
                    <p className="text-[10px] text-cyan-400 mt-1">Tốc độ: 15 km/h</p>
                  </div>
                  <div className="w-16 h-16 rounded-full border border-gray-700 relative flex items-center justify-center bg-black/20">
                    <Navigation size={20} className="text-cyan-400 rotate-45" />
                    <div className="absolute inset-0 border border-cyan-500/30 rounded-full animate-pulse" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[#1E2028]/70 p-3 rounded-2xl border border-gray-800 cursor-pointer hover:bg-white/5 transition" onClick={() => setSelectedMetric('TEMP')}>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                      <Thermometer size={14} className="text-orange-400" />
                      Nhiệt độ
                    </div>
                    <p className="text-xl font-semibold text-white">28°C</p>
                  </div>
                  <div className="bg-[#1E2028]/70 p-3 rounded-2xl border border-gray-800 cursor-pointer hover:bg-white/5 transition" onClick={() => setSelectedMetric('PRESSURE')}>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                      <Gauge size={14} className="text-purple-400" />
                      Áp suất
                    </div>
                    <p className="text-xl font-semibold text-white">996 hPa</p>
                  </div>
                </div>

                <div className="bg-[#1E2028]/70 p-3 rounded-2xl border border-gray-800 space-y-2">
                  <div className="flex justify-between items-center text-xs cursor-pointer hover:bg-white/5 p-2 rounded" onClick={() => setSelectedMetric('HOT_AIR')}>
                    <span className="text-gray-400 flex items-center gap-2">
                      <ThermometerSun size={14} className="text-orange-400" />
                      Không khí nóng
                    </span>
                    <span className="text-white font-semibold">Tây Nam (Yếu)</span>
                  </div>
                  <div className="h-px bg-gray-800" />
                  <div className="flex justify-between items-center text-xs cursor-pointer hover:bg-white/5 p-2 rounded" onClick={() => setSelectedMetric('COLD_AIR')}>
                    <span className="text-gray-400 flex items-center gap-2">
                      <ThermometerSnowflake size={14} className="text-cyan-400" />
                      Không khí lạnh
                    </span>
                    <span className="text-gray-500">Không phát hiện</span>
                  </div>
                </div>
              </section>

              <section className="space-y-4 bg-[#151823]/80 border border-gray-800 rounded-2xl p-4">
                <header className="text-xs font-semibold text-blue-500 uppercase flex items-center gap-2 border-b border-gray-800 pb-2">
                  <Droplets size={14} />
                  Thủy văn
                </header>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-[#1E2028]/70 rounded-xl p-3 border border-gray-800 hover:bg-white/5 cursor-pointer" onClick={() => setSelectedMetric('RIVER')}>
                    <p className="text-[10px] text-gray-400 flex items-center gap-1">
                      <TrendingUp size={10} />
                      Hướng sông
                    </p>
                    <p className="text-white font-semibold mt-1">Đông Nam</p>
                  </div>
                  <div className="bg-[#1E2028]/70 rounded-xl p-3 border border-gray-800 hover:bg-white/5 cursor-pointer" onClick={() => setSelectedMetric('FLOW')}>
                    <p className="text-[10px] text-gray-400 flex items-center gap-1">
                      <Waves size={10} />
                      Dòng chảy
                    </p>
                    <p className="text-white font-semibold mt-1">1.2 m/s</p>
                  </div>
                  <div className="bg-[#1E2028]/70 rounded-xl p-3 border border-gray-800 hover:bg-white/5 cursor-pointer" onClick={() => setSelectedMetric('SURGE')}>
                    <p className="text-[10px] text-gray-400 flex items-center gap-1 text-red-400">
                      <ArrowUp size={10} />
                      Nước dâng
                    </p>
                    <p className="text-red-400 font-semibold mt-1">+0.8m</p>
                  </div>
                  <div className="bg-[#1E2028]/70 rounded-xl p-3 border border-gray-800 hover:bg-white/5 cursor-pointer" onClick={() => setSelectedMetric('TIDE')}>
                    <p className="text-[10px] text-gray-400 flex items-center gap-1 text-purple-400">
                      <Waves size={10} />
                      Triều cường
                    </p>
                    <p className="text-purple-400 font-semibold mt-1">Đỉnh triều</p>
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-800">
                  <div className="flex items-center justify-between text-xs text-gray-400 mb-2 cursor-pointer" onClick={() => setSelectedMetric('SEALEVEL')}>
                    <span>Mực nước biển TB</span>
                    <span className="text-blue-400 font-semibold">+15cm</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-800 rounded-full">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: '65%' }} />
                  </div>
                </div>
              </section>

              <section className="space-y-4 bg-[#151823]/80 border border-gray-800 rounded-2xl p-4">
                <header className="text-xs font-semibold text-green-500 uppercase flex items-center gap-2 border-b border-gray-800 pb-2">
                  <Mountain size={14} />
                  Địa hình
                </header>

                <div className="bg-[#1E2028]/70 p-4 rounded-2xl border border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-green-500/20 p-3 rounded-2xl">
                      <Mountain size={18} className="text-green-400" />
                    </div>
                    <div>
                      <p className="text-[11px] text-gray-400">Độ cao trung bình</p>
                      <p className="text-lg font-semibold text-white">450m</p>
                    </div>
                  </div>
                  <span className="text-[10px] bg-green-900/30 text-green-400 px-3 py-1 rounded-full border border-green-500/30">
                    3D Terrain ON
                  </span>
                </div>
              </section>
            </div>
          </div>
        </div>

        {!isLayerManagerOpen && (
          <button
            onClick={() => setIsLayerManagerOpen(true)}
            className="absolute top-6 z-20 bg-[#1A1C23]/90 backdrop-blur border border-gray-800 rounded-2xl p-3 text-white hover:bg-white/10 transition shadow-2xl"
            style={{ right: layerRightOffset }}
          >
            <Layers size={20} className="text-blue-400" />
          </button>
        )}

        {isLayerManagerOpen && (
          <div
            className="absolute top-6 z-30 w-72 bg-[#111217]/95 backdrop-blur border border-gray-800 rounded-3xl shadow-2xl p-4 max-h-[80vh] overflow-y-auto custom-scrollbar animate-in fade-in duration-300"
            style={{ right: layerRightOffset }}
          >
            <div className="flex items-center justify-between border-b border-gray-800 pb-2 mb-3">
              <h4 className="text-[11px] uppercase tracking-[0.3em] text-gray-500 flex items-center gap-2">
                <Layers size={12} />
                Layers
              </h4>
              <button onClick={() => setIsLayerManagerOpen(false)} className="text-gray-500 hover:text-white">
                <X size={14} />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <p className="text-[10px] font-bold text-red-400 mb-2 uppercase tracking-widest">Thiên tai</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-2 rounded" onClick={() => toggleLayer('storm')}>
                    <span className="flex items-center gap-2">
                      <Tornado size={12} className="text-red-500" />
                      Bão / Áp thấp
                    </span>
                    {layers.storm ? <Eye size={14} className="text-blue-400" /> : <EyeOff size={14} className="text-gray-600" />}
                  </div>
                  <div className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-2 rounded" onClick={() => toggleLayer('stormDir')}>
                    <span className="flex items-center gap-2">
                      <MoveRight size={12} className="text-orange-400" />
                      Hướng di chuyển
                    </span>
                    {layers.stormDir ? <Eye size={14} className="text-blue-400" /> : <EyeOff size={14} className="text-gray-600" />}
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold text-yellow-400 mb-2 uppercase tracking-widest">Khí tượng</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-2 rounded" onClick={() => toggleLayer('wind')}>
                    <span className="flex items-center gap-2">
                      <Wind size={12} />
                      Hướng gió
                    </span>
                    {layers.wind ? <Eye size={14} className="text-blue-400" /> : <EyeOff size={14} className="text-gray-600" />}
                  </div>
                  <div className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-2 rounded" onClick={() => toggleLayer('heat')}>
                    <span className="flex items-center gap-2">
                      <ThermometerSun size={12} className="text-orange-400" />
                      Không khí nóng
                    </span>
                    {layers.heat ? <Eye size={14} className="text-blue-400" /> : <EyeOff size={14} className="text-gray-600" />}
                  </div>
                  <div className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-2 rounded" onClick={() => toggleLayer('cold')}>
                    <span className="flex items-center gap-2">
                      <ThermometerSnowflake size={12} className="text-cyan-400" />
                      Không khí lạnh
                    </span>
                    {layers.cold ? <Eye size={14} className="text-blue-400" /> : <EyeOff size={14} className="text-gray-600" />}
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold text-blue-400 mb-2 uppercase tracking-widest">Thủy văn</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-2 rounded" onClick={() => toggleLayer('river')}>
                    <span className="flex items-center gap-2">
                      <TrendingUp size={12} className="text-blue-300" />
                      Hướng sông
                    </span>
                    {layers.river ? <Eye size={14} className="text-blue-400" /> : <EyeOff size={14} className="text-gray-600" />}
                  </div>
                  <div className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-2 rounded" onClick={() => toggleLayer('flow')}>
                    <span className="flex items-center gap-2">
                      <Waves size={12} className="text-indigo-300" />
                      Dòng chảy biển
                    </span>
                    {layers.flow ? <Eye size={14} className="text-blue-400" /> : <EyeOff size={14} className="text-gray-600" />}
                  </div>
                  <div className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-2 rounded" onClick={() => toggleLayer('surge')}>
                    <span className="flex items-center gap-2">
                      <ArrowUp size={12} className="text-red-400" />
                      Nước dâng bão
                    </span>
                    {layers.surge ? <Eye size={14} className="text-blue-400" /> : <EyeOff size={14} className="text-gray-600" />}
                  </div>
                  <div className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-2 rounded" onClick={() => toggleLayer('tides')}>
                    <span className="flex items-center gap-2">
                      <Waves size={12} className="text-purple-400" />
                      Triều cường
                    </span>
                    {layers.tides ? <Eye size={14} className="text-blue-400" /> : <EyeOff size={14} className="text-gray-600" />}
                  </div>
                  <div className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-2 rounded" onClick={() => toggleLayer('waterLevel')}>
                    <span className="flex items-center gap-2">
                      <Droplets size={12} className="text-sky-400" />
                      Mực nước biển
                    </span>
                    {layers.waterLevel ? <Eye size={14} className="text-blue-400" /> : <EyeOff size={14} className="text-gray-600" />}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {isAIConsoleOpen ? (
          <div
            className="absolute top-6 z-40 w-[360px] transition-all duration-300"
            style={{ right: SCREEN_MARGIN }}
          >
            <div className="bg-[#0b0f16]/80 backdrop-blur-xl border border-white/10 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] overflow-hidden">
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="text-blue-400" size={18} />
                  <div>
                    <h2 className="text-sm font-bold text-white">SafeWave Analyst</h2>
                    <p className="text-[11px] text-gray-500">Gemma 3 · Việt Nam</p>
                  </div>
                </div>
                <button onClick={() => setIsAIConsoleOpen(false)} className="text-gray-500 hover:text-white transition">
                  <X size={16} />
        </button>
              </div>

              <div className="p-4 border-b border-white/5">
                <p className="text-xs text-gray-400 mb-3 leading-relaxed">
                  Nhập vị trí (tỉnh/huyện hoặc tọa độ). SafeWave sẽ gom DEM, lớp phủ, thổ nhưỡng và mưa 1-20 ngày rồi gửi Gemma 3 (27B) xác nhận rủi ro.
                </p>
                <div className="relative mb-3">
                  <input
                    type="text"
                    value={inputLocation}
                    onChange={(e) => setInputLocation(e.target.value)}
                    placeholder="VD: Đà Nẵng hoặc 16.047, 108.206"
                    className="w-full bg-[#080b11]/90 border border-gray-800 rounded-xl py-2.5 pl-3 pr-10 text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                  />
                  <Target className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                </div>
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing || !inputLocation}
                  className="w-full bg-blue-600/90 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-semibold py-2.5 rounded-xl text-sm transition flex items-center justify-center gap-2"
                >
                  {analyzing ? <Activity className="animate-spin" size={16} /> : <ShieldAlert size={16} />}
                  {analyzing ? 'AI đang phân tích...' : 'Đánh giá rủi ro'}
                </button>
              </div>

              <div className="p-4 border-b border-white/5 bg-white/2">
                <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 tracking-[0.3em] flex items-center gap-2">
                  <MapIcon size={12} />
                  Phân vùng Việt Nam
                </h3>
                <div className="space-y-3 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                  {riskZones.map((zone) => (
                    <div key={zone.id} className="bg-[#131824]/80 border border-gray-800 rounded-2xl p-3 shadow-inner">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-white">{zone.name}</p>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase"
                          style={{
                            color: getRiskColor(zone.level),
                            border: `1px solid ${getRiskColor(zone.level)}55`
                          }}
                        >
                          {zone.level}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400">{zone.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 max-h-72 overflow-y-auto custom-scrollbar space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.3em]">Cảnh báo gần nhất</h3>
                  <Clock size={14} className="text-gray-500" />
                </div>
                {assessments.map((item) => (
                  <div key={item.id} className="bg-[#131824] border border-gray-800 rounded-2xl p-3 hover:border-gray-600 transition">
                    <div className="flex justify-between items-start">
                      <h4 className="font-semibold text-sm text-white">{item.location}</h4>
                      <span className="text-[10px] text-gray-500">{item.time}</span>
                    </div>
                    <span
                      className="inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full uppercase mt-2"
                      style={{
                        color: getRiskColor(item.level),
                        backgroundColor: `${getRiskColor(item.level)}22`,
                        border: `1px solid ${getRiskColor(item.level)}44`
                      }}
                    >
                      {item.level} RISK
                    </span>
                    <p className="text-xs text-gray-400 mt-2">{item.desc}</p>
                  </div>
                ))}
              </div>

              <div className="p-4 border-t border-white/5 bg-[#080b11]/60 text-[11px] text-gray-500 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <ShieldCheck size={12} />
                  Gemma Agent ready
                </span>
                <span className="flex items-center gap-1 text-green-400">
                  <CheckCircle2 size={12} />
                  Sync Việt Nam
                </span>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAIConsoleOpen(true)}
            className="absolute top-6 z-30 bg-[#0b0f16]/80 backdrop-blur border border-white/15 text-white text-xs font-semibold px-4 py-2 rounded-2xl shadow-lg hover:bg-[#121726]"
            style={{ right: SCREEN_MARGIN }}
          >
            <span className="inline-flex items-center gap-2">
              <ShieldCheck size={14} className="text-blue-400" />
              Mở bảng AI
            </span>
          </button>
        )}

        <div
          className="absolute top-6 z-20 max-w-sm transition-all duration-300"
          style={{ left: trackingCardLeft }}
        >
          <div className="bg-white/5 backdrop-blur-lg border border-white/30 rounded-2xl p-4 shadow-2xl">
            <div className="flex items-center justify-between text-[10px] uppercase text-gray-100">
              <span className="flex items-center gap-2 tracking-[0.3em]">
                <Target size={12} />
                Đang theo dõi
              </span>
              <span className="text-red-300 font-bold bg-red-900/40 px-2 py-0.5 rounded-full">LIVE</span>
            </div>
            <p className="text-xl font-semibold text-white mt-2">{dashboardInfo.location}</p>
            <p className="text-[12px] font-mono text-gray-200">{dashboardInfo.coordinates}</p>

            <button
              onClick={handleAnalyze}
              disabled={analyzing || !inputLocation}
              className="mt-3 w-full flex items-center justify-center gap-2 text-xs bg-blue-500/20 border border-blue-300/40 text-blue-100 rounded-xl py-2 hover:bg-blue-500/30 disabled:opacity-50 transition"
            >
              {analyzing ? <Activity className="animate-spin" size={14} /> : <Bot size={14} />}
              {analyzing ? 'AI đang phân tích...' : 'Xem đánh giá từ AI'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SafeWaveApp;
