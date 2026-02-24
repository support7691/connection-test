import CoreLocation
import Foundation

final class LocationManager: NSObject {
    private let manager = CLLocationManager()
    private var completion: ((Double, Double, Double?) -> Void)?

    static func requestAuthorization() {
        let m = CLLocationManager()
        m.requestWhenInUseAuthorization()
        m.requestAlwaysAuthorization()
    }

    func fetchLocation(completion: @escaping (Double, Double, Double?) -> Void) {
        self.completion = completion
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.requestLocation()
    }
}

extension LocationManager: CLLocationManagerDelegate {
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        completion?(loc.coordinate.latitude, loc.coordinate.longitude, loc.horizontalAccuracy)
        completion = nil
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        completion?(0, 0, nil)
        completion = nil
    }
}
