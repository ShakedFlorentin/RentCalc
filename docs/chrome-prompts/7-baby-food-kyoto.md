I'm planning a trip to Kyoto with friends; one couple brings their 5-month-old baby. Please find excellent restaurants in Kyoto that Japanese locals rate highly AND that genuinely welcome a baby, using Tabelog in Japanese (tabelog.com, not the English site) in this browser. Read only: do not log in, like, save, review, book or message anything. If a page needs a login or shows a captcha, skip it.

How to search:
1. On tabelog.com, search 京都, area by area: 四条・河原町 / 祇園・東山 / 京都駅周辺 / 嵐山.
2. Use Tabelog's filters (こだわり条件): 子供可 or お子様連れ歓迎, 個室あり, and where available 座敷あり / ベビーカー入店可 / 禁煙. Sort by ranking (ランキング).
3. Keep only restaurants with a Tabelog score of 3.50 or higher. Prefer ones that are 百名店 or have many reviews (300+).
4. Open each candidate's page and check the 席・設備 section: 個室 (private room), 座敷 (tatami), 子供 (children policy: 子供可, 乳児可, ベビーカー入店可), 禁煙・喫煙. Skip anything that says 子供不可, is smoking (喫煙可), or only has counter seats.
5. Prefer a mix: sushi, tempura, unagi, kaiseki/washoku, yakiniku/wagyu, tonkatsu, udon/soba, and a couple of good cafes/sweets.
6. Aim for 12–15 restaurants in total. Fewer is fine; never include a weak one just to reach the number.

For each restaurant also open it on Google Maps (search the Japanese name) to get the place URL and the exact coordinates (the numbers after "@" in the URL), and the Google rating if shown. Grab 2–3 photo URLs ("Copy image address" on Tabelog photos, tblg.k-img.com, or Google Maps photos, lh*.googleusercontent.com, change the size suffix to =w800), and one Instagram post/reel or TikTok video of the place if you can find one.

When you're done, put the results in a CSV file and download it as `japan-baby-food-kyoto.csv` with this exact header row:
`name,name_ja,area,category,tabelog_score,tabelog_reviews,google_score,price,baby_facilities,why_locals_love_it,tip,tabelog_url,maps_url,lat,lng,website_url,photo1,photo2,photo3,instagram_url,tiktok_url`
- `name` in romaji/English, `name_ja` exactly as on Tabelog
- `category`: food or cafe
- `price`: Tabelog's lunch/dinner budget band
- `baby_facilities`: in English, exactly what the page says (e.g. "private room for 4, tatami, children welcome, strollers OK, non-smoking")
- `why_locals_love_it` and `tip`: one short English sentence each, based on what you read (百名店, signature dish, booking advice)
- Quote every cell with double quotes (double any inner quotes); leave unknown cells empty; UTF-8.
- To download: run JavaScript in the current tab that builds the CSV text, wraps it in a Blob ("text/csv;charset=utf-8", prefixed with "\uFEFF" so the Japanese survives Excel), and clicks a temporary <a download="japan-baby-food-kyoto.csv"> link. If you can't trigger a download, show the full CSV in one code block instead.

Never guess a score or a URL; only use what you actually saw.
