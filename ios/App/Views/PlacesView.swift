import SwiftUI

/// The trip's places by city: tick the ones you've been to, open any in Maps
struct PlacesView: View {
    @Environment(TripStore.self) private var store
    @State private var search = ""
    @State private var category: String? = nil

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            Chip(title: "הכל", selected: category == nil) { category = nil }
                            ForEach(categories, id: \.self) { c in
                                Chip(title: Labels.placeCategories[c] ?? c, selected: category == c) { category = c }
                            }
                        }
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))

                ForEach(groups, id: \.city) { group in
                    Section(group.city) {
                        ForEach(group.places) { p in
                            PlaceRow(place: p) { Task { await store.setVisited(p, !p.visited) } }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("מקומות")
            .searchable(text: $search, prompt: "חיפוש מקום")
            .refreshable { await store.load() }
            .overlay {
                if groups.isEmpty && !store.places.isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
        }
    }

    private var categories: [String] {
        let present = Set(store.places.map(\.category))
        return ["food", "cafe", "sight", "shopping", "experience", "nightlife", "other"].filter(present.contains)
    }

    private var groups: [(city: String, places: [Place])] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        let shown = store.places.filter { p in
            (category == nil || p.category == category)
                && (q.isEmpty || p.name.lowercased().contains(q) || (p.area ?? "").lowercased().contains(q))
        }
        let byCity = Dictionary(grouping: shown) { store.cityName($0.city) ?? "בלי עיר" }
        // the order cities come in the trip, then the rest
        let order = store.days.sorted { $0.day < $1.day }.compactMap { store.cityName($0.city) }
        let ranked = byCity.keys.sorted { (order.firstIndex(of: $0) ?? .max, $0) < (order.firstIndex(of: $1) ?? .max, $1) }
        // places not visited yet first
        return ranked.map { city in (city, byCity[city]!.sorted { !$0.visited && $1.visited }) }
    }
}

struct PlaceRow: View {
    let place: Place
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: Labels.symbol(for: place.category))
                .foregroundStyle(.tint)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(place.name)
                    .strikethrough(place.visited)
                    .foregroundStyle(place.visited ? .secondary : .primary)
                if let area = place.area, !area.isEmpty {
                    Text(area).font(.footnote).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            if let url = safeURL(place.url) ?? mapsURL([place.name, place.area].compactMap { $0 }.joined(separator: " ")) {
                Link(destination: url) { Image(systemName: "map") }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("פתיחה במפות")
            }
            Button(action: onToggle) {
                Image(systemName: place.visited ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(place.visited ? Color.green : Color.secondary)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(place.visited ? "היינו" : "עוד לא היינו")
            .sensoryFeedback(.success, trigger: place.visited)
        }
    }
}

struct Chip: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 14).padding(.vertical, 7)
                .background(selected ? AnyShapeStyle(.tint) : AnyShapeStyle(.fill.tertiary), in: Capsule())
                .foregroundStyle(selected ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
    }
}
