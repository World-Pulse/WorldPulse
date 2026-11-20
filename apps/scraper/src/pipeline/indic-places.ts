/**
 * Places named in the scripts of India, Nepal and Bangladesh (Nov 20, 2026). The entity rules read English names in
 * Latin letters and the story matcher knows no country names in these scripts, so of 30,323 reports of 13 hours the
 * headlines of 5% of those in Hindi, 1% in Tamil and Bengali, 3% in Telugu and none in Nepali were linked to a named
 * person, place or organisation. These are the countries and the Indian, Nepali and Bangladeshi states and cities
 * their outlets name most, in Devanagari (Hindi, Marathi, Nepali), Bengali, Gurmukhi (Punjabi), Gujarati, Odia,
 * Tamil, Telugu, Kannada and Malayalam letters, each with its English name as the gazetteer spells it (or the newer
 * list, world-places.ts), so a report joins the entity already there.
 *
 * Hindi writes its case words apart ("भारत में"); Marathi and Nepali join them ("भारतात", "भारतको"), so a Devanagari
 * name is read whole or with one of their endings, which keeps "असमंजस" (a dilemma) from being Assam. The other
 * scripts join their endings to the name ("ভারতের", "இந்தியாவில்", "హైదరాబాద్‌లో"): a word that starts with the
 * name names the place.
 */

type Entry = [string, string]

// ── Devanagari: Hindi, Marathi, Nepali ──────────────────────────────────────
const DEVANAGARI: Entry[] = [
  ['भारत', 'India'], ['हिंदुस्तान', 'India'], ['पाकिस्तान', 'Pakistan'], ['चीन', 'China'], ['अमेरिका', 'United States'],
  ['अमरीका', 'United States'], ['रूस', 'Russia'], ['यूक्रेन', 'Ukraine'], ['युक्रेन', 'Ukraine'], ['बांग्लादेश', 'Bangladesh'],
  ['बांगलादेश', 'Bangladesh'], ['बंगलादेश', 'Bangladesh'], ['नेपाल', 'Nepal'], ['श्रीलंका', 'Sri Lanka'], ['ईरान', 'Iran'],
  ['इरान', 'Iran'], ['इज़राइल', 'Israel'], ['इजराइल', 'Israel'], ['इस्राइल', 'Israel'], ['इस्रायल', 'Israel'], ['जापान', 'Japan'],
  ['ब्रिटेन', 'United Kingdom'], ['फ्रांस', 'France'], ['जर्मनी', 'Germany'], ['अफगानिस्तान', 'Afghanistan'],
  ['अफ़ग़ानिस्तान', 'Afghanistan'], ['सऊदी अरब', 'Saudi Arabia'], ['कनाडा', 'Canada'], ['ऑस्ट्रेलिया', 'Australia'],
  ['म्यांमार', 'Myanmar'], ['भूटान', 'Bhutan'], ['मालदीव', 'Maldives'], ['इराक', 'Iraq'], ['सीरिया', 'Syria'], ['दुबई', 'Dubai'],
  ['कतर', 'Qatar'], ['क़तर', 'Qatar'], ['गाजा', 'Gaza'], ['ग़ाज़ा', 'Gaza'],
  ['उत्तर प्रदेश', 'Uttar Pradesh'], ['बिहार', 'Bihar'], ['महाराष्ट्र', 'Maharashtra'], ['राजस्थान', 'Rajasthan'],
  ['मध्य प्रदेश', 'Madhya Pradesh'], ['गुजरात', 'Gujarat'], ['पंजाब', 'Punjab'], ['हरियाणा', 'Haryana'], ['दिल्ली', 'Delhi'],
  ['कर्नाटक', 'Karnataka'], ['केरल', 'Kerala'], ['तमिलनाडु', 'Tamil Nadu'], ['आंध्र प्रदेश', 'Andhra Pradesh'],
  ['तेलंगाना', 'Telangana'], ['पश्चिम बंगाल', 'West Bengal'], ['ओडिशा', 'Odisha'], ['असम', 'Assam'], ['झारखंड', 'Jharkhand'],
  ['झारखण्ड', 'Jharkhand'], ['छत्तीसगढ़', 'Chhattisgarh'], ['उत्तराखंड', 'Uttarakhand'], ['उत्तराखण्ड', 'Uttarakhand'],
  ['हिमाचल प्रदेश', 'Himachal Pradesh'], ['जम्मू-कश्मीर', 'Jammu and Kashmir'], ['जम्मू कश्मीर', 'Jammu and Kashmir'],
  ['गोवा', 'Goa'], ['मणिपुर', 'Manipur'], ['लद्दाख', 'Ladakh'], ['त्रिपुरा', 'Tripura'],
  ['मुंबई', 'Mumbai'], ['कोलकाता', 'Kolkata'], ['चेन्नई', 'Chennai'], ['बेंगलुरु', 'Bangalore'], ['बेंगलूरु', 'Bangalore'],
  ['हैदराबाद', 'Hyderabad'], ['लखनऊ', 'Lucknow'], ['पटना', 'Patna'], ['जयपुर', 'Jaipur'], ['भोपाल', 'Bhopal'],
  ['अहमदाबाद', 'Ahmedabad'], ['पुणे', 'Pune'], ['नागपुर', 'Nagpur'], ['वाराणसी', 'Varanasi'], ['इंदौर', 'Indore'],
  ['कानपुर', 'Kanpur'], ['आगरा', 'Agra'], ['प्रयागराज', 'Prayagraj'], ['अयोध्या', 'Ayodhya'], ['चंडीगढ़', 'Chandigarh'],
  ['रांची', 'Ranchi'], ['देहरादून', 'Dehradun'], ['शिमला', 'Shimla'], ['श्रीनगर', 'Srinagar'], ['गुरुग्राम', 'Gurugram'],
  ['नोएडा', 'Noida'], ['गाजियाबाद', 'Ghaziabad'], ['मेरठ', 'Meerut'], ['नासिक', 'Nashik'], ['ठाणे', 'Thane'],
  ['औरंगाबाद', 'Aurangabad'], ['काठमांडू', 'Kathmandu'], ['काठमाडौं', 'Kathmandu'], ['काठमाडौँ', 'Kathmandu'],
  ['पोखरा', 'Pokhara'], ['ढाका', 'Dhaka'], ['लाहौर', 'Lahore'], ['कराची', 'Karachi'], ['इस्लामाबाद', 'Islamabad'],
]
// Marathi and Nepali case endings, and "-ी"/"-ीय" (of the place: "पाकिस्तानी", "भारतीय")
const DEVANAGARI_ENDINGS = ['ी', 'ीय', 'ात', 'ाचा', 'ाची', 'ाचे', 'ाच्या', 'ाला', 'ाने', 'ानं', 'मध्ये', 'त', 'ला', 'चा', 'ची',
  'चे', 'च्या', 'ने', 'को', 'मा', 'ले', 'बाट', 'सँग', 'वासी', 'वासियों']
// "चीनी" is sugar as often as Chinese
const DEVANAGARI_NOT = new Set(['चीनी'])

// ── The scripts that join their endings to the name ─────────────────────────
const JOINED: Entry[] = [
  // Bengali
  ['ভারত', 'India'], ['বাংলাদেশ', 'Bangladesh'], ['পাকিস্তান', 'Pakistan'], ['চীন', 'China'], ['যুক্তরাষ্ট্র', 'United States'],
  ['মার্কিন', 'United States'], ['আমেরিকা', 'United States'], ['রাশিয়া', 'Russia'], ['ইউক্রেন', 'Ukraine'], ['ইরান', 'Iran'],
  ['ইসরায়েল', 'Israel'], ['ইসরাইল', 'Israel'], ['জাপান', 'Japan'], ['যুক্তরাজ্য', 'United Kingdom'], ['ব্রিটেন', 'United Kingdom'],
  ['ফ্রান্স', 'France'], ['জার্মানি', 'Germany'], ['মিয়ানমার', 'Myanmar'], ['নেপাল', 'Nepal'], ['শ্রীলঙ্কা', 'Sri Lanka'],
  ['সৌদি আরব', 'Saudi Arabia'], ['আফগানিস্তান', 'Afghanistan'], ['গাজা', 'Gaza'], ['কানাডা', 'Canada'], ['অস্ট্রেলিয়া', 'Australia'],
  ['তুরস্ক', 'Turkey'], ['মালয়েশিয়া', 'Malaysia'], ['সিঙ্গাপুর', 'Singapore'], ['দুবাই', 'Dubai'], ['কাতার', 'Qatar'],
  ['ঢাকা', 'Dhaka'], ['চট্টগ্রাম', 'Chittagong'], ['সিলেট', 'Sylhet'], ['খুলনা', 'Khulna'], ['রাজশাহী', 'Rajshahi'],
  ['বরিশাল', 'Barisal'], ['রংপুর', 'Rangpur'], ['ময়মনসিংহ', 'Mymensingh'], ['কুমিল্লা', 'Comilla'], ['গাজীপুর', 'Gazipur'],
  ['নারায়ণগঞ্জ', 'Narayanganj'], ['কক্সবাজার', "Cox's Bazar"], ['কলকাতা', 'Kolkata'], ['পশ্চিমবঙ্গ', 'West Bengal'],
  ['দিল্লি', 'Delhi'], ['মুম্বাই', 'Mumbai'], ['আসাম', 'Assam'], ['ত্রিপুরা', 'Tripura'],
  // Gurmukhi (Punjabi)
  ['ਭਾਰਤ', 'India'], ['ਪਾਕਿਸਤਾਨ', 'Pakistan'], ['ਪੰਜਾਬ', 'Punjab'], ['ਅਮਰੀਕਾ', 'United States'], ['ਕੈਨੇਡਾ', 'Canada'],
  ['ਚੀਨ', 'China'], ['ਰੂਸ', 'Russia'], ['ਯੂਕਰੇਨ', 'Ukraine'], ['ਇਰਾਨ', 'Iran'], ['ਈਰਾਨ', 'Iran'], ['ਇਜ਼ਰਾਈਲ', 'Israel'],
  ['ਬ੍ਰਿਟੇਨ', 'United Kingdom'], ['ਇੰਗਲੈਂਡ', 'United Kingdom'], ['ਆਸਟ੍ਰੇਲੀਆ', 'Australia'], ['ਅਫ਼ਗਾਨਿਸਤਾਨ', 'Afghanistan'],
  ['ਅਫਗਾਨਿਸਤਾਨ', 'Afghanistan'], ['ਦਿੱਲੀ', 'Delhi'], ['ਹਰਿਆਣਾ', 'Haryana'], ['ਹਿਮਾਚਲ', 'Himachal Pradesh'],
  ['ਚੰਡੀਗੜ੍ਹ', 'Chandigarh'], ['ਅੰਮ੍ਰਿਤਸਰ', 'Amritsar'], ['ਲੁਧਿਆਣਾ', 'Ludhiana'], ['ਜਲੰਧਰ', 'Jalandhar'], ['ਪਟਿਆਲਾ', 'Patiala'],
  ['ਜੰਮੂ ਕਸ਼ਮੀਰ', 'Jammu and Kashmir'], ['ਲਾਹੌਰ', 'Lahore'],
  // Gujarati
  ['ભારત', 'India'], ['ગુજરાત', 'Gujarat'], ['અમદાવાદ', 'Ahmedabad'], ['સુરત', 'Surat'], ['વડોદરા', 'Vadodara'],
  ['રાજકોટ', 'Rajkot'], ['ગાંધીનગર', 'Gandhinagar'], ['ભાવનગર', 'Bhavnagar'], ['જામનગર', 'Jamnagar'], ['મુંબઈ', 'Mumbai'],
  ['દિલ્હી', 'Delhi'], ['મહારાષ્ટ્ર', 'Maharashtra'], ['રાજસ્થાન', 'Rajasthan'], ['પાકિસ્તાન', 'Pakistan'],
  ['અમેરિકા', 'United States'], ['ચીન', 'China'], ['રશિયા', 'Russia'], ['યુક્રેન', 'Ukraine'], ['ઈરાન', 'Iran'],
  ['ઇઝરાયલ', 'Israel'], ['બાંગ્લાદેશ', 'Bangladesh'], ['કેનેડા', 'Canada'], ['બ્રિટન', 'United Kingdom'],
  // Odia
  ['ଭାରତ', 'India'], ['ଓଡ଼ିଶା', 'Odisha'], ['ଓଡିଶା', 'Odisha'], ['ଭୁବନେଶ୍ୱର', 'Bhubaneswar'],
  ['ସମ୍ବଲପୁର', 'Sambalpur'], ['କୋଲକାତା', 'Kolkata'], ['ଦିଲ୍ଲୀ', 'Delhi'], ['ପାକିସ୍ତାନ', 'Pakistan'], ['ଆମେରିକା', 'United States'],
  ['ଚୀନ', 'China'], ['ଚାଇନା', 'China'], ['ଋଷିଆ', 'Russia'], ['ରୁଷିଆ', 'Russia'], ['ବାଂଲାଦେଶ', 'Bangladesh'],
  // Tamil ("தமிழ்நாட்ட-" and "கேரள-": the stems of their cases, "தமிழ்நாட்டில்", "கேரளத்தில்")
  ['இந்தியா', 'India'], ['இலங்கை', 'Sri Lanka'], ['தமிழ்நாடு', 'Tamil Nadu'], ['தமிழ்நாட்ட', 'Tamil Nadu'], ['தமிழகம', 'Tamil Nadu'],
  ['தமிழகத்த', 'Tamil Nadu'], ['சென்னை', 'Chennai'], ['கோவை', 'Coimbatore'], ['கோயம்புத்தூர', 'Coimbatore'], ['மதுரை', 'Madurai'],
  ['புதுச்சேரி', 'Puducherry'], ['கேரள', 'Kerala'], ['கர்நாடக', 'Karnataka'], ['பெங்களூரு', 'Bangalore'], ['டெல்லி', 'Delhi'],
  ['தில்லி', 'Delhi'], ['மும்பை', 'Mumbai'], ['அமெரிக்க', 'United States'], ['சீனா', 'China'], ['பாகிஸ்தான', 'Pakistan'],
  ['ரஷ்யா', 'Russia'], ['உக்ரைன', 'Ukraine'], ['ஈரான', 'Iran'], ['இஸ்ரேல', 'Israel'], ['ஜப்பான', 'Japan'],
  ['பிரிட்டன', 'United Kingdom'], ['இங்கிலாந்த', 'United Kingdom'], ['வங்கதேச', 'Bangladesh'], ['பங்களாதேஷ', 'Bangladesh'],
  ['யாழ்ப்பாண', 'Jaffna'], ['கொழும்ப', 'Colombo'], ['மலேசியா', 'Malaysia'], ['சிங்கப்பூர', 'Singapore'], ['காசா', 'Gaza'],
  ['ஆஸ்திரேலியா', 'Australia'], ['கனடா', 'Canada'], ['நேபாள', 'Nepal'],
  // Telugu
  ['భారత', 'India'], ['తెలంగాణ', 'Telangana'], ['ఆంధ్రప్రదేశ్', 'Andhra Pradesh'], ['హైదరాబాద్', 'Hyderabad'],
  ['విజయవాడ', 'Vijayawada'], ['విశాఖ', 'Visakhapatnam'], ['తిరుపతి', 'Tirupati'], ['వరంగల్', 'Warangal'], ['చెన్నై', 'Chennai'],
  ['బెంగళూరు', 'Bangalore'], ['ఢిల్లీ', 'Delhi'], ['ముంబై', 'Mumbai'], ['అమెరికా', 'United States'], ['చైనా', 'China'],
  ['పాకిస్తాన్', 'Pakistan'], ['పాకిస్థాన్', 'Pakistan'], ['రష్యా', 'Russia'], ['ఉక్రెయిన్', 'Ukraine'], ['ఇరాన్', 'Iran'],
  ['ఇజ్రాయెల్', 'Israel'], ['జపాన్', 'Japan'], ['బ్రిటన్', 'United Kingdom'], ['కర్ణాటక', 'Karnataka'], ['తమిళనాడు', 'Tamil Nadu'],
  ['కేరళ', 'Kerala'], ['ఒడిశా', 'Odisha'], ['మహారాష్ట్ర', 'Maharashtra'],
  // Kannada
  ['ಭಾರತ', 'India'], ['ಕರ್ನಾಟಕ', 'Karnataka'], ['ಬೆಂಗಳೂರ', 'Bangalore'], ['ಮೈಸೂರ', 'Mysuru'], ['ಮಂಗಳೂರ', 'Mangaluru'],
  ['ಬೆಳಗಾವಿ', 'Belagavi'], ['ಕಲಬುರಗಿ', 'Kalaburagi'], ['ಚೆನ್ನೈ', 'Chennai'], ['ದೆಹಲಿ', 'Delhi'], ['ಮುಂಬೈ', 'Mumbai'],
  ['ಕೇರಳ', 'Kerala'], ['ತಮಿಳುನಾಡ', 'Tamil Nadu'], ['ಮಹಾರಾಷ್ಟ್ರ', 'Maharashtra'], ['ಗೋವಾ', 'Goa'], ['ಅಮೆರಿಕ', 'United States'],
  ['ಚೀನಾ', 'China'], ['ಪಾಕಿಸ್ತಾನ', 'Pakistan'], ['ರಷ್ಯಾ', 'Russia'], ['ಉಕ್ರೇನ್', 'Ukraine'], ['ಇರಾನ್', 'Iran'], ['ಇಸ್ರೇಲ್', 'Israel'],
  ['ಜಪಾನ್', 'Japan'], ['ಬಾಂಗ್ಲಾದೇಶ', 'Bangladesh'],
  // Malayalam: a name that ends in a chillu letter ("ഇറാൻ") has its consonant before an ending ("ഇറാനിൽ"), so both
  ['ഇന്ത്യ', 'India'], ['കേരള', 'Kerala'], ['തിരുവനന്തപുര', 'Thiruvananthapuram'], ['കൊച്ചി', 'Kochi'], ['കോഴിക്കോട', 'Kozhikode'],
  ['തൃശൂർ', 'Thrissur'], ['തൃശൂര', 'Thrissur'], ['കണ്ണൂർ', 'Kannur'], ['കണ്ണൂര', 'Kannur'], ['കൊല്ലം', 'Kollam'], ['പാലക്കാട', 'Palakkad'], ['മലപ്പുറ', 'Malappuram'],
  ['ആലപ്പുഴ', 'Alappuzha'], ['ചെന്നൈ', 'Chennai'], ['ബെംഗളൂരു', 'Bangalore'], ['ഡൽഹി', 'Delhi'], ['ദില്ലി', 'Delhi'],
  ['മുംബൈ', 'Mumbai'], ['തമിഴ്നാട', 'Tamil Nadu'], ['കർണാടക', 'Karnataka'], ['അമേരിക്ക', 'United States'], ['ചൈന', 'China'],
  ['പാകിസ്താൻ', 'Pakistan'], ['പാകിസ്താന', 'Pakistan'], ['പാക്കിസ്ഥാൻ', 'Pakistan'], ['പാക്കിസ്ഥാന', 'Pakistan'], ['റഷ്യ', 'Russia'],
  ['യുക്രെയ്ൻ', 'Ukraine'], ['യുക്രെയ്ന', 'Ukraine'], ['യുക്രൈൻ', 'Ukraine'], ['യുക്രൈന', 'Ukraine'],
  ['ഇറാൻ', 'Iran'], ['ഇറാന', 'Iran'], ['ഇസ്രയേൽ', 'Israel'], ['ഇസ്രയേല', 'Israel'], ['ഇസ്രായേൽ', 'Israel'], ['ഇസ്രായേല', 'Israel'],
  ['ഗാസ', 'Gaza'], ['ദുബായ', 'Dubai'], ['സൗദി', 'Saudi Arabia'],
  ['യുഎഇ', 'United Arab Emirates'], ['ഖത്തർ', 'Qatar'], ['ഖത്തറ', 'Qatar'], ['കുവൈത്ത', 'Kuwait'], ['ഒമാൻ', 'Oman'], ['ഒമാന', 'Oman'],
]

const INDIC_LETTERS = /[ऀ-෿]/
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const byLength = (entries: Entry[]) => [...entries].sort((a, b) => b[0].length - a[0].length)
const LETTER = String.raw`[\p{L}\p{M}]`

const DEVANAGARI_NAMES = new Map(DEVANAGARI)
const DEVANAGARI_RE = new RegExp(
  String.raw`(?<!${LETTER})(${byLength(DEVANAGARI).map(e => escapeRe(e[0])).join('|')})(${DEVANAGARI_ENDINGS.sort((a, b) => b.length - a.length).map(escapeRe).join('|')})?(?!${LETTER})`,
  'gu',
)
const JOINED_NAMES = new Map(JOINED)
const JOINED_RE = new RegExp(String.raw`(?<!${LETTER})(${byLength(JOINED).map(e => escapeRe(e[0])).join('|')})`, 'gu')

/** The places a text names in Indian scripts, as the gazetteer spells them, at most two, in the order named */
export function indicPlaces(text: string): string[] {
  if (!text || !INDIC_LETTERS.test(text)) return []
  const found: Array<{ at: number; name: string }> = []
  for (const m of text.normalize('NFC').matchAll(DEVANAGARI_RE)) {
    if (DEVANAGARI_NOT.has(m[0])) continue
    const name = DEVANAGARI_NAMES.get(m[1]!)
    if (name) found.push({ at: m.index ?? 0, name })
  }
  for (const m of text.normalize('NFC').matchAll(JOINED_RE)) {
    const name = JOINED_NAMES.get(m[1]!)
    if (name) found.push({ at: m.index ?? 0, name })
  }
  const out: string[] = []
  for (const { name } of found.sort((a, b) => a.at - b.at)) {
    if (!out.includes(name)) out.push(name)
    if (out.length >= 2) break
  }
  return out
}

/** Every place of the lists, for the tests */
export const INDIC_PLACE_NAMES: readonly string[] = [...new Set([...DEVANAGARI, ...JOINED].map(e => e[1]))]
