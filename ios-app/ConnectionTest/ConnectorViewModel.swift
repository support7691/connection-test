import Foundation
import Combine
import UIKit

final class ConnectorViewModel: ObservableObject {
    @Published var isConnected = false
    @Published var statusText = "Enter server and tap Test"
    @Published var serverURL: String = ""

    private var deviceId: String { UIDevice.current.identifierForVendor?.uuidString ?? "unknown" }
    private var baseURL: String = ""
    private var ws: URLSessionWebSocketTask?
    private var audioStreamer: AudioStreamer?
    private var locationManager: LocationManager?

    func requestPermissionsAndConnect() {
        serverURL = UserDefaults.standard.string(forKey: "backendURL") ?? ""
        if !serverURL.isEmpty {
            connect(to: serverURL)
        } else {
            statusText = "Enter server and tap Test"
        }
    }

    func connect(to urlString: String) {
        let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            statusText = "Enter server URL"
            return
        }
        var url = trimmed
        if !url.hasPrefix("http") { url = "http://" + url }
        statusText = "Requesting permissions…"
        LocationManager.requestAuthorization()
        AudioStreamer.requestAuthorization { [weak self] granted in
            DispatchQueue.main.async {
                if granted {
                    self?.baseURL = url
                    UserDefaults.standard.set(url, forKey: "backendURL")
                    self?.startConnection()
                } else {
                    self?.statusText = "Microphone access required"
                }
            }
        }
    }

    private func startConnection() {
        guard !baseURL.isEmpty, baseURL != "http://localhost:3000" else {
            statusText = "Enter server and tap Test"
            return
        }
        let wsURL = baseURL
            .replacingOccurrences(of: "http://", with: "ws://")
            .replacingOccurrences(of: "https://", with: "wss://")
        guard let url = URL(string: "\(wsURL)/ws?role=device&deviceId=\(deviceId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? deviceId)") else {
            statusText = "Invalid URL"
            return
        }
        var req = URLRequest(url: url)
        req.timeoutIntervalForRequest = 30
        ws = URLSession.shared.webSocketTask(with: req)
        ws?.resume()
        isConnected = true
        statusText = "Connected"
        receiveNext()
    }

    private func receiveNext() {
        ws?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self?.handleCommand(text)
                case .data(let data):
                    break
                @unknown default:
                    break
                }
            case .failure:
                DispatchQueue.main.async {
                    self?.isConnected = false
                    self?.statusText = "Disconnected"
                }
                return
            }
            self?.receiveNext()
        }
    }

    private func handleCommand(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let action = json["action"] as? String else { return }
        switch action {
        case "start_listening":
            startListening()
        case "stop_listening":
            stopListening()
        case "get_location":
            sendLocation()
        default:
            break
        }
    }

    private func startListening() {
        if audioStreamer == nil {
            audioStreamer = AudioStreamer()
        }
        audioStreamer?.onChunk = { [weak self] pcmData in
            self?.ws?.send(.data(pcmData)) { _ in }
        }
        audioStreamer?.start()
    }

    private func stopListening() {
        audioStreamer?.stop()
    }

    private func sendLocation() {
        if locationManager == nil {
            locationManager = LocationManager()
        }
        locationManager?.fetchLocation { [weak self] lat, lon, accuracy in
            guard let self = self else { return }
            let payload: [String: Any] = [
                "type": "location",
                "lat": lat,
                "lon": lon,
                "accuracy": accuracy ?? 0
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: payload),
                  let str = String(data: data, encoding: .utf8) else { return }
            self.ws?.send(.string(str)) { _ in }
        }
    }
}
