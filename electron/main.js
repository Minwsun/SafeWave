const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const SafeWaveDB = require('../database/db');
const { startProvinceRainCollector } = require('./rainCollector');

const isDev = !!process.env.VITE_DEV_SERVER_URL;

// Initialize database
let db = null;
let stopRainCollector = null;
app.whenReady().then(() => {
  try {
    db = new SafeWaveDB();
    
    // Cleanup old data on startup
    if (db) {
      db.deleteOldHistory(10); // Keep 10 days
      db.clearExpiredAlerts();
      stopRainCollector = startProvinceRainCollector(db);
    }
  } catch (error) {
    console.error('Failed to initialize database:', error);
    // App will continue to work without database (fallback to state-only)
  }
});

// IPC Handlers for database operations
ipcMain.handle('db:save-analysis', async (event, data) => {
  if (!db) {
    console.warn('Database not initialized, skipping save');
    return { success: false, error: 'Database not initialized' };
  }
  try {
    const result = db.saveCompleteAnalysis(
      data.location,
      data.weatherData,
      data.rainStats,
      data.analysis,
      data.reasons
    );
    return { success: true, data: result };
  } catch (error) {
    console.error('Error saving analysis:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db:get-history', async (event, limit = 100) => {
  if (!db) {
    console.warn('Database not initialized, returning empty history');
    return { success: true, data: [] };
  }
  try {
    const history = db.getHistory(limit);
    return { success: true, data: history };
  } catch (error) {
    console.error('Error getting history:', error);
    return { success: false, error: error.message, data: [] };
  }
});

ipcMain.handle('db:save-alert', async (event, alert) => {
  if (!db) {
    console.warn('Database not initialized, skipping alert save');
    return { success: false, error: 'Database not initialized' };
  }
  try {
    db.createAlert(alert);
    return { success: true };
  } catch (error) {
    console.error('Error saving alert:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db:get-alerts', async (event) => {
  if (!db) {
    console.warn('Database not initialized, returning empty alerts');
    return { success: true, data: [] };
  }
  try {
    const alerts = db.getAllActiveAlerts();
    return { success: true, data: alerts };
  } catch (error) {
    console.error('Error getting alerts:', error);
    return { success: false, error: error.message, data: [] };
  }
});

ipcMain.handle('db:clear-expired-alerts', async (event) => {
  if (!db) {
    console.warn('Database not initialized, skipping clear');
    return { success: false, error: 'Database not initialized' };
  }
  try {
    db.clearExpiredAlerts();
    return { success: true };
  } catch (error) {
    console.error('Error clearing alerts:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db:toggle-favorite', async (event, historyId) => {
  if (!db) {
    return { success: false, error: 'Database not initialized' };
  }
  try {
    const isFavorite = db.toggleFavorite(historyId);
    return { success: true, isFavorite };
  } catch (error) {
    console.error('Error toggling favorite:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db:delete-history', async (event, historyId) => {
  if (!db) {
    return { success: false, error: 'Database not initialized' };
  }
  try {
    db.deleteHistoryEntry(historyId);
    return { success: true };
  } catch (error) {
    console.error('Error deleting history:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db:get-history-detail', async (event, historyId) => {
  if (!db) {
    return { success: false, error: 'Database not initialized' };
  }
  try {
    const detail = db.getHistoryDetail(historyId);
    return { success: true, data: detail };
  } catch (error) {
    console.error('Error getting history detail:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db:get-province-list', async () => {
  if (!db) {
    return { success: false, error: 'Database not initialized', data: [] };
  }
  try {
    const provinces = db.getProvinceList();
    return { success: true, data: provinces };
  } catch (error) {
    console.error('Error getting provinces:', error);
    return { success: false, error: error.message, data: [] };
  }
});

ipcMain.handle('db:get-province-rain-history', async (event, province, limit = 30) => {
  if (!db) {
    return { success: false, error: 'Database not initialized', data: [] };
  }
  try {
    const rainHistory = db.getProvinceRainHistory(province, limit);
    return { success: true, data: rainHistory };
  } catch (error) {
    console.error('Error getting province rain history:', error);
    return { success: false, error: error.message, data: [] };
  }
});

ipcMain.handle('db:get-shelters', async () => {
  if (!db) {
    return { success: false, error: 'Database not initialized', data: [] };
  }
  try {
    const shelters = db.getShelters();
    return { success: true, data: shelters };
  } catch (error) {
    console.error('Error getting shelters:', error);
    return { success: false, error: error.message, data: [] };
  }
});

ipcMain.handle('db:get-historic-province-records', async (event, province) => {
  if (!db) {
    return { success: false, error: 'Database not initialized', data: [] };
  }
  try {
    const records = db.getHistoricProvinceRecords(province);
    return { success: true, data: records };
  } catch (error) {
    console.error('Error getting historic province records:', error);
    return { success: false, error: error.message, data: [] };
  }
});

// IPC handler để fetch GDACS data (bypass CORS, hoạt động cả dev và production)
ipcMain.handle('fetch-gdacs', async () => {
  try {
    const https = require('https');
    const url = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtypes=TC';
    
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  } catch (error) {
    console.error('GDACS fetch error:', error);
    throw error;
  }
});

// Cleanup on app quit
app.on('before-quit', () => {
  if (stopRainCollector) {
    stopRainCollector();
  }
  if (db) {
    db.close();
  }
});

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#0B0C10',
    title: 'SafeWave OS',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '../renderer/dist/index.html');
    mainWindow.loadFile(indexPath);
  }
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

