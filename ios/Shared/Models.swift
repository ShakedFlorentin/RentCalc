import Foundation

// The rows the app reads, as the web app keeps them in Supabase (src/types.ts). Dates stay strings
// ("YYYY-MM-DD", or ISO times saved as wall-clock time) and are read through TripCalendar.

struct Trip: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var startDate: String?
    var numDays: Int
    var joinCode: String

    enum CodingKeys: String, CodingKey {
        case id, name
        case startDate = "start_date"
        case numDays = "num_days"
        case joinCode = "join_code"
    }
}

struct Member: Codable, Hashable {
    let tripId: String
    let userId: String
    var displayName: String
    /// the couple this person belongs to ("שקד ומאור"); plans and bookings for a couple carry it in `who`
    var couple: String?

    enum CodingKeys: String, CodingKey {
        case tripId = "trip_id"
        case userId = "user_id"
        case displayName = "display_name"
        case couple
    }
}

struct DayInfo: Codable, Hashable {
    let tripId: String
    let day: Int
    var city: String?
    /// one line per couple ("שקד ומאור: Hotel X"), or one line for everyone
    var hotel: String?
    var notes: String?
    /// who is in Japan that day; nil means the whole group
    var who: String?

    enum CodingKeys: String, CodingKey {
        case tripId = "trip_id"
        case day, city, hotel, notes, who
    }
}

struct PlanItem: Codable, Identifiable, Hashable {
    let id: String
    let tripId: String
    var day: Int
    /// "HH:MM", Japan time
    var time: String?
    var title: String
    var location: String?
    var notes: String?
    var category: String
    var done: Bool
    var sort: Double
    var placeId: String?
    var who: String?
    /// put there by the planner and not touched since: the time is a rough guess
    var auto: Bool?

    enum CodingKeys: String, CodingKey {
        case id, day, time, title, location, notes, category, done, sort, who, auto
        case tripId = "trip_id"
        case placeId = "place_id"
    }
}

struct Booking: Codable, Identifiable, Hashable {
    let id: String
    let tripId: String
    var kind: String
    var title: String
    /// wall-clock time at the booking's place, saved as if it were UTC (see lib.ts fmtDateTime)
    var startsAt: String?
    var endsAt: String?
    var confirmation: String?
    var location: String?
    var url: String?
    var notes: String?
    var who: String?

    enum CodingKeys: String, CodingKey {
        case id, kind, title, confirmation, location, url, notes, who
        case tripId = "trip_id"
        case startsAt = "starts_at"
        case endsAt = "ends_at"
    }
}

struct Place: Codable, Identifiable, Hashable {
    let id: String
    let tripId: String
    var city: String?
    var name: String
    var category: String
    var url: String?
    var notes: String?
    var visited: Bool
    var area: String?
    var lat: Double?
    var lng: Double?
    var who: String?

    enum CodingKeys: String, CodingKey {
        case id, city, name, category, url, notes, visited, area, lat, lng, who
        case tripId = "trip_id"
    }
}

struct City: Codable, Identifiable, Hashable {
    let id: String
    var nameHe: String
    var nameEn: String

    enum CodingKeys: String, CodingKey {
        case id
        case nameHe = "name_he"
        case nameEn = "name_en"
    }
}

// MARK: - Labels

enum Labels {
    /// the fixed city ids from before the cities table (types.ts CITY_HE)
    static let cityHe: [String: String] = [
        "tokyo": "טוקיו", "kyoto": "קיוטו", "osaka": "אוסקה", "nara": "נארה", "daytrip": "טיולי יום",
    ]

    static let bookingKinds: [String: String] = [
        "flight": "טיסות", "hotel": "מלונות", "restaurant": "מסעדות", "activity": "אטרקציות",
        "train": "רכבות", "insurance": "ביטוח", "other": "אחר",
    ]
    static let bookingOrder = ["flight", "hotel", "train", "restaurant", "activity", "insurance", "other"]

    static let placeCategories: [String: String] = [
        "food": "אוכל", "cafe": "קפה וקינוחים", "sight": "אטרקציה", "shopping": "קניות",
        "nightlife": "חיי לילה", "experience": "פעילות", "transport": "תחבורה", "other": "אחר",
    ]

    /// SF Symbols in place of the web app's Lucide icons
    static func symbol(for category: String) -> String {
        switch category {
        case "food": "fork.knife"
        case "cafe": "cup.and.saucer.fill"
        case "sight": "building.columns.fill"
        case "shopping": "bag.fill"
        case "nightlife": "wineglass.fill"
        case "experience": "sparkles"
        case "transport", "train": "tram.fill"
        case "flight": "airplane"
        case "hotel": "bed.double.fill"
        case "restaurant": "fork.knife"
        case "activity": "ticket.fill"
        case "insurance": "cross.case.fill"
        default: "mappin"
        }
    }
}

// MARK: - Whose is it

enum Who {
    /// shown in "ours": everyone's, or our couple's
    static func isMine(_ who: String?, couple: String?) -> Bool {
        guard let who, !who.isEmpty else { return true }
        return who == couple
    }

    /// A day_info.hotel text, one line per couple ("שקד ומאור: Hotel X") or one for everyone: the lines that are ours,
    /// without the couple prefix or the pictograph older lines start with (planUtils.ts hotelLines).
    static func hotels(_ text: String?, couple: String?, couples: [String]) -> [String] {
        (text ?? "")
            .split(separator: "\n")
            .map { stripMarker(String($0).trimmingCharacters(in: .whitespaces)) }
            .filter { !$0.isEmpty }
            .compactMap { line in
                for c in couples where line.hasPrefix(c + ":") {
                    guard c == couple else { return nil }
                    return line.dropFirst(c.count + 1).trimmingCharacters(in: .whitespaces)
                }
                return line
            }
    }

    /// a pictograph, not a digit or # (which Unicode also counts as emoji)
    private static func isPictograph(_ s: Unicode.Scalar) -> Bool {
        s.properties.isEmojiPresentation || (s.properties.isEmoji && s.value > 0x2000) || s == "\u{FE0F}"
    }

    private static func stripMarker(_ line: String) -> String {
        guard let first = line.unicodeScalars.first, isPictograph(first) else { return line }
        return String(String.UnicodeScalarView(line.unicodeScalars.drop(while: isPictograph)))
            .trimmingCharacters(in: .whitespaces)
    }
}
