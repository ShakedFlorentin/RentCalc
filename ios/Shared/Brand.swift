import SwiftUI

/// The web app's one red tint (styles.css --accent): for actions and state, never for a whole surface
enum Brand {
    static let red = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 1.0, green: 0.31, blue: 0.43, alpha: 1) // #ff4f6d
            : UIColor(red: 0.83, green: 0.11, blue: 0.21, alpha: 1) // #d41c35
    })
}
