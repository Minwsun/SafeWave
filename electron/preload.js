const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('safewave', {
  version: '0.1.0'
});

