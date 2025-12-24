const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('safewave', {
  version: '0.1.0',
  
  // Database API
  db: {
    saveAnalysis: (data) => ipcRenderer.invoke('db:save-analysis', data),
    getHistory: (limit) => ipcRenderer.invoke('db:get-history', limit),
    saveAlert: (alert) => ipcRenderer.invoke('db:save-alert', alert),
    getAlerts: () => ipcRenderer.invoke('db:get-alerts'),
    clearExpiredAlerts: () => ipcRenderer.invoke('db:clear-expired-alerts'),
    toggleFavorite: (historyId) => ipcRenderer.invoke('db:toggle-favorite', historyId),
    deleteHistory: (historyId) => ipcRenderer.invoke('db:delete-history', historyId),
    getHistoryDetail: (historyId) => ipcRenderer.invoke('db:get-history-detail', historyId),
    getProvinceList: () => ipcRenderer.invoke('db:get-province-list'),
    getProvinceRainHistory: (province, limit) => ipcRenderer.invoke('db:get-province-rain-history', province, limit),
    getShelters: () => ipcRenderer.invoke('db:get-shelters'),
    getHistoricProvinceRecords: (province) => ipcRenderer.invoke('db:get-historic-province-records', province),
  },
  
  // GDACS API (hoạt động cả dev và production)
  fetchGdacs: () => ipcRenderer.invoke('fetch-gdacs'),
});

