import AVFoundation
import Foundation

final class AudioStreamer {
    private let engine = AVAudioEngine()
    private let sampleRate: Double = 16000
    private var isRunning = false

    var onChunk: ((Data) -> Void)?

    static func requestAuthorization(completion: @escaping (Bool) -> Void) {
        AVAudioApplication.requestRecordPermission { granted in
            DispatchQueue.main.async { completion(granted) }
        }
    }

    func start() {
        guard !isRunning else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
        } catch { }
        let input = engine.inputNode
        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.processBuffer(buffer)
        }
        do {
            try engine.start()
            isRunning = true
        } catch {
            print("AudioEngine start failed: \(error)")
        }
    }

    func stop() {
        guard isRunning else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        isRunning = false
    }

    private func processBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let channel = buffer.floatChannelData?[0] else { return }
        let frameLength = Int(buffer.frameLength)
        var int16Data = [Int16](repeating: 0, count: frameLength)
        for i in 0..<frameLength {
            let s = max(-1, min(1, channel[i]))
            int16Data[i] = Int16(s * 32767)
        }
        let data = int16Data.withUnsafeBufferPointer { Data(buffer: $0) }
        onChunk?(data)
    }
}
