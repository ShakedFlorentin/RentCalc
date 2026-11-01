-- Not applied yet: run by hand in the SQL Editor.
-- Booking documents are PDFs or photos. The app refuses other files (Bookings.tsx, DOC_TYPES); this makes Storage
-- refuse them too, so an SVG or HTML file can't be stored under a booking by calling the API directly.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif'
]
where id = 'docs';
