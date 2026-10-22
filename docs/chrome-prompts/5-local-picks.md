I'm planning a trip to Japan with friends and we built an app where we swipe on places. For each place below, please find real links and photos using this browser. Read only: do not like, follow, comment, save, post or message anything, and do not log in to anything new. If something needs a login or shows a captcha, skip that field.

For EACH place:
1. **Google Maps**: search the name (use the Japanese name when given) and open the correct place, matching the neighborhood. Copy the place URL from the address bar. From that URL take the exact coordinates (the numbers after "@", e.g. @35.6895,139.6917) as lat and lng.
2. **Official website** if the Maps listing shows one (otherwise the Tabelog page for restaurants/bars/cafes).
3. **Photos**: 2–3 real photos of the place itself (food, interior or the view, not maps or logos). Open the photos in Google Maps (or the Tabelog photo tab) and give the direct image URLs, the address you'd get from "Copy image address". Good hosts: lh3/lh5.googleusercontent.com, tblg.k-img.com. For googleusercontent URLs, replace the size suffix after "=" with "=w800" if there is one. Never Instagram CDN image links (they expire).
4. **Instagram**: one real post or reel that shows this place (search the place name or its location tag; prefer posts by Japanese locals). Give the post URL (instagram.com/p/... or /reel/...). null if none.
5. **TikTok**: one video showing this place (tiktok.com/@user/video/...). null if none.

Places:
1. Uchitaka (宇ち多゛) — Tateishi (Katsushika), Tokyo
2. KYOTO STAR BAR (KYOTO STAR BAR) — Pontocho (Sanjo), Kyoto
3. CHIKICHIKI Tenma (CHIKICHIKI 天満店) — Tenma, Osaka
4. Stand Age (スタンド エイジ) — Fukushima, Osaka
5. Kaisen Sosaku Kuriki (海鮮創作 くり木) — Fukushima, Osaka
6. Hakone Onsen Tsurui no Yado Shiunso (箱根温泉 鶴井の宿 紫雲荘) — Tonosawa, Hakone, Daytrip
7. Kobe Arima Onsen Motoyu Ryusenkaku (baby room-dining inn) (神戸有馬温泉 元湯龍泉閣 〜赤ちゃんも楽しめるお部屋食の宿〜) — Arima Onsen, Kobe, Daytrip
8. Arima Onsen Miyukiso Hanamusubi (baby debut plan) (御幸荘 花結び) — Arima Onsen, Kobe, Daytrip
9. Hakone Yuryo (箱根湯寮) — Tonosawa, Hakone, Daytrip
10. Arima Onsen Kin no Yu (public bath) (有馬温泉 金の湯) — Arima Onsen, Kobe, Osaka

When you're done, put the results in a CSV file and download it to my computer as `japan-media-5-local-picks.csv`:
- One row per place, in the order of my list, with this exact header row:
  `name,maps_url,lat,lng,website_url,photo1,photo2,photo3,instagram_url,tiktok_url`
- `name` exactly as in my list. Leave a cell empty for anything you couldn't find. Quote every cell with double quotes (escape inner quotes by doubling them). UTF-8.
- To download it, run JavaScript in the current tab that builds the CSV text, wraps it in a Blob (type "text/csv;charset=utf-8", prefixed with "\uFEFF" so Excel keeps the Japanese), and clicks a temporary `<a download="japan-media-5-local-picks.csv">` link.
- If you can't trigger a download, show the full CSV in a single code block instead so I can save it myself.

Never guess a URL; only give links you actually opened.
