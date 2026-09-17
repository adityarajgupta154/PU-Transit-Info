import { formatAge, type StateStamp, type StateTone } from './tracking-state';
import type { TrackingPhase } from './driver-tracking';

export type DriverLanguage = 'en' | 'hi' | 'gu';

export const DRIVER_LANGUAGES: { value: DriverLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'gu', label: 'ગુજરાતી' },
];

type DriverCopy = {
  language: string;
  noBusTitle: string;
  noBusBody: string;
  noBusAsk: string;
  busLabel: string;
  beforeStart: string;
  signedIn: string;
  busAssigned: string;
  pickBus: string;
  todayAssignment: string;
  usualBus: string;
  busInService: string;
  busOutOfService: string;
  busNotRegistered: string;
  network: string;
  location: string;
  battery: string;
  ok: string;
  note: string;
  problem: string;
  online: string;
  offlineCannotStart: string;
  insecureLocation: string;
  locationDenied: string;
  locationGranted: string;
  locationAsk: string;
  batteryHint: string;
  startAgain: string;
  startTrip: string;
  cancelStarting: string;
  ending: string;
  retryEnd: string;
  endRecovered: string;
  endTrip: string;
  endPrompt: string;
  confirmEnd: string;
  keepDriving: string;
  checklistFix: string;
  backgroundHelp: string;
  synced: string;
  ageNoFix: string;
  ageSeconds: string;
  ageMinutes: string;
  ageHours: string;
  direction: string;
  directionHelp: string;
  toCampus: string;
  fromCampus: string;
  full: string;
  fullYes: string;
  fullNo: string;
  updating: string;
  fullError: string;
  statusIdle: string;
  statusStarting: string;
  statusAcquiring: string;
  statusLive: string;
  statusDelayed: string;
  statusWeakGps: string;
  statusGpsUnavailable: string;
  statusOffline: string;
  statusStopping: string;
  statusPendingEnd: string;
  statusRecovery: string;
  statusConflict: string;
  hintIdle: string;
  hintStarting: string;
  hintAcquiring: string;
  hintLive: string;
  hintDelayed: string;
  hintWeakGps: string;
  hintGpsUnavailable: string;
  hintOffline: string;
  hintStopping: string;
  hintPendingEnd: string;
  hintRecovery: string;
  hintConflict: string;
};

const COPY: Record<DriverLanguage, DriverCopy> = {
  en: {
    language: 'language',
    noBusTitle: 'no bus assigned',
    noBusBody: 'your driver account is approved, but the transport office has not put you on a bus yet.',
    noBusAsk: 'ask the office to assign your bus number; this page starts working the moment they do.',
    busLabel: 'bus',
    beforeStart: 'before you start',
    signedIn: 'signed in',
    busAssigned: 'bus assigned',
    pickBus: 'which bus today?',
    todayAssignment: "today's assignment",
    usualBus: 'usual bus',
    busInService: 'bus in service',
    busOutOfService: 'out of service — the trip cannot start; ask the transport admin',
    busNotRegistered: 'not registered — ask the transport admin to add this bus under Fleet',
    network: 'network',
    location: 'location',
    battery: 'battery',
    ok: 'ok',
    note: 'note',
    problem: 'problem',
    online: 'online',
    offlineCannotStart: 'offline — the trip cannot start until it is back',
    insecureLocation: 'this page is not on https, the browser will not share location',
    locationDenied: 'blocked in the browser — allow location for this site, then reload',
    locationGranted: 'allowed',
    locationAsk: 'the browser will ask when you start',
    batteryHint: 'plug the phone in and keep this screen on; a locked screen stops gps',
    startAgain: 'start again on this phone',
    startTrip: 'start trip',
    cancelStarting: 'cancel starting',
    ending: 'ending',
    retryEnd: 'retry sending the end',
    endRecovered: 'end the recovered trip',
    endTrip: 'end trip',
    endPrompt: 'riders will see “ended” and the map clears. you can start a new trip after.',
    confirmEnd: 'yes, end trip',
    keepDriving: 'keep driving',
    checklistFix: 'fix the red line in the checklist first.',
    backgroundHelp: 'background tracking is not possible in a browser. keep this page open and on screen for the whole trip.',
    synced: 'synced',
    ageNoFix: 'no fix yet',
    ageSeconds: '{value} s ago',
    ageMinutes: '{value} min ago',
    ageHours: '{hours} h {minutes} min ago',
    direction: 'trip direction',
    directionHelp: 'choose this before starting. it cannot be changed during a trip.',
    toCampus: 'city → campus',
    fromCampus: 'campus → city',
    full: 'bus full',
    fullYes: 'full',
    fullNo: 'seats available',
    updating: 'updating',
    fullError: 'bus-full status could not be saved; it was restored.',
    statusIdle: 'not driving',
    statusStarting: 'starting',
    statusAcquiring: 'finding gps',
    statusLive: 'live',
    statusDelayed: 'delayed',
    statusWeakGps: 'weak gps',
    statusGpsUnavailable: 'gps lost',
    statusOffline: 'offline',
    statusStopping: 'ending',
    statusPendingEnd: 'end pending',
    statusRecovery: 'recovered',
    statusConflict: 'taken over',
    hintIdle: 'start the trip when you pull out',
    hintStarting: 'registering this phone as the bus',
    hintAcquiring: 'waiting for the first fix — keep the phone near a window',
    hintLive: 'riders can see you',
    hintDelayed: 'fixes are arriving late — riders see the last position',
    hintWeakGps: 'fix is coarse — riders see an approximate position',
    hintGpsUnavailable: 'no usable fix — check location is on and not battery-restricted',
    hintOffline: 'no network — the trip continues when it returns',
    hintStopping: 'telling the server the trip is over',
    hintPendingEnd: 'ended on this phone; the server will hear it when the network returns',
    hintRecovery: 'this phone had a trip running before the page reloaded',
    hintConflict: 'another phone or the transport office owns this bus now',
  },
  hi: {
    language: 'भाषा',
    noBusTitle: 'बस निर्धारित नहीं है',
    noBusBody: 'आपका ड्राइवर खाता स्वीकृत है, लेकिन परिवहन कार्यालय ने अभी बस नहीं दी है।',
    noBusAsk: 'कार्यालय से बस नंबर जोड़ने को कहें; उसके बाद यह पेज काम करेगा।',
    busLabel: 'बस',
    beforeStart: 'शुरू करने से पहले',
    signedIn: 'साइन इन',
    busAssigned: 'बस निर्धारित',
    pickBus: 'आज कौन सी बस?',
    todayAssignment: 'आज की ड्यूटी',
    usualBus: 'नियमित बस',
    busInService: 'बस सेवा में',
    busOutOfService: 'सेवा से बाहर — ट्रिप शुरू नहीं हो सकती; ट्रांसपोर्ट एडमिन से पूछें',
    busNotRegistered: 'रजिस्टर नहीं — ट्रांसपोर्ट एडमिन से इस बस को Fleet में जोड़ने को कहें',
    network: 'नेटवर्क',
    location: 'स्थान',
    battery: 'बैटरी',
    ok: 'ठीक',
    note: 'ध्यान दें',
    problem: 'समस्या',
    online: 'ऑनलाइन',
    offlineCannotStart: 'ऑफलाइन — कनेक्शन लौटने तक यात्रा शुरू नहीं हो सकती',
    insecureLocation: 'यह पेज https पर नहीं है, ब्राउज़र स्थान साझा नहीं करेगा',
    locationDenied: 'ब्राउज़र में बंद है — इस साइट के लिए स्थान की अनुमति दें और फिर से लोड करें',
    locationGranted: 'अनुमति है',
    locationAsk: 'शुरू करते समय ब्राउज़र पूछेगा',
    batteryHint: 'फोन चार्ज पर रखें और स्क्रीन चालू रखें; लॉक स्क्रीन GPS रोक देती है',
    startAgain: 'इस फोन पर फिर शुरू करें',
    startTrip: 'यात्रा शुरू करें',
    cancelStarting: 'शुरुआत रद्द करें',
    ending: 'समाप्त हो रही है',
    retryEnd: 'समाप्ति फिर भेजें',
    endRecovered: 'बहाल यात्रा समाप्त करें',
    endTrip: 'यात्रा समाप्त करें',
    endPrompt: 'यात्रियों को “समाप्त” दिखेगा और नक्शा साफ होगा। बाद में नई यात्रा शुरू कर सकते हैं।',
    confirmEnd: 'हां, यात्रा समाप्त करें',
    keepDriving: 'चलाते रहें',
    checklistFix: 'पहले चेकलिस्ट की लाल समस्या ठीक करें।',
    backgroundHelp: 'ब्राउज़र में बैकग्राउंड ट्रैकिंग संभव नहीं है। पूरी यात्रा में यह पेज खुला और स्क्रीन पर रखें।',
    synced: 'सिंक',
    ageNoFix: 'अभी फिक्स नहीं',
    ageSeconds: '{value} सेकंड पहले',
    ageMinutes: '{value} मिनट पहले',
    ageHours: '{hours} घंटे {minutes} मिनट पहले',
    direction: 'यात्रा की दिशा',
    directionHelp: 'शुरू करने से पहले चुनें। यात्रा के दौरान इसे बदला नहीं जा सकता।',
    toCampus: 'शहर → कैंपस',
    fromCampus: 'कैंपस → शहर',
    full: 'बस भर गई',
    fullYes: 'भर गई',
    fullNo: 'सीट उपलब्ध',
    updating: 'अपडेट हो रहा है',
    fullError: 'बस की स्थिति सेव नहीं हुई; पुरानी स्थिति वापस रखी गई।',
    statusIdle: 'ड्राइविंग नहीं',
    statusStarting: 'शुरू हो रहा है',
    statusAcquiring: 'GPS खोज रहा है',
    statusLive: 'लाइव',
    statusDelayed: 'देरी',
    statusWeakGps: 'कमज़ोर GPS',
    statusGpsUnavailable: 'GPS नहीं मिला',
    statusOffline: 'ऑफलाइन',
    statusStopping: 'समाप्त हो रही है',
    statusPendingEnd: 'समाप्ति लंबित',
    statusRecovery: 'बहाल',
    statusConflict: 'दूसरे ने लिया',
    hintIdle: 'निकलते समय यात्रा शुरू करें',
    hintStarting: 'इस फोन को बस के रूप में दर्ज कर रहा है',
    hintAcquiring: 'पहला स्थान मिलने की प्रतीक्षा — फोन खिड़की के पास रखें',
    hintLive: 'यात्री आपको देख सकते हैं',
    hintDelayed: 'स्थान देर से मिल रहा है — यात्री पिछली स्थिति देखेंगे',
    hintWeakGps: 'स्थान अनुमानित है — यात्री लगभग स्थिति देखेंगे',
    hintGpsUnavailable: 'उपयोगी स्थान नहीं — GPS चालू और बैटरी प्रतिबंध हटाएं',
    hintOffline: 'नेटवर्क नहीं — लौटने पर यात्रा जारी रहेगी',
    hintStopping: 'सर्वर को यात्रा समाप्ति बता रहा है',
    hintPendingEnd: 'फोन पर समाप्त; नेटवर्क लौटने पर सर्वर को बताया जाएगा',
    hintRecovery: 'पेज फिर खुलने से पहले इस फोन पर यात्रा चल रही थी',
    hintConflict: 'अब यह बस दूसरे फोन या कार्यालय के नियंत्रण में है',
  },
  gu: {
    language: 'ભાષા',
    noBusTitle: 'બસ ફાળવાઈ નથી',
    noBusBody: 'તમારું ડ્રાઇવર ખાતું મંજૂર છે, પરંતુ પરિવહન કચેરીએ હજુ બસ ફાળવી નથી.',
    noBusAsk: 'કચેરીને બસ નંબર ફાળવવા કહો; પછી આ પેજ કામ કરશે.',
    busLabel: 'બસ',
    beforeStart: 'શરૂ કરતા પહેલાં',
    signedIn: 'સાઇન ઇન',
    busAssigned: 'બસ ફાળવેલ',
    pickBus: 'આજે કઈ બસ?',
    todayAssignment: 'આજની ફરજ',
    usualBus: 'નિયમિત બસ',
    busInService: 'બસ સેવામાં',
    busOutOfService: 'સેવાની બહાર — ટ્રિપ શરૂ થઈ શકશે નહીં; પરિવહન એડમિનને પૂછો',
    busNotRegistered: 'નોંધાયેલ નથી — પરિવહન એડમિનને આ બસ Fleet માં ઉમેરવા કહો',
    network: 'નેટવર્ક',
    location: 'સ્થાન',
    battery: 'બેટરી',
    ok: 'બરાબર',
    note: 'નોંધ',
    problem: 'સમસ્યા',
    online: 'ઓનલાઇન',
    offlineCannotStart: 'ઓફલાઇન — કનેક્શન પાછું આવે ત્યાં સુધી મુસાફરી શરૂ થઈ શકશે નહીં',
    insecureLocation: 'આ પેજ https પર નથી, બ્રાઉઝર સ્થાન શેર કરશે નહીં',
    locationDenied: 'બ્રાઉઝરમાં બંધ છે — આ સાઇટ માટે સ્થાનની મંજૂરી આપો અને ફરી લોડ કરો',
    locationGranted: 'મંજૂર',
    locationAsk: 'શરૂ કરતી વખતે બ્રાઉઝર પૂછશે',
    batteryHint: 'ફોન ચાર્જ પર રાખો અને સ્ક્રીન ચાલુ રાખો; લોક સ્ક્રીન GPS બંધ કરે છે',
    startAgain: 'આ ફોન પર ફરી શરૂ કરો',
    startTrip: 'મુસાફરી શરૂ કરો',
    cancelStarting: 'શરૂઆત રદ કરો',
    ending: 'સમાપ્ત થઈ રહ્યું છે',
    retryEnd: 'સમાપ્તિ ફરી મોકલો',
    endRecovered: 'પાછી મળેલી મુસાફરી સમાપ્ત કરો',
    endTrip: 'મુસાફરી સમાપ્ત કરો',
    endPrompt: 'મુસાફરોને “સમાપ્ત” દેખાશે અને નકશો સાફ થશે. પછી નવી મુસાફરી શરૂ કરી શકો છો.',
    confirmEnd: 'હા, મુસાફરી સમાપ્ત કરો',
    keepDriving: 'ચાલુ રાખો',
    checklistFix: 'પહેલા ચેકલિસ્ટની લાલ સમસ્યા ઠીક કરો.',
    backgroundHelp: 'બ્રાઉઝરમાં બેકગ્રાઉન્ડ ટ્રેકિંગ શક્ય નથી. આખી મુસાફરી દરમિયાન આ પેજ ખુલ્લું અને સ્ક્રીન પર રાખો.',
    synced: 'સિંક',
    ageNoFix: 'હજુ ફિક્સ નથી',
    ageSeconds: '{value} સેકન્ડ પહેલાં',
    ageMinutes: '{value} મિનિટ પહેલાં',
    ageHours: '{hours} કલાક {minutes} મિનિટ પહેલાં',
    direction: 'મુસાફરીની દિશા',
    directionHelp: 'શરૂ કરતા પહેલાં પસંદ કરો. મુસાફરી દરમિયાન બદલી શકાશે નહીં.',
    toCampus: 'શહેર → કેમ્પસ',
    fromCampus: 'કેમ્પસ → શહેર',
    full: 'બસ ભરેલી',
    fullYes: 'ભરેલી',
    fullNo: 'સીટ ઉપલબ્ધ',
    updating: 'અપડેટ થઈ રહ્યું છે',
    fullError: 'બસની સ્થિતિ સેવ થઈ નથી; જૂની સ્થિતિ પાછી રાખી છે.',
    statusIdle: 'ડ્રાઇવિંગ નથી',
    statusStarting: 'શરૂ થઈ રહ્યું છે',
    statusAcquiring: 'GPS શોધી રહ્યું છે',
    statusLive: 'લાઇવ',
    statusDelayed: 'મોડું',
    statusWeakGps: 'નબળું GPS',
    statusGpsUnavailable: 'GPS મળ્યું નથી',
    statusOffline: 'ઓફલાઇન',
    statusStopping: 'સમાપ્ત થઈ રહ્યું છે',
    statusPendingEnd: 'સમાપ્તિ બાકી',
    statusRecovery: 'પાછી મળ્યું',
    statusConflict: 'બીજાએ લીધું',
    hintIdle: 'બસ નીકળે ત્યારે મુસાફરી શરૂ કરો',
    hintStarting: 'આ ફોનને બસ તરીકે નોંધે છે',
    hintAcquiring: 'પહેલું સ્થાન મળવાની રાહ — ફોન બારી પાસે રાખો',
    hintLive: 'મુસાફરો તમને જોઈ શકે છે',
    hintDelayed: 'સ્થાન મોડું આવી રહ્યું છે — મુસાફરો છેલ્લું સ્થાન જોશે',
    hintWeakGps: 'સ્થાન અંદાજિત છે — મુસાફરો લગભગ સ્થાન જોશે',
    hintGpsUnavailable: 'ઉપયોગી સ્થાન નથી — GPS ચાલુ અને બેટરી પ્રતિબંધ દૂર કરો',
    hintOffline: 'નેટવર્ક નથી — પાછું આવે ત્યારે મુસાફરી ચાલુ રહેશે',
    hintStopping: 'સર્વરને મુસાફરી પૂરી થયાનું જણાવી રહ્યું છે',
    hintPendingEnd: 'ફોન પર સમાપ્ત; નેટવર્ક પાછું આવે ત્યારે સર્વરને જણાવાશે',
    hintRecovery: 'પેજ ફરી ખૂલ્યા પહેલાં આ ફોન પર મુસાફરી ચાલી રહી હતી',
    hintConflict: 'હવે આ બસ બીજા ફોન અથવા કચેરીના નિયંત્રણમાં છે',
  },
};

export function driverText(language: DriverLanguage, key: keyof DriverCopy): string {
  return COPY[language][key];
}

export function driverStamps(language: DriverLanguage): Record<TrackingPhase, StateStamp> {
  const text = (key: keyof DriverCopy) => driverText(language, key);
  const stamp = (label: keyof DriverCopy, hint: keyof DriverCopy, tone: StateTone): StateStamp => ({
    label: text(label),
    tone,
    hint: text(hint),
  });
  return {
    idle: stamp('statusIdle', 'hintIdle', 'outline'),
    starting: stamp('statusStarting', 'hintStarting', 'outline'),
    acquiring: stamp('statusAcquiring', 'hintAcquiring', 'outline'),
    live: stamp('statusLive', 'hintLive', 'blue'),
    delayed: stamp('statusDelayed', 'hintDelayed', 'outline'),
    weak_gps: stamp('statusWeakGps', 'hintWeakGps', 'outline'),
    gps_unavailable: stamp('statusGpsUnavailable', 'hintGpsUnavailable', 'red'),
    offline: stamp('statusOffline', 'hintOffline', 'red'),
    stopping: stamp('statusStopping', 'hintStopping', 'outline'),
    pending_end: stamp('statusPendingEnd', 'hintPendingEnd', 'outline'),
    recovery: stamp('statusRecovery', 'hintRecovery', 'outline'),
    conflict: stamp('statusConflict', 'hintConflict', 'red'),
  };
}

export function readDriverLanguage(): DriverLanguage {
  try {
    const value = globalThis.localStorage?.getItem('pu-transit:driver:language');
    return value === 'hi' || value === 'gu' ? value : 'en';
  } catch {
    return 'en';
  }
}

export function saveDriverLanguage(language: DriverLanguage): void {
  try {
    globalThis.localStorage?.setItem('pu-transit:driver:language', language);
  } catch {
    // A restricted browser can reject localStorage; the current selection still works.
  }
}

export function formatDriverAge(language: DriverLanguage, seconds: number | null): string {
  if (language === 'en') return formatAge(seconds);
  if (seconds === null) return driverText(language, 'ageNoFix');
  if (seconds < 60) return driverText(language, 'ageSeconds').replace('{value}', String(seconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return driverText(language, 'ageMinutes').replace('{value}', String(minutes));
  const hours = Math.floor(minutes / 60);
  return driverText(language, 'ageHours')
    .replace('{hours}', String(hours))
    .replace('{minutes}', String(minutes % 60));
}

/** Working translations are concise operational copy; native-language review is still recommended. */
export function translateDriverError(message: string | null, language: DriverLanguage): string | null {
  if (!message || language === 'en') return message;
  const key =
    message.includes('Location access is unavailable') ? 'hintGpsUnavailable' :
    message.includes('Location tracking is unavailable') ? 'hintGpsUnavailable' :
    message.includes('A previous Stop is waiting') ? 'statusPendingEnd' :
    message.includes('You are offline') ? 'offlineCannotStart' :
    message.includes('Tracking is disconnected') ? 'hintOffline' :
    message.includes('This trip was ended') ? 'hintConflict' :
    message.includes('active publisher on the bus') ? 'hintConflict' :
    message.includes('Reconnect failed') ? 'hintOffline' :
    message.includes('A previous trip is available') ? 'hintRecovery' :
    message.includes('Stop is saved') || message.includes('Stop could not be confirmed') ? 'hintPendingEnd' :
    message.includes('Full status is unavailable') ? 'fullError' :
    message.includes('Start could not be confirmed') ? 'hintStarting' :
    null;
  return key ? driverText(language, key) : message;
}
