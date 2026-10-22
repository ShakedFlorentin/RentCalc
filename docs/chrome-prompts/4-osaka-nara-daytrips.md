I'm planning a trip to Japan with friends and we built an app where we swipe on places. For each place below, please find real links and photos using this browser. Read only: do not like, follow, comment, save, post or message anything, and do not log in to anything new. If something needs a login or shows a captcha, skip that field.

For EACH place:
1. **Google Maps**: search the name (use the Japanese name when given) and open the correct place, matching the neighborhood. Copy the place URL from the address bar. From that URL take the exact coordinates (the numbers after "@", e.g. @35.6895,139.6917) as lat and lng.
2. **Official website** if the Maps listing shows one (otherwise the Tabelog page for restaurants/bars/cafes).
3. **Photos**: 2–3 real photos of the place itself (food, interior or the view, not maps or logos). Open the photos in Google Maps (or the Tabelog photo tab) and give the direct image URLs, the address you'd get from "Copy image address". Good hosts: lh3/lh5.googleusercontent.com, tblg.k-img.com. For googleusercontent URLs, replace the size suffix after "=" with "=w800" if there is one. Never Instagram CDN image links (they expire).
4. **Instagram**: one real post or reel that shows this place (search the place name or its location tag; prefer posts by Japanese locals). Give the post URL (instagram.com/p/... or /reel/...). null if none.
5. **TikTok**: one video showing this place (tiktok.com/@user/video/...). null if none.

Places:
1. Shoju-in (Shojuin) Temple (聚光院) — Ujitawara (near Uji), Daytrip
2. Ajinoya (Dotonbori) — Dotonbori (small alley one block off the main strip), Osaka
3. Abeno Takoyaki Yamachan (Main Store) — Abeno / Tennoji, Osaka
4. Ganso Kushikatsu Daruma Shinsekai Sohonten (串かつだるま 新世界総本店) — Shinsekai, Osaka
5. Gyukatsu Motomura (Namba Annex) (牛かつ もとむら) — Namba, Osaka
6. Osaka Kizu Market (木津市場) — Kizu (Naniwa / Nishinari area), Osaka
7. Tenma backstreet izakaya alleys (behind Tenmangu) — Tenma (behind Tenmangu Shrine), Osaka
8. Tsuruhashi Korean yakiniku alleys (鶴橋) — Tsuruhashi (Ikuno-ku), Osaka
9. Hozenji Yokocho (法善寺横丁) — Namba / Dotonbori, Osaka
10. Okonomiyaki Mizuno — Namba / Dotonbori, Osaka
11. Misono Building (Ura Namba hidden bars) — Ura Namba, Osaka
12. Jan Jan Yokocho (じゃんじゃん横丁) — Shinsekai, Osaka
13. Tsutenkaku Tower (通天閣) — Shinsekai, Osaka
14. Abeno Harukas 300 Observatory (あべのハルカス300) — Abeno, Osaka
15. Umeda Sky Building Floating Garden Observatory (梅田スカイビル 空中庭園展望台) — Umeda, Osaka
16. Taiyo no Tou cafe — Nakazakicho, Osaka
17. Nakatanidou (中谷堂) — Naramachi / Hashimotocho, Nara
18. Hiraso (Kakinohazushi Hiraso Nara branch) (柿の葉ずし 平宗 奈良店) — Nara city centre, Nara
19. Wakakusa Cafe — Nara Park, Nara
20. Nakamura Tokichi Honten Uji Main Store (中村藤吉本店) — Uji, Daytrip
21. Tsuen Tea (Tsuen) (通圓) — Uji, Daytrip
22. Owakudani (black eggs and valley) (大涌谷) — Hakone, Daytrip
23. Kikukawa Shoten (Castella-yaki Hakone Manju) (菊川商店) — Hakone-Yumoto, Daytrip
24. Lake Shoji (Fuji Five Lakes) (精進湖) — Fuji Five Lakes, Daytrip
25. Himeji Castle (姫路城) — Himeji, Daytrip
26. Nikko Yubamaki Zen (湯波巻 膳) — Nikko, near Shinkyo Bridge, Daytrip
27. Kaiyukan Aquarium (海遊館) — Osaka Bay (Tempozan, Minato-ku), Osaka
28. Expo '70 Commemorative Park (万博記念公園) — Suita (north of Osaka), Osaka
29. National Museum of Art, Osaka (国立国際美術館) — Nakanoshima, Osaka
30. Sushi Minoki — Kitashinchi (Sonezaki Shinchi, Kita Ward), Osaka
31. BAR K — Sonezakishinchi (Kitashinchi), Osaka
32. Craftroom — Umeda, Osaka

When you're done, put the results in a CSV file and download it to my computer as `japan-media-4-osaka-nara-daytrips.csv`:
- One row per place, in the order of my list, with this exact header row:
  `name,maps_url,lat,lng,website_url,photo1,photo2,photo3,instagram_url,tiktok_url`
- `name` exactly as in my list. Leave a cell empty for anything you couldn't find. Quote every cell with double quotes (escape inner quotes by doubling them). UTF-8.
- To download it, run JavaScript in the current tab that builds the CSV text, wraps it in a Blob (type "text/csv;charset=utf-8", prefixed with "\uFEFF" so Excel keeps the Japanese), and clicks a temporary `<a download="japan-media-4-osaka-nara-daytrips.csv">` link.
- If you can't trigger a download, show the full CSV in a single code block instead so I can save it myself.

Never guess a URL; only give links you actually opened.
