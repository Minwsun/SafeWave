const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class SafeWaveDB {
  constructor() {
    this.baseDir = app.isPackaged
      ? path.join(process.resourcesPath, 'database')
      : __dirname;

    // Get user data path for Electron
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'safewave.db');
    
    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL'); // Better performance
    this.db.pragma('foreign_keys = ON'); // Enable foreign keys
    
    this.init();
  }

  init() {
    // Read and execute schema
    const schemaPath = path.join(this.baseDir, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    this.db.exec(schema);
    
    // Migration: Add columns if missing
    try {
      this.db.exec(`
        ALTER TABLE analysis_history ADD COLUMN is_favorite INTEGER DEFAULT 0;
      `);
    } catch (e) {
      // Column already exists, ignore
    }

    try {
      this.db.exec(`
        ALTER TABLE locations ADD COLUMN province TEXT;
      `);
    } catch (e) {
      // Column already exists
    }

    try {
      this.db.exec(`
        ALTER TABLE province_rain_history ADD COLUMN location_note TEXT;
      `);
    } catch (e) {
      // Column already exists
    }

    try {
      this.db.exec(`
        ALTER TABLE province_rain_history ADD COLUMN source TEXT;
      `);
    } catch (e) {
      // Column already exists
    }

    this.seedShelters();
    this.seedHistoricalProvinceRain();
  }

  // ========== LOCATIONS ==========
  createLocation(location) {
    const stmt = this.db.prepare(`
      INSERT INTO locations (latitude, longitude, title, subtitle, province, elevation)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      location.latitude,
      location.longitude,
      location.title,
      location.subtitle || null,
      location.province || null,
      location.elevation || 0
    );
    return result.lastInsertRowid;
  }

  getLocationById(locationId) {
    return this.db.prepare('SELECT * FROM locations WHERE location_id = ?').get(locationId);
  }

  findLocationByCoords(lat, lng) {
    return this.db.prepare(`
      SELECT * FROM locations 
      WHERE ABS(latitude - ?) < 0.0001 AND ABS(longitude - ?) < 0.0001
      ORDER BY created_at DESC
      LIMIT 1
    `).get(lat, lng);
  }

  // ========== WEATHER RECORDS ==========
  createWeatherRecord(locationId, weatherData) {
    const stmt = this.db.prepare(`
      INSERT INTO weather_records (
        location_id, temp, feels_like, temp_min, temp_max, humidity,
        pressure_sea, pressure_ground, wind_speed, wind_dir, wind_gusts,
        cloud_cover, uv_index, soil_moisture
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      locationId,
      weatherData.temp,
      weatherData.feelsLike,
      weatherData.tempMin,
      weatherData.tempMax,
      weatherData.humidity,
      weatherData.pressureSea,
      weatherData.pressureGround,
      weatherData.windSpeed,
      weatherData.windDir,
      weatherData.windGusts,
      weatherData.cloudCover,
      weatherData.uvIndex,
      weatherData.soilMoisture || null
    );
    return result.lastInsertRowid;
  }

  // ========== RAIN STATS ==========
  createRainStats(weatherId, rainStats) {
    const stmt = this.db.prepare(`
      INSERT INTO rain_stats (
        weather_id, h1, h2, h3, h5, h12, h24, d3, d7, d14
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      weatherId,
      rainStats.h1 || 0,
      rainStats.h2 || 0,
      rainStats.h3 || 0,
      rainStats.h5 || 0,
      rainStats.h12 || 0,
      rainStats.h24 || 0,
      rainStats.d3 || 0,
      rainStats.d7 || 0,
      rainStats.d14 || 0
    );
  }

  // ========== RISK ANALYSES ==========
  createRiskAnalysis(locationId, weatherId, analysis) {
    const stmt = this.db.prepare(`
      INSERT INTO risk_analyses (
        location_id, weather_id, level, label, score, confidence,
        actions, terrain_type, soil_type, saturation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      locationId,
      weatherId || null,
      analysis.level,
      analysis.label,
      analysis.score || null,
      analysis.confidence || null,
      analysis.actions || null,
      analysis.terrainType || null,
      analysis.soilType || null,
      analysis.saturation || null
    );
    return result.lastInsertRowid;
  }

  // ========== RISK REASONS ==========
  createRiskReasons(analysisId, reasons) {
    if (!reasons || reasons.length === 0) return;
    
    const stmt = this.db.prepare(`
      INSERT INTO risk_reasons (analysis_id, code, score, description, source)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const insertMany = this.db.transaction((reasons) => {
      for (const reason of reasons) {
        stmt.run(
          analysisId,
          reason.code,
          reason.score,
          reason.description,
          reason.source
        );
      }
    });
    
    insertMany(reasons);
  }

  // ========== ALERTS ==========
  createAlert(alert) {
    const stmt = this.db.prepare(`
      INSERT INTO alerts (
        external_id, location_name, province, level, type,
        latitude, longitude, rain_amount, wind_speed, description,
        source, is_cluster, cluster_count, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      alert.externalId || null,
      alert.locationName,
      alert.province || null,
      alert.level,
      alert.type,
      alert.latitude,
      alert.longitude,
      alert.rainAmount || 0,
      alert.windSpeed || 0,
      alert.description || null,
      alert.source || null,
      alert.isCluster ? 1 : 0,
      alert.clusterCount || 1,
      alert.expiresAt || null
    );
  }

  getAllActiveAlerts() {
    return this.db.prepare(`
      SELECT * FROM alerts 
      WHERE expires_at IS NULL OR expires_at > datetime('now')
      ORDER BY detected_at DESC
    `).all();
  }

  clearExpiredAlerts() {
    this.db.prepare(`
      DELETE FROM alerts 
      WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
    `).run();
  }

  // ========== ANALYSIS HISTORY ==========
  createHistoryEntry(locationId, analysisId, riskLevel, riskType) {
    const stmt = this.db.prepare(`
      INSERT INTO analysis_history (location_id, analysis_id, risk_level, risk_type, is_favorite)
      VALUES (?, ?, ?, ?, 0)
    `);
    stmt.run(locationId, analysisId, riskLevel, riskType);
  }

  getHistory(limit = 100) {
    return this.db.prepare(`
      SELECT 
        h.history_id as id,
        h.risk_level as risk,
        h.risk_type as type,
        h.created_at,
        h.is_favorite,
        l.title as location
      FROM analysis_history h
      LEFT JOIN locations l ON h.location_id = l.location_id
      ORDER BY h.is_favorite DESC, h.created_at DESC
      LIMIT ?
    `).all(limit);
  }

  getHistoryByLocation(locationId, limit = 50) {
    return this.db.prepare(`
      SELECT 
        h.history_id as id,
        h.risk_level as risk,
        h.risk_type as type,
        h.created_at,
        l.title as location
      FROM analysis_history h
      LEFT JOIN locations l ON h.location_id = l.location_id
      WHERE h.location_id = ?
      ORDER BY h.created_at DESC
      LIMIT ?
    `).all(locationId, limit);
  }

  deleteOldHistory(daysToKeep = 10) {
    this.db.prepare(`
      DELETE FROM analysis_history
      WHERE created_at < datetime('now', '-' || ? || ' days')
      AND is_favorite = 0
    `).run(daysToKeep);
  }

  toggleFavorite(historyId) {
    const current = this.db.prepare('SELECT is_favorite FROM analysis_history WHERE history_id = ?').get(historyId);
    if (!current) return false;
    const newValue = current.is_favorite === 0 ? 1 : 0;
    this.db.prepare('UPDATE analysis_history SET is_favorite = ? WHERE history_id = ?').run(newValue, historyId);
    return newValue === 1;
  }

  deleteHistoryEntry(historyId) {
    this.db.prepare('DELETE FROM analysis_history WHERE history_id = ?').run(historyId);
  }

  getHistoryDetail(historyId) {
    const detail = this.db.prepare(`
      SELECT 
        h.history_id as id,
        h.risk_level as risk,
        h.risk_type as type,
        h.created_at,
        l.location_id as location_id,
        l.title as location_title,
        l.subtitle as location_subtitle,
        l.province as location_province,
        l.latitude as location_latitude,
        l.longitude as location_longitude,
        l.elevation as location_elevation,
        r.analysis_id as analysis_id,
        r.level as analysis_level,
        r.label as analysis_label,
        r.score as analysis_score,
        r.confidence as analysis_confidence,
        r.actions as analysis_actions,
        r.terrain_type as analysis_terrain,
        r.soil_type as analysis_soil,
        r.saturation as analysis_saturation,
        w.temp as weather_temp,
        w.feels_like as weather_feels_like,
        w.temp_min as weather_temp_min,
        w.temp_max as weather_temp_max,
        w.humidity as weather_humidity,
        w.pressure_sea as weather_pressure_sea,
        w.pressure_ground as weather_pressure_ground,
        w.wind_speed as weather_wind_speed,
        w.wind_dir as weather_wind_dir,
        w.wind_gusts as weather_wind_gusts,
        w.cloud_cover as weather_cloud_cover,
        w.uv_index as weather_uv_index,
        w.soil_moisture as weather_soil_moisture,
        rs.h1 as rain_h1,
        rs.h2 as rain_h2,
        rs.h3 as rain_h3,
        rs.h5 as rain_h5,
        rs.h12 as rain_h12,
        rs.h24 as rain_h24,
        rs.d3 as rain_d3,
        rs.d7 as rain_d7,
        rs.d14 as rain_d14
      FROM analysis_history h
      LEFT JOIN locations l ON h.location_id = l.location_id
      LEFT JOIN risk_analyses r ON h.analysis_id = r.analysis_id
      LEFT JOIN weather_records w ON r.weather_id = w.weather_id
      LEFT JOIN rain_stats rs ON w.weather_id = rs.weather_id
      WHERE h.history_id = ?
    `).get(historyId);

    if (!detail) {
      return null;
    }

    const reasons = detail.analysis_id
      ? this.db.prepare(`
          SELECT code, score, description, source
          FROM risk_reasons
          WHERE analysis_id = ?
          ORDER BY score DESC
        `).all(detail.analysis_id)
      : [];

    return { ...detail, reasons };
  }

  // ========== PROVINCE RAIN HISTORY ==========
  recordProvinceRain(province, rainStats) {
    if (!province) return;
    this.db.prepare(`
      INSERT INTO province_rain_history (province, h1, h3, h24, d3, d7, d14, location_note, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      province,
      rainStats.h1 || 0,
      rainStats.h3 || 0,
      rainStats.h24 || 0,
      rainStats.d3 || 0,
      rainStats.d7 || 0,
      rainStats.d14 || 0
    );

    // Keep latest 100 entries per province
    this.db.prepare(`
      DELETE FROM province_rain_history
      WHERE entry_id NOT IN (
        SELECT entry_id FROM province_rain_history
        WHERE province = ?
        ORDER BY recorded_at DESC
        LIMIT 100
      ) AND province = ?
    `).run(province, province);
  }

  getProvinceRainHistory(province, limit = 30) {
    return this.db.prepare(`
      SELECT province, h1, h3, h24, d3, d7, d14, recorded_at
      FROM province_rain_history
      WHERE province = ?
      ORDER BY recorded_at DESC
      LIMIT ?
    `).all(province, limit);
  }

  getProvinceList() {
    return this.db.prepare(`
      SELECT DISTINCT province
      FROM province_rain_history
      WHERE province IS NOT NULL AND province <> ''
      ORDER BY province
    `).all();
  }

  getHistoricProvinceRecords(province) {
    return this.db.prepare(`
      SELECT province, h24, recorded_at, source, location_note
      FROM province_rain_history
      WHERE province = ?
      ORDER BY recorded_at ASC
    `).all(province);
  }

  // ========== SHELTERS ==========
  seedShelters() {
    const count = this.db.prepare('SELECT COUNT(*) as total FROM shelters').get().total;
    if (count > 0) return;

    const seedPath = path.join(this.baseDir, 'shelters.seed.json');
    if (!fs.existsSync(seedPath)) return;

    const raw = fs.readFileSync(seedPath, 'utf8');
    const shelters = JSON.parse(raw);
    const stmt = this.db.prepare(`
      INSERT INTO shelters (name, province, address, latitude, longitude, capacity, contact, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = this.db.transaction((items) => {
      items.forEach(item => {
        stmt.run(
          item.name,
          item.province,
          item.address || null,
          item.latitude,
          item.longitude,
          item.capacity || null,
          item.contact || null,
          item.status || 'Available'
        );
      });
    });
    insertMany(shelters);
  }

  seedHistoricalProvinceRain() {
    const seedPath = path.join(this.baseDir, 'province_rain_records.seed.json');
    if (!fs.existsSync(seedPath)) {
      return;
    }
    const records = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    if (!Array.isArray(records) || records.length === 0) {
      return;
    }

    const existingHistoric = this.db.prepare(`
      SELECT COUNT(*) as total FROM province_rain_history WHERE source IS NOT NULL
    `).get().total;
    if (existingHistoric > 0) {
      return;
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO province_rain_history (province, h1, h3, h24, d3, d7, d14, location_note, source, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items) => {
      items.forEach(item => {
        const h24 = item.h24 || 0;
        insertStmt.run(
          item.province,
          item.h1 || h24,
          item.h3 || h24,
          h24,
          item.d3 || h24,
          item.d7 || h24,
          item.d14 || h24,
          item.location_note || null,
          item.source || null,
          item.recorded_at || new Date().toISOString()
        );
      });
    });

    insertMany(records);
  }

  getShelters() {
    return this.db.prepare(`
      SELECT shelter_id, name, province, address, latitude, longitude, capacity, contact, status
      FROM shelters
      ORDER BY province, name
    `).all();
  }

  // ========== COMPLETE ANALYSIS SAVE ==========
  saveCompleteAnalysis(location, weatherData, rainStats, analysis, reasons) {
    return this.db.transaction(() => {
      // 1. Create or find location
      let locationId = this.findLocationByCoords(location.latitude, location.longitude)?.location_id;
      if (!locationId) {
        locationId = this.createLocation(location);
      }

      // 2. Create weather record
      const weatherId = this.createWeatherRecord(locationId, weatherData);

      // 3. Create rain stats
      this.createRainStats(weatherId, rainStats);

      // 4. Create risk analysis
      const analysisId = this.createRiskAnalysis(locationId, weatherId, analysis);

      // 5. Create risk reasons
      if (reasons && reasons.length > 0) {
        this.createRiskReasons(analysisId, reasons);
      }

      // 6. Create history entry if level >= 2
      if (analysis.level >= 2) {
        this.createHistoryEntry(
          locationId,
          analysisId,
          analysis.label,
          analysis.level === 4 ? 'Nguy hiểm' : 'Thời tiết xấu'
        );
      }

      // 7. Record province rain stats
      const provinceLabel = location.province || location.subtitle || 'Khác';
      this.recordProvinceRain(provinceLabel, rainStats);

      return { locationId, weatherId, analysisId };
    })();
  }

  // ========== UTILITIES ==========
  close() {
    this.db.close();
  }
}

module.exports = SafeWaveDB;

