import Foundation

/// The trip runs on Japan's calendar, whatever timezone the phone is still set to (lib.ts currentDay).
enum TripCalendar {
    static let japan = TimeZone(identifier: "Asia/Tokyo")!

    static var japanCalendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = japan
        return c
    }

    /// UTC calendar: booking times are wall-clock times stored as if they were UTC
    static var wallCalendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    static let locale = Locale(identifier: "he_IL")

    /// "2026-12-12" → that day at midnight in Japan
    static func date(_ ymd: String?) -> Date? {
        guard let ymd else { return nil }
        let p = ymd.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return japanCalendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
    }

    /// The trip day (1…numDays) a moment falls on in Japan, or nil before or after the trip
    static func currentDay(start: String?, numDays: Int, now: Date = .now) -> Int? {
        guard let first = date(start) else { return nil }
        let today = japanCalendar.startOfDay(for: now)
        guard let diff = japanCalendar.dateComponents([.day], from: first, to: today).day else { return nil }
        return diff >= 0 && diff < numDays ? diff + 1 : nil
    }

    /// Whole days until the trip starts (Japan's calendar); 0 or less once it has begun
    static func daysUntil(start: String?, now: Date = .now) -> Int? {
        guard let first = date(start) else { return nil }
        return japanCalendar.dateComponents([.day], from: japanCalendar.startOfDay(for: now), to: first).day
    }

    /// The date of a trip day (day 1 = the start date), midnight in Japan
    static func dayDate(start: String?, day: Int) -> Date? {
        guard let first = date(start) else { return nil }
        return japanCalendar.date(byAdding: .day, value: day - 1, to: first)
    }

    static func ymd(_ d: Date) -> String {
        let c = japanCalendar.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// The next midnight in Japan after `now`: when "today" changes for the widgets
    static func nextJapanMidnight(after now: Date = .now) -> Date {
        let start = japanCalendar.startOfDay(for: now)
        return japanCalendar.date(byAdding: .day, value: 1, to: start)!
    }

    /// "HH:MM" on a trip day → that moment (Japan time)
    static func moment(day: Date, time: String?) -> Date? {
        guard let time else { return nil }
        let p = time.prefix(5).split(separator: ":").compactMap { Int($0) }
        guard p.count == 2 else { return nil }
        return japanCalendar.date(bySettingHour: p[0], minute: p[1], second: 0, of: day)
    }

    // MARK: - Formatting (Hebrew, Japan's calendar)

    private static func formatter(_ template: String, tz: TimeZone = japan) -> DateFormatter {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = tz
        f.setLocalizedDateFormatFromTemplate(template)
        return f
    }

    /// "יום ג׳, 15.12"
    static func shortDay(_ d: Date?) -> String {
        guard let d else { return "" }
        return formatter("EEEdM").string(from: d)
    }

    /// "יום שלישי, 15 בדצמבר": how a plan day is named; the trip's day number matters to nobody
    static func longDay(_ d: Date?) -> String {
        guard let d else { return "" }
        return formatter("EEEEdMMMM").string(from: d)
    }

    /// A booking's stored wall-clock time, shown as written: "שבת 12.12, 10:30"
    static func bookingTime(_ iso: String?) -> String {
        guard let iso, let d = isoDate(iso) else { return "" }
        let dateOnly = iso.count >= 16 && iso.dropFirst(11).prefix(5) == "00:00"
        return formatter(dateOnly ? "EEEdM" : "EEEdMHHmm", tz: TimeZone(identifier: "UTC")!).string(from: d)
    }

    static func isoDate(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        if let d = f.date(from: iso) { return d }
        // "2026-12-12T10:30:00" or "+00:00" offsets from PostgREST
        let g = DateFormatter()
        g.locale = Locale(identifier: "en_US_POSIX")
        g.timeZone = TimeZone(identifier: "UTC")
        for format in ["yyyy-MM-dd'T'HH:mm:ssXXXXX", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd"] {
            g.dateFormat = format
            if let d = g.date(from: iso) { return d }
        }
        return nil
    }

    /// The YYYY-MM-DD a booking's wall-clock time falls on
    static func bookingYMD(_ iso: String?) -> String? {
        guard let iso, iso.count >= 10 else { return nil }
        return String(iso.prefix(10))
    }

    static func daysLabel(_ n: Int) -> String {
        n == 1 ? "יום אחד" : n == 2 ? "יומיים" : "\(n) ימים"
    }
}
