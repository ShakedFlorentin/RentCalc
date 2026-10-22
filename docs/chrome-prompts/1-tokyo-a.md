I'm planning a trip to Japan with friends and we built an app where we swipe on places. For each place below, please find real links and photos using this browser. Read only: do not like, follow, comment, save, post or message anything, and do not log in to anything new. If something needs a login or shows a captcha, skip that field.

For EACH place:
1. **Google Maps**: search the name (use the Japanese name when given) and open the correct place, matching the neighborhood. Copy the place URL from the address bar. From that URL take the exact coordinates (the numbers after "@", e.g. @35.6895,139.6917) as lat and lng.
2. **Official website** if the Maps listing shows one (otherwise the Tabelog page for restaurants/bars/cafes).
3. **Photos**: 2–3 real photos of the place itself (food, interior or the view, not maps or logos). Open the photos in Google Maps (or the Tabelog photo tab) and give the direct image URLs, the address you'd get from "Copy image address". Good hosts: lh3/lh5.googleusercontent.com, tblg.k-img.com. For googleusercontent URLs, replace the size suffix after "=" with "=w800" if there is one. Never Instagram CDN image links (they expire).
4. **Instagram**: one real post or reel that shows this place (search the place name or its location tag; prefer posts by Japanese locals). Give the post URL (instagram.com/p/... or /reel/...). null if none.
5. **TikTok**: one video showing this place (tiktok.com/@user/video/...). null if none.

Places:
1. Fuunji (風雲児) — Yoyogi (near Shinjuku), Tokyo
2. Tsukiji Outer Market street food crawl (築地場外市場) — Tsukiji, Tokyo
3. Omoide Yokocho (思い出横丁) — Shinjuku, Tokyo
4. Isetan Shinjuku Depachika (伊勢丹新宿店) — Shinjuku, Tokyo
5. Tokyo Station Ramen Street (東京ラーメンストリート) — Tokyo Station, Tokyo
6. Shibuya Sky (渋谷スカイ) — Shibuya, Tokyo
7. teamLab Planets TOKYO (チームラボプラネッツ) — Toyosu, Koto, Tokyo
8. Golden Gai (ゴールデン街) — Shinjuku, Tokyo
9. Kiyosumi Teien Garden (清澄庭園) — Kiyosumi, Koto, Tokyo
10. Nezu Shrine (根津神社) — Nezu, Bunkyo, Tokyo
11. Hie Shrine (日枝神社) — Nagatacho, Chiyoda, Tokyo
12. Yanaka (谷中) — Yanaka, Taito, Tokyo
13. Gotokuji Temple (豪徳寺) — Setagaya, Tokyo
14. Chidorigafuchi Greenway (千鳥ヶ淵) — Kudanshita, Chiyoda, Tokyo
15. Mori Art Museum (森美術館) — Roppongi, Minato, Tokyo
16. AFURI Ebisu — Ebisu, Tokyo
17. Marutake (Tsukiji Outer Market tamagoyaki) (丸武) — Tsukiji, Tokyo
18. Chika — Kagurazaka, Tokyo
19. Mizunara — Kagurazaka, Tokyo
20. Koenji Pal Shopping Street (高円寺パル商店街) — Koenji, Tokyo

When you're done, reply with ONLY one JSON code block, an array with one object per place in this exact shape, nothing else:
```json
[{"name": "<exactly as in my list>", "maps_url": "...", "lat": 0.0, "lng": 0.0, "website_url": "... or null", "photos": ["https://...", "https://..."], "instagram_url": "... or null", "tiktok_url": "... or null"}]
```
Use null for anything you couldn't find. Never guess a URL; only give links you actually opened.
