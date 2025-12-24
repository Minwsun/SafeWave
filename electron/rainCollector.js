const fs = require('fs');
const path = require('path');

const nativeFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
let fallbackFetch = null;

const getFetch = async () => {
  if (nativeFetch) {
    return nativeFetch;
  }
  if (!fallbackFetch) {
    const mod = await import('node-fetch');
    fallbackFetch = mod.default;
  }
  return fallbackFetch;
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const loadProvinceCoordinates = () => {
  const baseDir = process.env.NODE_ENV === 'production' && process.resourcesPath
    ? path.join(process.resourcesPath, 'data')
    : path.join(__dirname, '../data');
  const filePath = path.join(baseDir, 'province-centroids.json');
  if (!fs.existsSync(filePath)) {
    throw new Error('Province centroid data not found');
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const calculateHourlySums = (hourly, currentIdx, hours) => {
  let total = 0;
  for (let i = 0; i < hours; i++) {
    const idx = currentIdx - i;
    if (idx < 0) break;
    const value = hourly[idx];
    if (typeof value === 'number') {
      total += value;
    }
  }
  return Number(total.toFixed(2));
};

const calculateDailySums = (daily, days) => {
  if (!Array.isArray(daily)) return 0;
  let total = 0;
  for (let i = 0; i < days && i < daily.length; i++) {
    const value = daily[i];
    if (typeof value === 'number') {
      total += value;
    }
  }
  return Number(total.toFixed(2));
};

const computeRainStats = (data) => {
  if (!data?.hourly?.precipitation || !data?.hourly?.time) {
    throw new Error('Incomplete hourly precipitation data');
  }
  const times = data.hourly.time;
  const precip = data.hourly.precipitation;
  const now = Date.now();
  let currentIdx = times.findIndex(t => new Date(t).getTime() > now);
  if (currentIdx === -1) {
    currentIdx = times.length - 1;
  } else if (currentIdx > 0) {
    currentIdx -= 1;
  }
  const h1 = calculateHourlySums(precip, currentIdx, 1);
  const h3 = calculateHourlySums(precip, currentIdx, 3);
  const h24 = calculateHourlySums(precip, currentIdx, 24);
  const d3 = calculateDailySums(data.daily?.precipitation_sum, 3);
  const d7 = calculateDailySums(data.daily?.precipitation_sum, 7);
  const d14 = calculateDailySums(data.daily?.precipitation_sum, 14);
  return { h1, h3, h24, d3, d7, d14 };
};

const fetchRainSnapshot = async (lat, lon) => {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat.toString());
  url.searchParams.set('longitude', lon.toString());
  url.searchParams.set('hourly', 'precipitation');
  url.searchParams.set('daily', 'precipitation_sum');
  url.searchParams.set('forecast_days', '14');
  url.searchParams.set('timezone', 'auto');

  const fetchImpl = await getFetch();
  const res = await fetchImpl(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status}`);
  }
  const json = await res.json();
  return computeRainStats(json);
};

const provinceCoords = loadProvinceCoordinates();
const UPDATE_INTERVAL_MS = 3 * 60 * 60 * 1000; // every 3 hours
const REQUEST_DELAY_MS = 1200;

const startProvinceRainCollector = (db) => {
  if (!db) {
    return () => {};
  }
  let stopped = false;
  let running = false;

  const executeCycle = async () => {
    if (stopped || running) return;
    running = true;
    for (const province of provinceCoords) {
      if (stopped) break;
      try {
        const stats = await fetchRainSnapshot(province.latitude, province.longitude);
        db.recordProvinceRain(province.province, stats);
      } catch (error) {
        console.warn('[RainCollector] Failed to fetch rain stats for', province.province, error.message);
      }
      await wait(REQUEST_DELAY_MS);
    }
    running = false;
  };

  executeCycle();
  const timer = setInterval(executeCycle, UPDATE_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
};

module.exports = { startProvinceRainCollector };

