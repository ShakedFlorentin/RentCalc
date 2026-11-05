# Run on the Mac, in this folder.
.PHONY: config project open

# Supabase.xcconfig from the web app's .env (the same public anon key the web app ships)
config:
	sed -n -e 's|^VITE_SUPABASE_URL=https://|SUPABASE_HOST = |p' -e 's|^VITE_SUPABASE_KEY=|SUPABASE_KEY = |p' ../.env > Config/Supabase.xcconfig

project: config
	xcodegen generate

open: project
	open JapanTrip.xcodeproj
