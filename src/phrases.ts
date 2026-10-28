/** Phrase cards to show someone in Japan: big Japanese text, romaji for reading aloud, and the Hebrew meaning. */
export type Phrase = {
  id: string
  he: string
  ja: string
  romaji: string
  /** what the Japanese says, in English (shown when the app is in English) */
  en: string
  /** shown in the baby corner too */
  baby?: boolean
}

export const PHRASES: Phrase[] = [
  { id: 'toilet', en: 'Where is the toilet?', he: 'איפה השירותים?', ja: 'トイレはどこですか？', romaji: 'Toire wa doko desu ka?' }, // he-only
  { id: 'taxi', en: 'To this address, please. (show the address)', he: 'לכתובת הזו, בבקשה (מראים את הכתובת)', ja: 'この住所までお願いします。', romaji: 'Kono jūsho made onegai shimasu.' }, // he-only
  { id: 'card', en: 'Can I pay by card?', he: 'אפשר לשלם בכרטיס אשראי?', ja: 'カードで払えますか？', romaji: 'Kādo de haraemasu ka?' }, // he-only
  { id: 'table', en: 'Four adults and one baby. Do you have a table?', he: 'ארבעה מבוגרים ותינוק. יש מקום?', ja: '大人四人と赤ちゃん一人です。席はありますか？', romaji: 'Otona yonin to akachan hitori desu. Seki wa arimasu ka?' }, // he-only
  { id: 'english', en: 'Does anyone here speak English?', he: 'יש מישהו שמדבר אנגלית?', ja: '英語を話せる方はいますか？', romaji: 'Eigo o hanaseru kata wa imasu ka?' }, // he-only
  { id: 'pork', en: 'I don\'t eat pork. Do you have a dish without pork or lard?', he: 'אני לא אוכל חזיר. יש מנה בלי בשר חזיר ובלי שומן חזיר?', ja: '豚肉は食べられません。豚肉とラードを使っていない料理はありますか？', romaji: 'Butaniku wa taberaremasen. Butaniku to rādo o tsukatte inai ryōri wa arimasu ka?' }, // he-only
  { id: 'kosher', en: 'I don\'t eat pork or seafood (shrimp, squid, octopus, shellfish). Fish is fine.', he: 'אני לא אוכל חזיר ופירות ים (שרימפס, קלמרי, תמנון, צדפות). דגים זה בסדר.', ja: '豚肉と海鮮（エビ・イカ・タコ・貝）は食べられません。魚は大丈夫です。', romaji: 'Butaniku to kaisen (ebi, ika, tako, kai) wa taberaremasen. Sakana wa daijōbu desu.' }, // he-only
  { id: 'veg', en: 'I\'m vegetarian. Do you have a dish without meat, fish or fish stock (dashi)?', he: 'אוכל צמחוני בלבד. יש מנה בלי בשר, דגים ומרק דגים (דאשי)?', ja: 'ベジタリアンです。肉・魚・だしを使っていない料理はありますか？', romaji: 'Bejitarian desu. Niku, sakana, dashi o tsukatte inai ryōri wa arimasu ka?' }, // he-only
  { id: 'allergy', en: 'I have an allergy. Are there nuts in this?', he: 'יש לי אלרגיה. יש בזה אגוזים?', ja: 'アレルギーがあります。ナッツは入っていますか？', romaji: 'Arerugī ga arimasu. Nattsu wa haitte imasu ka?' }, // he-only
  { id: 'help', en: 'Help me! Please call an ambulance!', he: 'תעזרו לי! תזמינו אמבולנס!', ja: '助けてください！救急車を呼んでください！', romaji: 'Tasukete kudasai! Kyūkyūsha o yonde kudasai!' }, // he-only
  { id: 'hotwater', en: 'Could I have some hot water for the baby\'s milk?', he: 'אפשר מים חמים לחלב של התינוק?', ja: '赤ちゃんのミルク用に、お湯をいただけますか？', romaji: 'Akachan no miruku-yō ni, oyu o itadakemasu ka?', baby: true }, // he-only
  { id: 'babyroom', en: 'Is there a nursing room or baby room?', he: 'יש חדר הנקה / חדר תינוקות?', ja: '授乳室（ベビールーム）はありますか？', romaji: 'Junyūshitsu (bebī rūmu) wa arimasu ka?', baby: true }, // he-only
  { id: 'buyformula', en: 'Where can I buy formula and nappies?', he: 'איפה אפשר לקנות תמ"ל וחיתולים?', ja: '粉ミルクとおむつは、どこで買えますか？', romaji: 'Konamiruku to omutsu wa, doko de kaemasu ka?', baby: true }, // he-only
  { id: 'fever', en: 'My baby has a fever. We need a doctor.', he: 'לתינוק יש חום. צריך רופא.', ja: '赤ちゃんが熱を出しました。医者に診てもらいたいです。', romaji: 'Akachan ga netsu o dashimashita. Isha ni mite moraitai desu.', baby: true }, // he-only
]
