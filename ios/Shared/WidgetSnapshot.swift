import Foundation

/// What the widgets show, written by the app after every load into the App Group, so the widgets need no network or
/// sign-in of their own and keep working offline in Japan. The whole trip is kept (a few KB), so the widgets roll
/// over to the next day at Japan's midnight without the app.
struct WidgetSnapshot: Codable, Equatable {
    struct Item: Codable, Equatable, Hashable {
        var time: String?
        var title: String
        var category: String
        var done: Bool
        /// a booking (flight, check-in, train) rather than a plan item
        var isBooking: Bool
    }

    struct Day: Codable, Equatable {
        var day: Int
        var city: String?
        var hotels: [String]
        var items: [Item]
    }

    var tripName: String
    var startDate: String?
    var numDays: Int
    var couple: String?
    var days: [Day]
    var savedAt: Date

    // MARK: - Reading it

    func day(_ n: Int) -> Day? { days.first { $0.day == n } }

    /// The day the widgets talk about: today during the trip, the first day before it, nil after it
    func focusDay(now: Date = .now) -> Int? {
        if let d = TripCalendar.currentDay(start: startDate, numDays: numDays, now: now) { return d }
        if let until = TripCalendar.daysUntil(start: startDate, now: now), until > 0 { return 1 }
        return nil
    }

    // MARK: - Storage

    static let fileName = "widget-snapshot.json"

    private static var url: URL? {
        let group = Bundle.main.object(forInfoDictionaryKey: "AppGroup") as? String ?? "group.com.shakedflorentin.japantrip"
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent(fileName)
    }

    static func load() -> WidgetSnapshot? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(WidgetSnapshot.self, from: data)
    }

    func save() {
        guard let url = Self.url else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try? encoder.encode(self).write(to: url, options: .atomic)
    }

    static func clear() {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }

    // MARK: - Making it

    /// Our plan for every day: our couple's items and everyone's, then the bookings that start that day, by time
    static func make(trip: Trip, couple: String?, couples: [String], days: [DayInfo], items: [PlanItem],
                     bookings: [Booking], cityName: (String?) -> String?) -> WidgetSnapshot {
        let out = (1...max(trip.numDays, 1)).map { n -> Day in
            let info = days.first { $0.day == n }
            let date = TripCalendar.dayDate(start: trip.startDate, day: n).map(TripCalendar.ymd)
            let own = items
                .filter { $0.day == n && Who.isMine($0.who, couple: couple) }
                .sorted { $0.sort < $1.sort }
                .map { Item(time: $0.time, title: $0.title, category: $0.category, done: $0.done, isBooking: false) }
            let booked = bookings
                .filter { date != nil && TripCalendar.bookingYMD($0.startsAt) == date && Who.isMine($0.who, couple: couple) }
                .map { b in
                    Item(time: b.startsAt.flatMap(timeOf), title: b.title, category: b.kind, done: false, isBooking: true)
                }
            return Day(day: n, city: cityName(info?.city),
                       hotels: Who.hotels(info?.hotel, couple: couple, couples: couples),
                       items: byTime(own + booked))
        }
        return WidgetSnapshot(tripName: trip.name, startDate: trip.startDate, numDays: trip.numDays,
                              couple: couple, days: out, savedAt: .now)
    }

    /// "2026-12-12T10:30:00+00:00" → "10:30"; a date with no time (midnight) has none
    private static func timeOf(_ iso: String) -> String? {
        guard iso.count >= 16 else { return nil }
        let t = String(iso.dropFirst(11).prefix(5))
        return t == "00:00" ? nil : t
    }

    /// Timed entries in time order; untimed ones keep their place after the timed one before them (planUtils byEntryTime)
    static func byTime(_ items: [Item]) -> [Item] {
        let timed = items.filter { $0.time != nil }.sorted { $0.time! < $1.time! }
        var result: [Item] = []
        var queue = timed[...]
        for item in items {
            if item.time == nil {
                result.append(item)
            } else if let next = queue.popFirst() {
                result.append(next)
            }
        }
        return result
    }
}
