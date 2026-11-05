import SwiftUI

@main
struct JapanTripApp: App {
    @State private var auth = AuthStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .task { await auth.start() }
                // the app is Hebrew first; the English option arrives with the string catalogue
                .environment(\.locale, TripCalendar.locale)
                .environment(\.layoutDirection, .rightToLeft)
        }
    }
}

struct RootView: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        switch auth.state {
        case .loading:
            ProgressView()
        case .signedOut:
            LoginView()
        case .signedIn(let userId):
            MainTabView(store: TripStore(userId: userId))
                .id(userId)
        }
    }
}

struct MainTabView: View {
    @State var store: TripStore
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            if store.noTrip {
                NoTripView()
            } else if store.trip == nil {
                if let error = store.error {
                    ContentUnavailableView {
                        Label("אין חיבור", systemImage: "wifi.slash")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("נסו שוב") { Task { await store.load() } }
                    }
                } else {
                    ProgressView("טוען…")
                }
            } else {
                TabView {
                    HomeView().tabItem { Label("בית", systemImage: "house.fill") }
                    PlanView().tabItem { Label("מסלול", systemImage: "calendar") }
                    BookingsView().tabItem { Label("הזמנות", systemImage: "ticket.fill") }
                    PlacesView().tabItem { Label("מקומות", systemImage: "mappin.and.ellipse") }
                    MoreView().tabItem { Label("עוד", systemImage: "ellipsis.circle.fill") }
                }
            }
        }
        .environment(store)
        .task { await store.load() }
        .onChange(of: phase) { _, now in
            if now == .active { Task { await store.load() } }
        }
        .alert("שגיאה", isPresented: Binding(get: { store.trip != nil && store.error != nil },
                                            set: { if !$0 { store.error = nil } })) {
            Button("אישור", role: .cancel) {}
        } message: {
            Text(store.error ?? "")
        }
    }
}

/// Signed in but not in any trip yet: joining and creating trips stay in the web app for now
struct NoTripView: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        ContentUnavailableView {
            Label("עוד אין טיול", systemImage: "airplane")
        } description: {
            Text("מצטרפים לטיול עם קוד הטיול באתר, ואז הוא מופיע כאן.")
        } actions: {
            Link("פתיחת האתר", destination: Backend.webApp)
            Button("יציאה", role: .destructive) { Task { await auth.signOut() } }
        }
    }
}
