import SwiftUI
import WidgetKit

@main
struct TripWidgets: WidgetBundle {
    var body: some Widget {
        CountdownWidget()
        TodayWidget()
    }
}

// MARK: - Timeline

struct TripEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

/// Entries at every planned time today (so "next" moves on) and at Japan's midnight (so the day turns over)
struct TripProvider: TimelineProvider {
    func placeholder(in context: Context) -> TripEntry { TripEntry(date: .now, snapshot: .preview) }

    func getSnapshot(in context: Context, completion: @escaping (TripEntry) -> Void) {
        completion(TripEntry(date: .now, snapshot: context.isPreview ? (WidgetSnapshot.load() ?? .preview) : WidgetSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TripEntry>) -> Void) {
        let snapshot = WidgetSnapshot.load()
        let now = Date.now
        let midnight = TripCalendar.nextJapanMidnight(after: now)
        var moments: [Date] = [now]
        if let s = snapshot, let focus = s.focusDay(now: now), let day = TripCalendar.dayDate(start: s.startDate, day: focus) {
            moments += (s.day(focus)?.items ?? [])
                .compactMap { TripCalendar.moment(day: day, time: $0.time) }
                .filter { $0 > now && $0 < midnight }
        }
        moments.append(midnight)
        let entries = Array(Set(moments)).sorted().map { TripEntry(date: $0, snapshot: snapshot) }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

// MARK: - Countdown: days to go, or "day 3 of 16"

struct CountdownWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Countdown", provider: TripProvider()) { entry in
            CountdownView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("ספירה לאחור")
        .description("כמה ימים נשארו, ובזמן הטיול: איזה יום היום ובאיזו עיר.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

/// What the countdown says at a moment
struct CountdownState {
    enum Phase { case before(days: Int), during(day: Int, of: Int, city: String?), after, unknown }
    let phase: Phase

    init(_ s: WidgetSnapshot?, at date: Date) {
        guard let s else { phase = .unknown; return }
        if let d = TripCalendar.currentDay(start: s.startDate, numDays: s.numDays, now: date) {
            phase = .during(day: d, of: s.numDays, city: s.day(d)?.city)
        } else if let until = TripCalendar.daysUntil(start: s.startDate, now: date) {
            phase = until > 0 ? .before(days: until) : .after
        } else {
            phase = .unknown
        }
    }
}

struct CountdownView: View {
    let entry: TripEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let state = CountdownState(entry.snapshot, at: entry.date)
        switch family {
        case .accessoryInline:
            inline(state)
        case .accessoryCircular:
            circular(state)
        case .accessoryRectangular:
            rectangular(state)
        default:
            small(state)
        }
    }

    private func inline(_ state: CountdownState) -> Text {
        switch state.phase {
        case .before(let days): Text(days == 1 ? "יפן מחר" : "עוד \(days) ימים ליפן")
        case .during(let day, _, let city): Text(city.map { "יום \(day), \($0)" } ?? "יום \(day) ביפן")
        case .after: Text("חזרנו מיפן")
        case .unknown: Text("יפן")
        }
    }

    @ViewBuilder private func circular(_ state: CountdownState) -> some View {
        switch state.phase {
        case .before(let days):
            VStack(spacing: 0) {
                Text("\(days)").font(.title2.bold().monospacedDigit()).minimumScaleFactor(0.6)
                Text("ימים").font(.caption2)
            }
        case .during(let day, let of, _):
            Gauge(value: Double(day), in: 1...Double(max(of, 2))) {
                Text("יום")
            } currentValueLabel: {
                Text("\(day)").monospacedDigit()
            }
            .gaugeStyle(.accessoryCircularCapacity)
        case .after, .unknown:
            Image(systemName: "airplane")
        }
    }

    @ViewBuilder private func rectangular(_ state: CountdownState) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(entry.snapshot?.tripName ?? "יפן").font(.headline).widgetAccentable()
            switch state.phase {
            case .before(let days):
                Text(days == 1 ? "מחר!" : "עוד \(days) ימים")
            case .during(let day, let of, let city):
                Text("יום \(day) מתוך \(of)")
                if let city { Text(city).foregroundStyle(.secondary) }
            case .after:
                Text("חזרנו")
            case .unknown:
                Text("פותחים את האפליקציה פעם אחת").foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func small(_ state: CountdownState) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(entry.snapshot?.tripName ?? "יפן")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Brand.red)
            Spacer(minLength: 0)
            switch state.phase {
            case .before(let days):
                Text(days == 1 ? "מחר" : "\(days)")
                    .font(.system(size: 52, weight: .bold, design: .rounded).monospacedDigit())
                    .minimumScaleFactor(0.5)
                Text(days == 1 ? "טסים!" : "ימים לטיסה").font(.subheadline).foregroundStyle(.secondary)
            case .during(let day, let of, let city):
                Text("יום \(day)")
                    .font(.system(size: 40, weight: .bold, design: .rounded).monospacedDigit())
                    .minimumScaleFactor(0.5)
                Text(city ?? "מתוך \(of)").font(.subheadline).foregroundStyle(.secondary)
            case .after:
                Text("חזרנו").font(.system(size: 34, weight: .bold, design: .rounded))
            case .unknown:
                Text("פותחים את האפליקציה פעם אחת").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// MARK: - Today's plan

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Today", provider: TripProvider()) { entry in
            TodayView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("התוכנית של היום")
        .description("מה עכשיו ומה הבא בתור, המלון של הלילה. לפני הטיול: היום הראשון.")
        .supportedFamilies([.systemMedium, .systemLarge, .accessoryRectangular])
    }
}

struct TodayView: View {
    let entry: TripEntry
    @Environment(\.widgetFamily) private var family

    private var focus: Int? { entry.snapshot?.focusDay(now: entry.date) }
    private var day: WidgetSnapshot.Day? { focus.flatMap { entry.snapshot?.day($0) } }

    /// what is next: the first item not done whose time hasn't passed (or with no time), during the trip;
    /// before the trip, simply the first
    private var nextIndex: Int? {
        guard let s = entry.snapshot, let focus, let items = day?.items, !items.isEmpty else { return nil }
        guard TripCalendar.currentDay(start: s.startDate, numDays: s.numDays, now: entry.date) != nil,
              let date = TripCalendar.dayDate(start: s.startDate, day: focus) else { return 0 }
        return items.firstIndex { item in
            guard !item.done else { return false }
            guard let at = TripCalendar.moment(day: date, time: item.time) else { return true }
            // still "next" for an hour after it starts
            return at.addingTimeInterval(3600) > entry.date
        }
    }

    var body: some View {
        if entry.snapshot == nil {
            Text("פותחים את האפליקציה פעם אחת, והתוכנית מופיעה כאן.")
                .font(.footnote).foregroundStyle(.secondary)
        } else if focus == nil {
            Text("הטיול נגמר. איזה טיול!").font(.headline)
        } else if family == .accessoryRectangular {
            lockScreen
        } else {
            board
        }
    }

    private var lockScreen: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let i = nextIndex, let item = day?.items[i] {
                Text(item.time ?? "הבא").font(.headline.monospacedDigit()).widgetAccentable()
                Text(item.title).lineLimit(2)
            } else {
                Text("סיימנו להיום").font(.headline).widgetAccentable()
                if let hotel = day?.hotels.first { Text(hotel).lineLimit(2) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var board: some View {
        let items = day?.items ?? []
        let limit = family == .systemLarge ? 9 : 3
        // start a line before "next", so what just happened stays in view
        let start = max(0, min((nextIndex ?? items.count) - 1, items.count - limit))
        let shown = Array(items.enumerated()).dropFirst(start).prefix(limit)

        return VStack(alignment: .leading, spacing: family == .systemLarge ? 8 : 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.headline).foregroundStyle(Brand.red)
                Spacer()
                if let city = day?.city { Text(city).font(.subheadline).foregroundStyle(.secondary) }
            }
            if items.isEmpty {
                Text("יום חופשי").foregroundStyle(.secondary)
            }
            ForEach(shown, id: \.offset) { pair in
                ItemLine(item: pair.element, isNext: pair.offset == nextIndex)
            }
            Spacer(minLength: 0)
            if family == .systemLarge, let hotel = day?.hotels.first {
                Label(hotel, systemImage: "bed.double.fill")
                    .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            } else if items.count > shown.count {
                Text("ועוד \(items.count - shown.count)").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var title: String {
        guard let s = entry.snapshot, let focus else { return "" }
        if TripCalendar.currentDay(start: s.startDate, numDays: s.numDays, now: entry.date) != nil { return "היום" }
        let days = TripCalendar.daysUntil(start: s.startDate, now: entry.date) ?? 0
        return focus == 1 && days > 0 ? (days == 1 ? "מחר" : "היום הראשון, בעוד \(days) ימים") : "היום"
    }
}

struct ItemLine: View {
    let item: WidgetSnapshot.Item
    let isNext: Bool

    var body: some View {
        HStack(spacing: 8) {
            Text(item.time ?? "")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 38, alignment: .leading)
            Image(systemName: Labels.symbol(for: item.category))
                .font(.caption)
                .foregroundStyle(isNext ? Brand.red : .secondary)
                .frame(width: 16)
            Text(item.title)
                .font(.subheadline.weight(isNext ? .semibold : .regular))
                .strikethrough(item.done)
                .foregroundStyle(item.done ? .secondary : .primary)
                .lineLimit(1)
        }
    }
}

// MARK: - Preview data (the widget gallery, before the app has run)

extension WidgetSnapshot {
    static var preview: WidgetSnapshot {
        WidgetSnapshot(
            tripName: "יפן", startDate: "2026-12-12", numDays: 16, couple: nil,
            days: [Day(day: 1, city: "טוקיו", hotels: ["Hotel Gracery Shinjuku"], items: [
                Item(time: "07:40", title: "נחיתה בנריטה", category: "flight", done: false, isBooking: true),
                Item(time: "11:00", title: "Narita Express לשינג׳וקו", category: "train", done: false, isBooking: false),
                Item(time: "13:00", title: "Ichiran Ramen", category: "food", done: false, isBooking: false),
                Item(time: "16:00", title: "Shinjuku Gyoen", category: "sight", done: false, isBooking: false),
            ])],
            savedAt: .now)
    }
}
