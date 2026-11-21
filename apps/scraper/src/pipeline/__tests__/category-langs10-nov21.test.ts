/**
 * Topic words in Chinese, Greek, Hindi, Ukrainian, Turkish, Indonesian, Korean, Italian, Tamil and Telugu (Nov 21,
 * 2026): the day's headlines that sat under their outlets' own "Politics", and the ones the guards keep there.
 */
import { describe, it, expect } from 'vitest'
import { categorizeText } from '../categories'

const topic = (title: string, lang: string) => categorizeText(title, '', lang)

describe('topic words in ten more languages', () => {
  it('reads Chinese, without word boundaries', () => {
    expect(topic('国足世预赛名单公布 多名新人入选', 'zh')).toBe('sports')
    expect(topic('英伟达曾申请向中国涉军企业出售芯片，获商务部批准', 'zh')).toBe('technology')
    expect(topic('四川甘孜州发生5.1级地震', 'zh')).toBe('disaster')
    expect(topic('《沙丘》系列电影将首登辽宁省科技馆全国最大IMAX银幕', 'zh')).toBe('culture')
  })

  it('leaves the market\'s "tsunami" and two fans alone in Chinese', () => {
    expect(topic('台股遭綠海嘯 半導體ETF重挫', 'zh')).not.toBe('disaster')
    expect(topic('台股遭綠海嘯 半導體ETF重挫', 'zh')).not.toBe('technology')
    expect(topic('他买了两台风扇', 'zh')).not.toBe('disaster')
  })

  it('reads Greek, and a marathon runner called a "scientist" is sports', () => {
    expect(topic('EuroLeague: Ο Ιφί των «μεγάλων» σουτ και η Παρί, που δεν πρέπει να την… ξεγράφεις!', 'el')).toBe('sports')
    expect(topic('Αντρέας Άλμγκρεν: Ο «επιστήμονας» που αλλάζει τα δεδομένα στον μαραθώνιο', 'el')).toBe('sports')
    expect(topic('Γρίπη Α: Η αμερικανική μετάλλαξη «χτυπά» την πόρτα της Ευρώπης', 'el')).toBe('health')
  })

  it('leaves a Greek court case, a research ship in the sea dispute and a fire after an attack alone', () => {
    expect(topic('Στο εδώλιο ο γιατρός για τον καρκίνο που δεν διαγνώστηκε', 'el')).not.toBe('health')
    expect(topic('Γεραπετρίτης: Το γαλλικό ερευνητικό βρίσκεται εντός του τουρκολιβυκού με ελληνική άδεια και Navtex', 'el')).not.toBe('science')
    expect(topic('Πυρκαγιά μετά την επίθεση με drone σε αποθήκη', 'el')).not.toBe('disaster')
  })

  it('reads Hindi, and leaves a fight at a cricket match and a flood of complaints alone', () => {
    expect(topic('कबड्डी खिलाड़ी वीर एकम को कौमी रत्न अवार्ड', 'hi')).toBe('sports')
    expect(topic('पेरू में 6.8 तीव्रता का शक्तिशाली भूकंप, राजधानी लीमा में महसूस किए गए झटके', 'hi')).toBe('disaster')
    expect(topic('क्रिकेट मैच के दौरान मारपीट, FIR दर्ज', 'hi')).not.toBe('sports')
    expect(topic('शिकायतों की बाढ़ के बीच विभाग ने जांच शुरू की', 'hi')).not.toBe('disaster')
  })

  it('reads Ukrainian, and leaves the war\'s museum and sanctions on athletes alone', () => {
    expect(topic('Усик змусив боксерів змінювати плани: що відбувається', 'uk')).toBe('sports')
    expect(topic('"S Миколай та загублений лист": огляд святкового сімейного фільму 2026 року', 'uk')).toBe('culture')
    expect(topic('Внаслідок атаки дронів пошкоджено музей у Харкові', 'uk')).not.toBe('culture')
    expect(topic('Заборону на видачу віз спортсменам РФ включать до проєкту 22-го пакету санкцій – Дональд Туск', 'uk')).not.toBe('sports')
  })

  it('reads Turkish, and leaves an earthquake on the stock market and a singer\'s murder alone', () => {
    expect(topic('Fenerbahçe Kocaeli deplasmanında', 'tr')).toBe('sports')
    expect(topic('ANALİZ: Yapay zekada şirketler savaşının iç yüzü', 'tr')).toBe('technology')
    expect(topic('Borsada deprem: hisseler sert düştü', 'tr')).not.toBe('disaster')
    expect(topic('Ünlü şarkıcının cinayet davasında karar çıktı', 'tr')).not.toBe('culture')
  })

  it('reads Indonesian', () => {
    expect(topic('Shan United FC Hancur Lebur di Tangan Persib, Pelatih Singgung Perbedaan Kualitas', 'id')).toBe('sports')
    expect(topic('Ratusan Ibu-Ibu Antusias Nobar Episode Pertama Sinetron Baru RCTI Tertulis untuk Kita', 'id')).toBe('culture')
  })

  it('reads Korean from a word\'s start, and leaves chips in politics, the market and house prices alone', () => {
    expect(topic('손흥민, 시즌 5호골 폭발', 'ko')).toBe('sports')
    expect(topic('BC카드, 피클과 AI 에이전트 결제 기술 검증 \'맞손\'', 'ko')).toBe('technology')
    expect(topic('반도체주 급락에 코스피 2% 하락', 'ko')).not.toBe('technology')
    expect(topic('"반도체 꺾이면 동탄도 흔들"…전문가가 짚은 경기 남부 집값의 위험 변수', 'ko')).not.toBe('technology')
  })

  it('reads Italian, and leaves an AI in a president\'s mouth alone', () => {
    expect(topic('Hockey a1. Sarzana, che paura. Rossoneri nel finale raggiungono il 4-4', 'it')).toBe('sports')
    expect(topic('Maltempo, collegamenti difficili per Ischia e Procida: sospensione di tutte le corse degli aliscafi', 'it')).toBe('disaster')
    expect(topic('Trump avverte Teheran e sfida Pechino sull’AI: «Vogliamo un vero accordo con l’Iran»', 'it')).not.toBe('technology')
  })

  it('reads Tamil and Telugu, and leaves a flood of lies alone', () => {
    expect(topic('தமிழகத்தில் மட்டும் ரூ.100 கோடியை கடந்த சூர்யாவின் ‘சீன்’ திரைப்படம்', 'ta')).toBe('culture')
    expect(topic('Ind Vs Nepal: నేపాల్‌పై భారత్-ఏ భారీ విజయం.. 306 పరుగుల తేడాతో వరల్డ్ రికార్డు బద్దలు..', 'te')).toBe('sports')
    expect(topic('గోదావరికి భారీ వరద, లంక గ్రామాలు జలదిగ్బంధం', 'te')).toBe('disaster')
    expect(topic('సిద్దిపేటలో సీఎం అబద్ధాల వరద', 'te')).not.toBe('disaster')
  })

  it('leaves English alone', () => {
    expect(topic('Calcio: Juventus beat Inter in Serie A', 'en')).toBe('sports')
    expect(topic('Il governo approva il bilancio', 'en')).not.toBe('sports')
  })
})
