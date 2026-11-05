import SwiftUI

/// Countdown before the trip, "day X" during it; today's plan, Japan's clock and the route by city
struct HomeView: View {
    @Environment(TripStore.self) private var store

    var body: some View {
        NavigationStack {
            List {
                if let trip = store.trip {
                    Section { HeaderCard(trip: trip, today: store.today, city: todayCity) }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())

                    if let focus {
                        Section {
                            if entries.isEmpty {
                                Text("עוד אין תוכנית ליום הזה").foregroundStyle(.secondary)
                            }
                            ForEach(entries) { e in
                                EntryRow(time: e.time, title: e.title, category: e.category, subtitle: e.subtitle,
                                         done: e.item?.done ?? false, rough: e.item?.auto ?? false,
                                         onToggle: e.item == nil ? nil : {
                                             if let item = e.item { Task { await store.setDone(item, !item.done) } }
                                         })
                            }
                            ForEach(hotels, id: \.self) { h in
                                Label(h, systemImage: "bed.double.fill").foregroundStyle(.secondary)
                            }
                        } header: {
                            Text(store.today == nil ? "היום הראשון" : "היום")
                        } footer: {
                            Text(TripCalendar.longDay(TripCalendar.dayDate(start: trip.startDate, day: focus)))
                        }
                    }

                    Section { JapanClockRow() }

                    if !route.isEmpty {
                        Section("המסלול") {
                            ForEach(route, id: \.from) { run in
                                HStack {
                                    Text(run.city).fontWeight(.medium)
                                    Spacer()
                                    VStack(alignment: .trailing) {
                                        Text(dates(run, trip: trip)).font(.subheadline)
                                        Text(TripCalendar.daysLabel(run.to - run.from + 1))
                                            .font(.footnote).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(store.trip?.name ?? "")
            .refreshable { await store.load() }
        }
    }

    /// today during the trip, the first day before it
    private var focus: Int? {
        guard let trip = store.trip else { return nil }
        if let d = store.today { return d }
        if let until = TripCalendar.daysUntil(start: trip.startDate), until > 0 { return 1 }
        return nil
    }

    private var todayCity: String? {
        store.today.flatMap { d in store.cityName(store.days.first { $0.day == d }?.city) }
    }

    private var hotels: [String] {
        guard let focus else { return [] }
        return Who.hotels(store.days.first { $0.day == focus }?.hotel, couple: store.myCouple, couples: store.couples)
    }

    struct Entry: Identifiable {
        let id: String
        let time: String?
        let title: String
        let category: String
        let subtitle: String?
        let item: PlanItem?
    }

    private var entries: [Entry] {
        guard let trip = store.trip, let focus else { return [] }
        let date = TripCalendar.dayDate(start: trip.startDate, day: focus).map(TripCalendar.ymd)
        let own = store.items
            .filter { $0.day == focus && Who.isMine($0.who, couple: store.myCouple) }
            .sorted { $0.sort < $1.sort }
            .map { Entry(id: $0.id, time: $0.time, title: $0.title, category: $0.category, subtitle: $0.location, item: $0) }
        let booked = store.bookings
            .filter { TripCalendar.bookingYMD($0.startsAt) == date && Who.isMine($0.who, couple: store.myCouple) }
            .map { b in
                Entry(id: b.id, time: b.startsAt.map { String($0.dropFirst(11).prefix(5)) }.flatMap { $0 == "00:00" ? nil : $0 },
                      title: b.title, category: b.kind, subtitle: b.confirmation, item: nil)
            }
        // timed entries by time; untimed ones keep their place
        let all = own + booked
        let timed = all.filter { $0.time != nil }.sorted { $0.time! < $1.time! }
        var queue = timed[...]
        return all.map { $0.time == nil ? $0 : queue.popFirst()! }
    }

    struct Run { let city: String; let from: Int; let to: Int }

    /// consecutive days in the same city, from day_info
    private var route: [Run] {
        var runs: [Run] = []
        for info in store.days.sorted(by: { $0.day < $1.day }) {
            guard let city = store.cityName(info.city) else { continue }
            if let last = runs.last, last.city == city, last.to == info.day - 1 {
                runs[runs.count - 1] = Run(city: city, from: last.from, to: info.day)
            } else {
                runs.append(Run(city: city, from: info.day, to: info.day))
            }
        }
        return runs
    }

    private func dates(_ run: Run, trip: Trip) -> String {
        let a = TripCalendar.shortDay(TripCalendar.dayDate(start: trip.startDate, day: run.from))
        guard run.to != run.from else { return a }
        return a + " – " + TripCalendar.shortDay(TripCalendar.dayDate(start: trip.startDate, day: run.to))
    }
}

/// The big line at the top: days to go, "day 3 of 16" in Tokyo, or the trip is over
struct HeaderCard: View {
    let trip: Trip
    let today: Int?
    let city: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let today {
                Text("יום \(today)").font(.system(size: 44, weight: .bold, design: .rounded))
                Text(city.map { "מתוך \(trip.numDays), ב\($0)" } ?? "מתוך \(trip.numDays)")
                    .font(.title3).foregroundStyle(.secondary)
            } else if let until = TripCalendar.daysUntil(start: trip.startDate), until > 0 {
                Text(until == 1 ? "מחר!" : "עוד \(until) ימים")
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                Text(TripCalendar.longDay(TripCalendar.date(trip.startDate)))
                    .font(.title3).foregroundStyle(.secondary)
            } else if trip.startDate == nil {
                Text("עוד אין תאריך").font(.title.bold())
            } else {
                Text("חזרנו").font(.system(size: 44, weight: .bold, design: .rounded))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 8)
    }
}

/// The time in Japan, ticking
struct JapanClockRow: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            HStack {
                Label("השעה ביפן", systemImage: "clock")
                Spacer()
                Text(ctx.date.formatted(Date.FormatStyle(timeZone: TripCalendar.japan).hour(.twoDigits(amPM: .omitted)).minute()))
                    .font(.title3.monospacedDigit().weight(.semibold))
            }
        }
    }
}
