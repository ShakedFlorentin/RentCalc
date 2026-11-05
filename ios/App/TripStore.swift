import Foundation
import Observation
import Supabase
import WidgetKit

/// The one Supabase client, set up from Info.plist (filled from Config/Supabase.xcconfig at build time).
enum Backend {
    static let client: SupabaseClient = {
        let info = Bundle.main.infoDictionary ?? [:]
        let host = info["SupabaseHost"] as? String ?? ""
        let key = info["SupabaseKey"] as? String ?? ""
        precondition(!host.isEmpty && !key.isEmpty, "Config/Supabase.xcconfig is missing: run `make config` in ios/")
        return SupabaseClient(supabaseURL: URL(string: "https://\(host)")!, supabaseKey: key)
    }()

    static var webApp: URL {
        URL(string: Bundle.main.object(forInfoDictionaryKey: "WebAppURL") as? String ?? "https://shakedflorentin.github.io/trip-planner/")!
    }
}

/// Who is signed in. Sign-up stays in the web app (it needs an invite link).
@MainActor @Observable
final class AuthStore {
    enum State: Equatable { case loading, signedOut, signedIn(userId: String) }
    var state: State = .loading

    func start() async {
        // the first event is the session kept on the phone; an expired one that can't be refreshed for lack of
        // network still counts as signed in, so the app opens offline on the last copy
        for await (_, session) in Backend.client.auth.authStateChanges {
            state = session.map { State.signedIn(userId: $0.user.id.uuidString.lowercased()) } ?? State.signedOut
        }
    }

    func signIn(email: String, password: String) async throws {
        try await Backend.client.auth.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
    }

    func signOut() async {
        try? await Backend.client.auth.signOut()
        TripStore.forgetSavedTrip()
        WidgetSnapshot.clear()
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// One trip's rows, loaded together. The web app's live sync arrives later; for now the app reloads when it comes to
/// the front and on pull-to-refresh, and keeps the last copy on disk so it opens offline.
@MainActor @Observable
final class TripStore {
    let userId: String
    var trip: Trip?
    var members: [Member] = []
    var days: [DayInfo] = []
    var items: [PlanItem] = []
    var bookings: [Booking] = []
    var places: [Place] = []
    var cities: [City] = []
    var noTrip = false
    var error: String?
    var loading = false

    init(userId: String) {
        self.userId = userId
        restoreCache()
    }

    var myCouple: String? { members.first { $0.userId == userId }?.couple }
    var couples: [String] {
        let found = Array(Set(members.compactMap(\.couple))).sorted()
        return found.isEmpty ? ["שקד ומאור", "אלמוג ושניר"] : found
    }
    var today: Int? { trip.flatMap { TripCalendar.currentDay(start: $0.startDate, numDays: $0.numDays) } }

    func cityName(_ id: String?) -> String? {
        guard let id, !id.isEmpty else { return nil }
        return cities.first { $0.id == id }?.nameHe ?? Labels.cityHe[id] ?? id
    }

    // MARK: - Loading

    private static let tripKey = "tripId"
    static func forgetSavedTrip() { UserDefaults.standard.removeObject(forKey: tripKey) }

    func load() async {
        loading = true
        defer { loading = false }
        do {
            let db = Backend.client
            let mine: [Member] = try await db.from("members").select().eq("user_id", value: userId).execute().value
            let ids = mine.map(\.tripId)
            let saved = UserDefaults.standard.string(forKey: Self.tripKey)
            guard let tripId = saved.flatMap({ ids.contains($0) ? $0 : nil }) ?? ids.first else {
                noTrip = true
                return
            }
            UserDefaults.standard.set(tripId, forKey: Self.tripKey)

            async let trip: Trip = db.from("trips").select().eq("id", value: tripId).single().execute().value
            async let members: [Member] = db.from("members").select().eq("trip_id", value: tripId).execute().value
            async let days: [DayInfo] = db.from("day_info").select().eq("trip_id", value: tripId).order("day").execute().value
            async let items: [PlanItem] = db.from("itinerary_items").select().eq("trip_id", value: tripId).order("sort").execute().value
            async let bookings: [Booking] = db.from("bookings").select().eq("trip_id", value: tripId).order("starts_at").execute().value
            async let places: [Place] = db.from("places").select().eq("trip_id", value: tripId).order("created_at").execute().value

            let loaded = try await (trip, members, days, items, bookings, places)
            self.trip = loaded.0
            self.members = loaded.1
            self.days = loaded.2
            self.items = loaded.3
            self.bookings = loaded.4
            self.places = loaded.5
            // city names are a nicety: the fixed Hebrew names cover the trip if this table can't be read
            if let cities: [City] = try? await db.from("cities").select("id,name_he,name_en").execute().value {
                self.cities = cities
            }
            noTrip = false
            error = nil
            saveCache()
            refreshWidgets()
        } catch {
            // offline or a server hiccup: keep showing the last copy
            self.error = trip == nil ? "אין חיבור. נסו שוב כשתהיה רשת." : nil
        }
    }

    // MARK: - Changes (optimistic, like the web app)

    func setDone(_ item: PlanItem, _ done: Bool) async {
        guard let i = items.firstIndex(of: item) else { return }
        items[i].done = done
        refreshWidgets()
        do {
            try await Backend.client.from("itinerary_items").update(["done": done]).eq("id", value: item.id).execute()
            saveCache()
        } catch {
            items[i].done = !done
            refreshWidgets()
            self.error = "השינוי לא נשמר. נסו שוב."
        }
    }

    func setVisited(_ place: Place, _ visited: Bool) async {
        guard let i = places.firstIndex(of: place) else { return }
        places[i].visited = visited
        do {
            try await Backend.client.from("places").update(["visited": visited]).eq("id", value: place.id).execute()
            saveCache()
        } catch {
            places[i].visited = !visited
            self.error = "השינוי לא נשמר. נסו שוב."
        }
    }

    // MARK: - Widgets

    func refreshWidgets() {
        guard let trip else { return }
        WidgetSnapshot.make(trip: trip, couple: myCouple, couples: couples, days: days, items: items,
                            bookings: bookings, cityName: cityName).save()
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: - Offline copy

    private struct Cache: Codable {
        var trip: Trip
        var members: [Member]
        var days: [DayInfo]
        var items: [PlanItem]
        var bookings: [Booking]
        var places: [Place]
        var cities: [City]
    }

    private var cacheURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("trip-\(userId).json")
    }

    private func saveCache() {
        guard let trip else { return }
        let cache = Cache(trip: trip, members: members, days: days, items: items, bookings: bookings, places: places, cities: cities)
        try? FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONEncoder().encode(cache).write(to: cacheURL, options: .atomic)
    }

    private func restoreCache() {
        guard let data = try? Data(contentsOf: cacheURL), let c = try? JSONDecoder().decode(Cache.self, from: data) else { return }
        trip = c.trip
        members = c.members
        days = c.days
        items = c.items
        bookings = c.bookings
        places = c.places
        cities = c.cities
    }
}
