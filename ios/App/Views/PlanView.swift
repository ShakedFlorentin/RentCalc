import SwiftUI

/// Every day of the trip with our plan for it; today is scrolled to and marked
struct PlanView: View {
    @Environment(TripStore.self) private var store
    @State private var everyone = false

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    if let trip = store.trip {
                        ForEach(1...max(trip.numDays, 1), id: \.self) { day in
                            Section {
                                let items = itemsFor(day)
                                if items.isEmpty {
                                    Text("יום חופשי").foregroundStyle(.secondary)
                                }
                                ForEach(items) { item in
                                    EntryRow(time: item.time, title: item.title, category: item.category,
                                             subtitle: subtitle(item), done: item.done, rough: item.auto ?? false) {
                                        Task { await store.setDone(item, !item.done) }
                                    }
                                    .contextMenu {
                                        if let url = mapsURL(item.location ?? item.title) {
                                            Link(destination: url) { Label("פתיחה במפות", systemImage: "map") }
                                        }
                                    }
                                }
                            } header: {
                                DayHeader(trip: trip, day: day, city: store.cityName(info(day)?.city),
                                          isToday: day == store.today)
                            }
                            .id(day)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .navigationTitle("מסלול")
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Picker("של מי", selection: $everyone) {
                            Text("שלנו").tag(false)
                            Text("כולם").tag(true)
                        }
                        .pickerStyle(.segmented)
                        .fixedSize()
                    }
                }
                .refreshable { await store.load() }
                .onAppear { if let today = store.today { proxy.scrollTo(today, anchor: .top) } }
            }
        }
    }

    private func info(_ day: Int) -> DayInfo? { store.days.first { $0.day == day } }

    private func itemsFor(_ day: Int) -> [PlanItem] {
        store.items
            .filter { $0.day == day && (everyone || Who.isMine($0.who, couple: store.myCouple)) }
            .sorted { $0.sort < $1.sort }
    }

    private func subtitle(_ item: PlanItem) -> String? {
        // in "everyone", say whose an item is when it isn't the whole group's
        let whose = everyone ? item.who : nil
        return [whose, item.location].compactMap { $0 }.filter { !$0.isEmpty }.first
    }
}

struct DayHeader: View {
    let trip: Trip
    let day: Int
    let city: String?
    let isToday: Bool

    var body: some View {
        HStack {
            Text(TripCalendar.longDay(TripCalendar.dayDate(start: trip.startDate, day: day)))
            if isToday {
                Text("היום")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(.tint, in: Capsule())
                    .foregroundStyle(.white)
            }
            Spacer()
            if let city { Text(city) }
        }
        .textCase(nil)
    }
}
