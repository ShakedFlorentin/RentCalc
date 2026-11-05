import SwiftUI

struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("אימייל", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .environment(\.layoutDirection, .leftToRight)
                    SecureField("סיסמה", text: $password)
                        .textContentType(.password)
                        .environment(\.layoutDirection, .leftToRight)
                } footer: {
                    if let error { Text(error).foregroundStyle(.red) }
                }

                Section {
                    Button {
                        Task { await signIn() }
                    } label: {
                        HStack {
                            Text("כניסה").fontWeight(.semibold)
                            Spacer()
                            if busy { ProgressView() }
                        }
                    }
                    .disabled(busy || email.isEmpty || password.isEmpty)
                } footer: {
                    Text("נרשמים עם קישור ההזמנה באתר, ואז נכנסים כאן עם אותו אימייל וסיסמה.")
                }
            }
            .navigationTitle("הטיול ליפן")
        }
    }

    private func signIn() async {
        busy = true
        defer { busy = false }
        do {
            try await auth.signIn(email: email, password: password)
            error = nil
        } catch {
            self.error = "האימייל או הסיסמה לא נכונים, או שאין חיבור."
        }
    }
}
