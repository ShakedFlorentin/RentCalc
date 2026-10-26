/** Phrase cards to show someone in Japan: big Japanese text, romaji for reading aloud, and the Hebrew meaning. */
export type Phrase = {
  id: string
  he: string
  ja: string
  romaji: string
  /** shown in the baby corner too */
  baby?: boolean
}

export const PHRASES: Phrase[] = [
  { id: 'toilet', he: 'איפה השירותים?', ja: 'トイレはどこですか？', romaji: 'Toire wa doko desu ka?' },
  { id: 'taxi', he: 'לכתובת הזו, בבקשה (מראים את הכתובת)', ja: 'この住所までお願いします。', romaji: 'Kono jūsho made onegai shimasu.' },
  { id: 'card', he: 'אפשר לשלם בכרטיס אשראי?', ja: 'カードで払えますか？', romaji: 'Kādo de haraemasu ka?' },
  { id: 'table', he: 'שולחן לארבעה מבוגרים ותינוק', ja: '大人四人と赤ちゃん一人です。席はありますか？', romaji: 'Otona yonin to akachan hitori desu. Seki wa arimasu ka?' },
  { id: 'english', he: 'יש מישהו שמדבר אנגלית?', ja: '英語を話せる方はいますか？', romaji: 'Eigo o hanaseru kata wa imasu ka?' },
  { id: 'pork', he: 'אני לא אוכל חזיר. יש מנה בלי בשר חזיר ובלי שומן חזיר?', ja: '豚肉は食べられません。豚肉とラードを使っていない料理はありますか？', romaji: 'Butaniku wa taberaremasen. Butaniku to rādo o tsukatte inai ryōri wa arimasu ka?' },
  { id: 'kosher', he: 'אני לא אוכל חזיר ופירות ים (שרימפס, קלמרי, תמנון, צדפות). דגים זה בסדר.', ja: '豚肉と海鮮（エビ・イカ・タコ・貝）は食べられません。魚は大丈夫です。', romaji: 'Butaniku to kaisen (ebi, ika, tako, kai) wa taberaremasen. Sakana wa daijōbu desu.' },
  { id: 'veg', he: 'אני צמחוני/ת. יש מנה בלי בשר, דגים ומרק דגים (דאשי)?', ja: 'ベジタリアンです。肉・魚・だしを使っていない料理はありますか？', romaji: 'Bejitarian desu. Niku, sakana, dashi o tsukatte inai ryōri wa arimasu ka?' },
  { id: 'allergy', he: 'יש לי אלרגיה. יש בזה אגוזים?', ja: 'アレルギーがあります。ナッツは入っていますか？', romaji: 'Arerugī ga arimasu. Nattsu wa haitte imasu ka?' },
  { id: 'help', he: 'תעזרו לי! תזמינו אמבולנס!', ja: '助けてください！救急車を呼んでください！', romaji: 'Tasukete kudasai! Kyūkyūsha o yonde kudasai!' },
  { id: 'hotwater', he: 'אפשר מים חמים לחלב של התינוק?', ja: '赤ちゃんのミルク用に、お湯をいただけますか？', romaji: 'Akachan no miruku-yō ni, oyu o itadakemasu ka?', baby: true },
  { id: 'babyroom', he: 'יש חדר הנקה / חדר תינוקות?', ja: '授乳室（ベビールーム）はありますか？', romaji: 'Junyūshitsu (bebī rūmu) wa arimasu ka?', baby: true },
  { id: 'buyformula', he: 'איפה אפשר לקנות תמ"ל וחיתולים?', ja: '粉ミルクとおむつは、どこで買えますか？', romaji: 'Konamiruku to omutsu wa, doko de kaemasu ka?', baby: true },
  { id: 'fever', he: 'לתינוק יש חום. צריך רופא.', ja: '赤ちゃんが熱を出しました。医者に診てもらいたいです。', romaji: 'Akachan ga netsu o dashimashita. Isha ni mite moraitai desu.', baby: true },
]
