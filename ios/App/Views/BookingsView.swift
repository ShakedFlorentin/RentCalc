import SwiftUI

/// Flights, hotels, trains and tickets, by kind and then by date; whose each one is
struct BookingsView: View {
    @Environment(TripStore.self) private var store

    var body: some View {
        NavigationStack {
            List {
                if store.bookings.isEmpty {
                    ContentUnavailableView("עוד אין הזמנות", systemImage: "ticket",
                                           description: Text("מוסיפים הזמנות באתר, והן מופיעות כאן."))
                }
                ForEach(kinds, id: \.self) { kind in
                    Section(Labels.bookingKinds[kind] ?? kind) {
                        ForEach(store.bookings.filter { $0.kind == kind }) { b in
                            NavigationLink(value: b) { BookingRow(booking: b) }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("הזמנות")
            .navigationDestination(for: Booking.self) { BookingDetail(booking: $0) }
            .refreshable { await store.load() }
        }
    }

    private var kinds: [String] {
        let present = Set(store.bookings.map(\.kind))
        return Labels.bookingOrder.filter(present.contains) + present.subtracting(Labels.bookingOrder).sorted()
    }
}

struct BookingRow: View {
    let booking: Booking

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(booking.title, systemImage: Labels.symbol(for: booking.kind))
                .labelStyle(TintedIconLabel())
            HStack(spacing: 6) {
                Text(TripCalendar.bookingTime(booking.startsAt))
                if let end = booking.endsAt {
                    Image(systemName: "arrow.left")
                    Text(TripCalendar.bookingTime(end))
                }
            }
            .font(.footnote).foregroundStyle(.secondary)
            if let who = booking.who, !who.isEmpty {
                Text(who).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

struct BookingDetail: View {
    let booking: Booking
    @State private var copied = false

    var body: some View {
        List {
            Section {
                LabeledContent("מתי", value: TripCalendar.bookingTime(booking.startsAt))
                if let end = booking.endsAt { LabeledContent("עד", value: TripCalendar.bookingTime(end)) }
                if let who = booking.who, !who.isEmpty { LabeledContent("של", value: who) }
            }
            if let code = booking.confirmation, !code.isEmpty {
                Section("מספר אישור") {
                    Button {
                        UIPasteboard.general.string = code
                        copied = true
                    } label: {
                        HStack {
                            Text(code).font(.title3.monospaced()).foregroundStyle(.primary)
                                .environment(\.layoutDirection, .leftToRight)
                            Spacer()
                            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        }
                    }
                    .sensoryFeedback(.success, trigger: copied)
                }
            }
            if let location = booking.location, !location.isEmpty {
                Section("מקום") {
                    if let url = mapsURL(location) {
                        Link(destination: url) { Label(location, systemImage: "map") }
                    } else {
                        Text(location)
                    }
                }
            }
            if let notes = booking.notes, !notes.isEmpty {
                Section("הערות") { Text(notes) }
            }
            if let url = safeURL(booking.url) {
                Section { Link(destination: url) { Label("פתיחת ההזמנה", systemImage: "safari") } }
            }
        }
        .navigationTitle(booking.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// An SF Symbol in the accent colour beside ordinary text
struct TintedIconLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) {
            configuration.icon.foregroundStyle(.tint)
            configuration.title
        }
    }
}
