import SwiftUI

/// The trip's code, the widgets, and the parts that still live in the web app
struct MoreView: View {
    @Environment(TripStore.self) private var store
    @Environment(AuthStore.self) private var auth
    @State private var copied = false

    var body: some View {
        NavigationStack {
            List {
                if let trip = store.trip {
                    Section {
                        Button {
                            UIPasteboard.general.string = trip.joinCode
                            copied = true
                        } label: {
                            LabeledContent("קוד הטיול") {
                                HStack {
                                    Text(trip.joinCode).font(.body.monospaced())
                                        .environment(\.layoutDirection, .leftToRight)
                                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                                }
                            }
                        }
                        .foregroundStyle(.primary)
                        .sensoryFeedback(.success, trigger: copied)
                        if let couple = store.myCouple { LabeledContent("אנחנו", value: couple) }
                        LabeledContent("בטיול", value: store.members.map(\.displayName).joined(separator: ", "))
                    } header: {
                        Text(trip.name)
                    }
                }

                Section {
                    Label("לוחצים לחיצה ארוכה על מסך הבית, אחר כך על +, ומחפשים ״יפן״. יש ספירה לאחור והתוכנית של היום, גם למסך הנעילה.",
                          systemImage: "square.text.square")
                        .font(.subheadline)
                } header: {
                    Text("וידג׳טים")
                }

                Section {
                    Link(destination: Backend.webApp) { Label("גילוי, הוצאות, רשימות ומתרגם", systemImage: "safari") }
                } header: {
                    Text("באתר בינתיים")
                } footer: {
                    Text("המסכים האלה עוברים לאפליקציה בשלב הבא.")
                }

                Section {
                    Button("יציאה", role: .destructive) { Task { await auth.signOut() } }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("עוד")
        }
    }
}
