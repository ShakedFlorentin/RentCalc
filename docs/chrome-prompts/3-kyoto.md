I'm planning a trip to Japan with friends and we built an app where we swipe on places. For each place below, please find real links and photos using this browser. Read only: do not like, follow, comment, save, post or message anything, and do not log in to anything new. If something needs a login or shows a captcha, skip that field.

For EACH place:
1. **Google Maps**: search the name (use the Japanese name when given) and open the correct place, matching the neighborhood. Copy the place URL from the address bar. From that URL take the exact coordinates (the numbers after "@", e.g. @35.6895,139.6917) as lat and lng.
2. **Official website** if the Maps listing shows one (otherwise the Tabelog page for restaurants/bars/cafes).
3. **Photos**: 2–3 real photos of the place itself (food, interior or the view, not maps or logos). Open the photos in Google Maps (or the Tabelog photo tab) and give the direct image URLs, the address you'd get from "Copy image address". Good hosts: lh3/lh5.googleusercontent.com, tblg.k-img.com. For googleusercontent URLs, replace the size suffix after "=" with "=w800" if there is one. Never Instagram CDN image links (they expire).
4. **Instagram**: one real post or reel that shows this place (search the place name or its location tag; prefer posts by Japanese locals). Give the post URL (instagram.com/p/... or /reel/...). null if none.
5. **TikTok**: one video showing this place (tiktok.com/@user/video/...). null if none.

Places:
1. Kikunoi Honten (菊乃井本店) — Gion / Yasaka, Kyoto
2. Nanzenji Junsei (南禅寺 順正) — Nanzen-ji, Kyoto
3. Menya Inoichi (麺屋 Inoichi) — Ebisucho / Kawaramachi, Kyoto
4. Kasagiya (かさぎ屋) — Sannenzaka, Higashiyama, Kyoto
5. Matcha Roastery (Uji) (抹茶ロースタリー) — Uji (day trip from Kyoto), Kyoto
6. GOKAGO Japanese Tea Specialty Shop (五果子 (GOKAGO)) — Kiyomizu, Kyoto
7. Nishiki Market (錦市場) — Nishiki / Teramachi, Kyoto
8. Miyako Yasai Kamo (都野菜 賀茂) — Nishiki / Kawaramachi, Kyoto
9. AWOMB Nishikiyamachi (AWOMB 錦山町) — Nishiki, Kyoto
10. Gio-ji Temple (Moss Garden) (祇王寺) — Sagano / Arashiyama, Kyoto
11. Kodai-ji Temple bamboo grove (高台寺) — Higashiyama (Gion area), Kyoto
12. Fushimi Inari Taisha (伏見稲荷大社) — Fushimi, Kyoto
13. Kiyomizu-dera Temple (清水寺) — Higashiyama, Kyoto
14. Tofuku-ji Temple (東福寺) — Higashiyama, Kyoto
15. Kurama-Kibune Mountain Hike (鞍馬・貴船 山道) — Kurama / Kibune (north of Kyoto), Kyoto
16. Kyoto Railway Museum (京都鉄道博物館) — Umekoji, Kyoto
17. Kyoto Aquarium (京都水族館) — Umekoji, Kyoto
18. Kyoto Botanical Gardens (京都府立植物園) — Shimogamo, Sakyo, Kyoto
19. Philosopher's Path (Tetsugaku-no-michi) (哲学の道) — Sakyo, Eastern Kyoto, Kyoto
20. Muromachi Wakuden (むろまちわくでん) — Karasuma Oike, Nakagyo, Kyoto
21. Tominokoji Yamagishi — Nakagyo (Tominokoji-dori), Kyoto
22. Ryori Kawaguchi — Gion Minamigawa, Kyoto
23. Kyo Kaiseki Kichisen — Gion, Kyoto
24. Jiki Miyazawa — Nakagyo (Nishiki Market area), Kyoto
25. Sake Bar Yoramu — Nakagyo (machiya bar), Kyoto

When you're done, put the results in a CSV file and download it to my computer as `japan-media-3-kyoto.csv`:
- One row per place, in the order of my list, with this exact header row:
  `name,maps_url,lat,lng,website_url,photo1,photo2,photo3,instagram_url,tiktok_url`
- `name` exactly as in my list. Leave a cell empty for anything you couldn't find. Quote every cell with double quotes (escape inner quotes by doubling them). UTF-8.
- To download it, run JavaScript in the current tab that builds the CSV text, wraps it in a Blob (type "text/csv;charset=utf-8", prefixed with "\uFEFF" so Excel keeps the Japanese), and clicks a temporary `<a download="japan-media-3-kyoto.csv">` link.
- If you can't trigger a download, show the full CSV in a single code block instead so I can save it myself.

Never guess a URL; only give links you actually opened.
