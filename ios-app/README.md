# Connection Test – iOS App

Simple “Connection Test” UI; all monitoring is controlled from the web admin.

## Setup in Xcode

1. Open Xcode and create a **new project**:
   - Choose **App** (iOS).
   - Product Name: **ConnectionTest**
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Uncheck “Include Tests” if you like.
   - Save it **inside** the `ios-app` folder (so the project is `ios-app/ConnectionTest.xcodeproj` and the app code lives in `ios-app/ConnectionTest/`).

2. **Replace / add files** in the ConnectionTest target:
   - Replace the default `ContentView.swift` with the one in this `ConnectionTest` folder.
   - Replace the default `ConnectionTestApp.swift` with the one here.
   - **Add** to the target: `ConnectorViewModel.swift`, `AudioStreamer.swift`, `LocationManager.swift`.
   - Set the app’s **Info.plist**: either replace with the provided `Info.plist` or add these keys to the existing one:
     - **Privacy - Microphone Usage Description** (NSMicrophoneUsageDescription)
     - **Privacy - Location When In Use** (NSLocationWhenInUseUsageDescription)
     - **Privacy - Location Always and When In Use** (NSLocationAlwaysAndWhenInUseUsageDescription)
     - **Background Modes** → enable **Audio**.

3. **Signing**: In the project’s Signing & Capabilities, select your Team so the app can run on your iPhone.

4. **Run** on your iPhone (device must be on the same network as your backend).

## First run on the iPhone

1. Enter your **server** URL (e.g. `http://YOUR_PC_IP:3000`), then tap **Test**.
2. Allow **Microphone** and **Location** when prompted.
3. When it shows **Connected**, you can leave the app (or send to background). Control everything from the web admin.

## Backend URL

- Use your computer’s local IP (e.g. `192.168.1.100`) so the iPhone can reach it: `http://192.168.1.100:4000`.
- After the first successful connection, the URL is saved and the app will reconnect automatically next time.
