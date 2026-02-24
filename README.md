# Connection Test – iOS monitoring (your own device)

Control your iPhone from a **web admin** (or Android browser): **start/stop listening** to ambient audio and **get location**. No 24/7; all control is from the admin. The iOS app has a simple “Connection Test” UI only.

## What’s included

| Part | Purpose |
|------|--------|
| **backend/** | Node server: WebSocket for device + admin, REST for commands. |
| **web-admin/** | Browser dashboard: list device, Start/Stop listening, Get location. |
| **ios-app/** | iOS (Swift) app: “Connection Test” UI, mic stream, location, remote commands. |

## Quick start

### 1. Backend (your Mac or PC)

```bash
cd backend
npm install
npm start
```

Runs at `http://0.0.0.0:4000` (use `PORT=4001 npm start` for another port). Note your machine’s IP (e.g. `192.168.1.100`).

### 2. Web admin

- Open `web-admin/index.html` in a browser, or serve it:
  ```bash
  cd web-admin && npx serve .
  ```
- In the admin page, set **Backend URL** to `http://YOUR_IP:4000` (same IP as above).

### 3. iOS app

- Open the iOS project in Xcode (see `ios-app/README.md` for creating the project and adding the provided Swift files).
- On first run, enter the same backend URL (e.g. `http://192.168.1.100:4000`) and tap **Test**. Allow mic and location.
- When it shows **Connected**, the device appears in the web admin.

### 4. Use the admin

- **Select** your device → **Start listening** to hear ambient audio from the iPhone; **Stop listening** to end.
- **Get location** to receive the last reported location (and a Maps link).

## Requirements

- iPhone and admin device on the same network as the backend (or use a tunnel like ngrok for the backend if needed).
- Backend URL in the iOS app must use your computer’s IP (not `localhost`).

## Security

- No auth in this setup. Use only on a trusted network or add your own authentication.
