-- SafeWave Database Schema
-- SQLite Database

-- Locations table
CREATE TABLE IF NOT EXISTS locations (
    location_id INTEGER PRIMARY KEY AUTOINCREMENT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    province TEXT,
    elevation INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Weather records table
CREATE TABLE IF NOT EXISTS weather_records (
    weather_id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL,
    temp REAL,
    feels_like REAL,
    temp_min REAL,
    temp_max REAL,
    humidity INTEGER,
    pressure_sea REAL,
    pressure_ground REAL,
    wind_speed REAL,
    wind_dir INTEGER,
    wind_gusts REAL,
    cloud_cover INTEGER,
    uv_index INTEGER,
    soil_moisture REAL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE CASCADE
);

-- Rain stats table
CREATE TABLE IF NOT EXISTS rain_stats (
    rain_id INTEGER PRIMARY KEY AUTOINCREMENT,
    weather_id INTEGER NOT NULL,
    h1 REAL DEFAULT 0,
    h2 REAL DEFAULT 0,
    h3 REAL DEFAULT 0,
    h5 REAL DEFAULT 0,
    h12 REAL DEFAULT 0,
    h24 REAL DEFAULT 0,
    d3 REAL DEFAULT 0,
    d7 REAL DEFAULT 0,
    d14 REAL DEFAULT 0,
    FOREIGN KEY (weather_id) REFERENCES weather_records(weather_id) ON DELETE CASCADE
);

-- Risk analyses table
CREATE TABLE IF NOT EXISTS risk_analyses (
    analysis_id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL,
    weather_id INTEGER,
    level INTEGER NOT NULL,
    label TEXT NOT NULL,
    score REAL,
    confidence REAL,
    actions TEXT,
    terrain_type TEXT,
    soil_type TEXT,
    saturation REAL,
    analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE CASCADE,
    FOREIGN KEY (weather_id) REFERENCES weather_records(weather_id) ON DELETE SET NULL
);

-- Risk reasons table
CREATE TABLE IF NOT EXISTS risk_reasons (
    reason_id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    score REAL,
    description TEXT,
    source TEXT,
    FOREIGN KEY (analysis_id) REFERENCES risk_analyses(analysis_id) ON DELETE CASCADE
);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
    alert_id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT,
    location_name TEXT NOT NULL,
    province TEXT,
    level TEXT NOT NULL,
    type TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    rain_amount REAL DEFAULT 0,
    wind_speed REAL DEFAULT 0,
    description TEXT,
    source TEXT,
    is_cluster INTEGER DEFAULT 0,
    cluster_count INTEGER DEFAULT 1,
    detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
);

-- Analysis history table
CREATE TABLE IF NOT EXISTS analysis_history (
    history_id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER,
    analysis_id INTEGER,
    risk_level TEXT NOT NULL,
    risk_type TEXT,
    is_favorite INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE SET NULL,
    FOREIGN KEY (analysis_id) REFERENCES risk_analyses(analysis_id) ON DELETE SET NULL
);

-- Province rain history
CREATE TABLE IF NOT EXISTS province_rain_history (
    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
    province TEXT NOT NULL,
    h1 REAL DEFAULT 0,
    h3 REAL DEFAULT 0,
    h24 REAL DEFAULT 0,
    d3 REAL DEFAULT 0,
    d7 REAL DEFAULT 0,
    d14 REAL DEFAULT 0,
    location_note TEXT,
    source TEXT,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Storm shelters
CREATE TABLE IF NOT EXISTS shelters (
    shelter_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    province TEXT NOT NULL,
    address TEXT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    capacity INTEGER,
    contact TEXT,
    status TEXT DEFAULT 'Available',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_locations_coords ON locations(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_weather_location ON weather_records(location_id);
CREATE INDEX IF NOT EXISTS idx_risk_location ON risk_analyses(location_id);
CREATE INDEX IF NOT EXISTS idx_risk_reasons_analysis ON risk_reasons(analysis_id);
CREATE INDEX IF NOT EXISTS idx_alerts_coords ON alerts(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_alerts_detected ON alerts(detected_at);
CREATE INDEX IF NOT EXISTS idx_history_location ON analysis_history(location_id);
CREATE INDEX IF NOT EXISTS idx_history_created ON analysis_history(created_at);
CREATE INDEX IF NOT EXISTS idx_province_rain_province ON province_rain_history(province);
CREATE INDEX IF NOT EXISTS idx_shelters_province ON shelters(province);
CREATE INDEX IF NOT EXISTS idx_shelters_coords ON shelters(latitude, longitude);

