import SwiftUI

struct ContentView: View {
    @EnvironmentObject var connector: ConnectorViewModel

    var body: some View {
        VStack(spacing: 24) {
            Text("Connection Test")
                .font(.title2)
                .fontWeight(.medium)
            if connector.isConnected {
                Text(connector.statusText)
                    .font(.subheadline)
                    .foregroundColor(.green)
                Text("Version 1.0")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                TextField("Server", text: $connector.serverURL)
                    .textFieldStyle(.roundedBorder)
                    .autocapitalization(.none)
                    .keyboardType(.URL)
                    .padding(.horizontal, 40)
                Button("Test") {
                    connector.connect(to: connector.serverURL)
                }
                .buttonStyle(.borderedProminent)
                Text(connector.statusText)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
        .onAppear {
            connector.requestPermissionsAndConnect()
        }
    }
}
