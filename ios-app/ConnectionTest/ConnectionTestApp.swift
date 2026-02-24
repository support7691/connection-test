import SwiftUI

@main
struct ConnectionTestApp: App {
    @StateObject private var connector = ConnectorViewModel()
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connector)
        }
    }
}
