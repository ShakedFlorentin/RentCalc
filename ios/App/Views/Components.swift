import SwiftUI

/// One line of a day: a plan item (tap the circle to mark it done) or a booking that starts that day
struct EntryRow: View {
    let time: String?
    let title: String
    let category: String
    var subtitle: String? = nil
    var done: Bool = false
    var rough: Bool = false
    var onToggle: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(time ?? "")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(rough ? .tertiary : .secondary)
                .frame(width: 44, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Label {
                    Text(title)
                        .strikethrough(done)
                        .foregroundStyle(done ? .secondary : .primary)
                } icon: {
                    Image(systemName: Labels.symbol(for: category)).foregroundStyle(.tint)
                }
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            if let onToggle {
                Button(action: onToggle) {
                    Image(systemName: done ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundStyle(done ? Color.green : Color.secondary)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(done ? "בוצע" : "לא בוצע")
                .sensoryFeedback(.success, trigger: done)
            }
        }
        .padding(.vertical, 2)
    }
}

/// Opens Google Maps for a place by name (the web app's mapsUrl)
func mapsURL(_ query: String) -> URL? {
    var c = URLComponents(string: "https://www.google.com/maps/search/")!
    c.queryItems = [URLQueryItem(name: "api", value: "1"), URLQueryItem(name: "query", value: query)]
    return c.url
}

/// Only web links open (the web app's safeUrl)
func safeURL(_ s: String?) -> URL? {
    guard let s, let u = URL(string: s), ["http", "https"].contains(u.scheme?.lowercased() ?? "") else { return nil }
    return u
}
