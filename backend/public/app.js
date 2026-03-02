(function () {
  const getBackend = () => {
    const input = document.getElementById('backendUrl').value.trim();
    if (input) return input.replace(/\/$/, '');
    return window.location.origin;
  };
  let adminWs = null;
  let audioContext = null;
  let selectedDeviceId = null;

  function fetchDevices() {
    const base = getBackend();
    fetch(`${base}/api/devices`)
      .then((r) => r.json())
      .then((list) => {
        const el = document.getElementById('deviceList');
        const connectedIds = new Set((list || []).filter((d) => d.connected).map((d) => d.deviceId));
        if (selectedDeviceId && !connectedIds.has(selectedDeviceId)) {
          document.getElementById('deviceDisconnectedWarning').style.display = 'block';
          document.getElementById('deviceDisconnectedWarning').textContent = 'Selected device is disconnected. Open the Connection Test app on your iPhone, tap Test, then refresh this page.';
        } else {
          document.getElementById('deviceDisconnectedWarning').style.display = 'none';
        }
        if (!list || !list.length) {
          el.innerHTML = '<span class="empty">No devices connected. Open the Connection Test app on your iPhone, enter the server URL, and tap Test.</span>';
          return;
        }
        el.innerHTML = list
          .map(
            (d) =>
              `<div class="device">
                <div>
                  <span class="device-id">${escapeHtml(d.deviceId)}</span>
                  <span class="status ${d.connected ? 'connected' : 'disconnected'}">${d.connected ? 'Connected' : 'Disconnected'}</span>
                </div>
                ${d.connected ? `<button class="primary" data-device="${escapeHtml(d.deviceId)}">Select & control</button>` : ''}
              </div>`
          )
          .join('');
        el.querySelectorAll('button[data-device]').forEach((btn) => {
          btn.addEventListener('click', () => selectDevice(btn.dataset.device));
        });
      })
      .catch((e) => {
        document.getElementById('deviceList').innerHTML =
          '<span class="empty">Could not reach backend. Set Backend URL and ensure the server is running.</span>';
      });
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function selectDevice(deviceId) {
    selectedDeviceId = deviceId;
    document.getElementById('selectedDeviceId').textContent = 'Device: ' + deviceId;
    document.getElementById('controlPanel').style.display = 'block';
    document.getElementById('location').textContent = '';
    document.getElementById('audioStatus').textContent = '';
    document.getElementById('btnStopListen').style.display = 'none';
    document.getElementById('btnStartListen').style.display = 'inline-block';
    if (adminWs) {
      adminWs.close();
      adminWs = null;
    }
  }

  function sendCommand(deviceId, action) {
    const base = getBackend();
    return fetch(`${base}/api/devices/${encodeURIComponent(deviceId)}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }).then((r) => {
      return r.json().then((body) => {
        if (!r.ok) return Promise.reject(new Error(body.error || 'Request failed'));
        return body;
      });
    });
  }

  function startListening() {
    if (!selectedDeviceId) return;
    // Create and resume AudioContext on user click so browser allows playback
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    if (audioContext.state === 'suspended') audioContext.resume();

    const base = getBackend();
    const wsBase = base.replace(/^http/, 'ws').replace(/\/$/, '');
    const wsUrl = wsBase + '/ws?role=admin&deviceId=' + encodeURIComponent(selectedDeviceId);
    adminWs = new WebSocket(wsUrl);
    adminWs.binaryType = 'arraybuffer';

    adminWs.onopen = () => {
      document.getElementById('audioStatus').textContent = 'Streaming… (listen here)';
      document.getElementById('btnStartListen').style.display = 'none';
      document.getElementById('btnStopListen').style.display = 'inline-block';
      sendCommand(selectedDeviceId, 'start_listening').catch((err) => {
        document.getElementById('audioStatus').textContent = 'Device disconnected. Reconnect the app on your phone and try again.';
      });
    };

    adminWs.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer && audioContext) {
        playPCM16(ev.data);
      }
    };

    adminWs.onclose = () => {
      document.getElementById('audioStatus').textContent = 'Stream ended.';
      document.getElementById('btnStartListen').style.display = 'inline-block';
      document.getElementById('btnStopListen').style.display = 'none';
    };

    adminWs.onerror = () => {
      document.getElementById('audioStatus').textContent = 'Connection error.';
    };
  }

  function playPCM16(arrayBuffer) {
    if (!audioContext || arrayBuffer.byteLength < 2) return;
    const numSamples = arrayBuffer.byteLength / 2;
    const buffer = audioContext.createBuffer(1, numSamples, 16000);
    const channel = buffer.getChannelData(0);
    const view = new DataView(arrayBuffer);
    for (let i = 0; i < numSamples; i++) {
      channel[i] = view.getInt16(i * 2, true) / 32768;
    }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);
  }

  function stopListening() {
    if (adminWs) adminWs.close();
    adminWs = null;
    sendCommand(selectedDeviceId, 'stop_listening');
    document.getElementById('audioStatus').textContent = 'Stopped.';
    document.getElementById('btnStartListen').style.display = 'inline-block';
    document.getElementById('btnStopListen').style.display = 'none';
  }

  function getLocation() {
    if (!selectedDeviceId) return;
    const base = getBackend();
    document.getElementById('location').textContent = 'Requesting location from device…';
    function fetchLocation() {
      return fetch(`${base}/api/devices/${encodeURIComponent(selectedDeviceId)}/location`).then((r) => r.json());
    }
    sendCommand(selectedDeviceId, 'get_location')
      .then(() => new Promise((r) => setTimeout(r, 1000)))
      .then(() => fetchLocation())
      .then((data) => {
        if (data.lat != null) {
          document.getElementById('location').textContent =
            `Lat: ${data.lat}\nLon: ${data.lon}\nAccuracy: ${data.accuracy ?? '—'} m\n\nhttps://www.google.com/maps?q=${data.lat},${data.lon}`;
          return;
        }
        return new Promise((r) => setTimeout(r, 1500)).then(() => fetchLocation());
      })
      .then((data) => {
        if (!data) return;
        if (data.error === 'Device not found') {
          document.getElementById('location').textContent = 'Device disconnected. Reconnect the app and try again.';
          return;
        }
        if (data.lat != null) {
          document.getElementById('location').textContent =
            `Lat: ${data.lat}\nLon: ${data.lon}\nAccuracy: ${data.accuracy ?? '—'} m\n\nhttps://www.google.com/maps?q=${data.lat},${data.lon}`;
        } else {
          document.getElementById('location').textContent = data.error || 'No location yet. Allow location for the app in Settings and try again.';
        }
      })
      .catch(() => {
        document.getElementById('location').textContent = 'Failed to get location.';
      });
  }

  document.getElementById('btnStartListen').addEventListener('click', startListening);
  document.getElementById('btnStopListen').addEventListener('click', stopListening);
  document.getElementById('btnLocation').addEventListener('click', getLocation);

  setInterval(fetchDevices, 3000);
  fetchDevices();
})();
