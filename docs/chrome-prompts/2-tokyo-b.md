I'm planning a trip to Japan with friends and we built an app where we swipe on places. For each place below, please find real links and photos using this browser. Read only: do not like, follow, comment, save, post or message anything, and do not log in to anything new. If something needs a login or shows a captcha, skip that field.

For EACH place:
1. **Google Maps**: search the name (use the Japanese name when given) and open the correct place, matching the neighborhood. Copy the place URL from the address bar. From that URL take the exact coordinates (the numbers after "@", e.g. @35.6895,139.6917) as lat and lng.
2. **Official website** if the Maps listing shows one (otherwise the Tabelog page for restaurants/bars/cafes).
3. **Photos**: 2–3 real photos of the place itself (food, interior or the view, not maps or logos). Open the photos in Google Maps (or the Tabelog photo tab) and give the direct image URLs, the address you'd get from "Copy image address". Good hosts: lh3/lh5.googleusercontent.com, tblg.k-img.com. For googleusercontent URLs, replace the size suffix after "=" with "=w800" if there is one. Never Instagram CDN image links (they expire).
4. **Instagram**: one real post or reel that shows this place (search the place name or its location tag; prefer posts by Japanese locals). Give the post URL (instagram.com/p/... or /reel/...). null if none.
5. **TikTok**: one video showing this place (tiktok.com/@user/video/...). null if none.

Places:
1. Nakano Broadway (中野ブロードウェイ) — Nakano, Tokyo
2. Toujours Debuter — Gotanda, Shinagawa, Tokyo
3. TIES — Yushima, Bunkyo, Tokyo
4. Tokyo Toy Museum (東京おもちゃ美術館) — Yotsuya (Shinjuku), Tokyo
5. Shinjuku Gyoen National Garden (新宿御苑) — Shinjuku, Tokyo
6. Tokyo Metropolitan Government Building Observation Deck (東京都庁展望室) — Nishi-Shinjuku, Tokyo
7. Tokyo Sea Life Park (葛西臨海水族園) — Kasai Rinkai, Tokyo
8. Sumida Aquarium (すみだ水族館) — Oshiage (Skytree), Tokyo
9. Garden House Crafts Daikanyama (ガーデンハウスクラフツ 代官山) — Daikanyama, Tokyo
10. Tempura Osaka — Nishi-Shinbashi, Minato, Tokyo
11. Chikamine — Shibuya, Tokyo
12. Chiba Takaoka (formerly Sushi Takaoka) — Tokyo Midtown Yaesu, near Tokyo Station, Tokyo
13. Tempura Ginza Tentei (てんぷら銀座 天亭) — Ginza, Tokyo
14. Ginza Harutaka (青空 はるたか) — Ginza (listings also mention Azabu-juban, so verify), Tokyo
15. Kurogi — Shibakoen, Minato, Tokyo
16. Takiya (たきや) — Azabu-juban, Tokyo
17. Bar Benfiddich — Shinjuku, Tokyo
18. Bar Trench — Ebisu, Tokyo
19. Bar Libre — Ikebukuro (near Tokyo Metropolitan Theatre), Tokyo
20. Bar Tiaré — Akasaka, Tokyo

When you're done, put the results in a CSV file and download it to my computer as `japan-media-2-tokyo-b.csv`:
- One row per place, in the order of my list, with this exact header row:
  `name,maps_url,lat,lng,website_url,photo1,photo2,photo3,instagram_url,tiktok_url`
- `name` exactly as in my list. Leave a cell empty for anything you couldn't find. Quote every cell with double quotes (escape inner quotes by doubling them). UTF-8.
- To download it, run JavaScript in the current tab that builds the CSV text, wraps it in a Blob (type "text/csv;charset=utf-8", prefixed with "\uFEFF" so Excel keeps the Japanese), and clicks a temporary `<a download="japan-media-2-tokyo-b.csv">` link.
- If you can't trigger a download, show the full CSV in a single code block instead so I can save it myself.

Never guess a URL; only give links you actually opened.
