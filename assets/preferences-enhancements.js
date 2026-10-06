(() => {
  const LANGUAGE_PACKS = Object.freeze({
    en: {},
    af: {
      overview:'Oorsig', academics:'Akademies', finance:'Finansies', operations:'Bedrywighede', safety:'Veiligheid', schoolFeed:'Skoolnuus', timetable:'Rooster', attendance:'Bywoning', development:'Ontwikkeling', messages:'Boodskappe', billingFinance:'Fakturering & Finansies',
      home:'Tuis', search:'Soek', help:'Kry hulp', settings:'Instellings', signOut:'Meld af',
      personalSettings:'Persoonlike instellings', profileIcon:'Profielikoon', language:'Taal',
      languageDescription:'Kies jou voorkeur vertoontaal. Onvertaalde inhoud bly in Engels sodat niks verdwyn of breek nie.',
      dashboardRefresh:'Paneelverversing', refreshDescription:'Hou die paneel op datum met ’n sagte verversing wat jou ongestoorde konsep behou.',
      manualRefresh:'Slegs handmatige verversing', autoSmart:'Outomaties (slim)', sound:'Little Feet-klank',
      navigation:'Navigasie', install:'Installeer Little Feet', theme:'Tema', mute:'Demp Little Feet',
      securePortal:'Veilige skoolportaal', accessNote:'Skoolbestuurde, rolgebaseerde toegang vir goedgekeurde Little Feet-rekeninge.', usernameLabel:'Personeel-ID of ouer-e-pos', passwordLabel:'Sekuriteits-PIN / Wagwoord', rememberEmail:'Onthou my e-pos', loginHelp:'PIN/wagwoord vergeet? Kontak jou skooladministrateur.', signIn:'Veilige rekeningaanmelding', otherSignIn:'Ander aanmeldopsies', newAccount:'Nuut by Little Feet?', createAccount:'Skep rekening', privacyLink:'Privaatheid & POPIA', termsLink:'Bepalings', soundShort:'Klank'
    },
    zu: {
      overview:'Uhlolojikelele', academics:'Ezemfundo', finance:'Ezezimali', operations:'Imisebenzi', safety:'Ukuphepha', schoolFeed:'Izindaba zesikole', timetable:'Uhlelo lwezikhathi', attendance:'Ukuba khona', development:'Intuthuko', messages:'Imiyalezo', billingFinance:'Izinkokhelo & Ezezimali',
      home:'Ikhaya', search:'Sesha', help:'Thola usizo', settings:'Izilungiselelo', signOut:'Phuma',
      personalSettings:'Izilungiselelo zomuntu', profileIcon:'Isithonjana sephrofayela', language:'Ulimi',
      languageDescription:'Khetha ulimi oluthandayo. Umbhalo ongakahunyushwa uzohlala ngesiNgisi ukuze lutho lungalahleki.',
      dashboardRefresh:'Vuselela ideshibhodi', refreshDescription:'Gcina ideshibhodi ivuselelwe ngaphandle kokulahlekelwa umbhalo ongakawugcini.',
      manualRefresh:'Vuselela mathupha kuphela', autoSmart:'Okuzenzakalelayo (okuhlakaniphile)', sound:'Umsindo we-Little Feet',
      navigation:'Ukuzulazula', install:'Faka i-Little Feet', theme:'Itimu', mute:'Thulisa i-Little Feet',
      securePortal:'Iphothali yesikole evikelekile', accessNote:'Ukufinyelela okulawulwa yisikole ngokwendima kuma-akhawunti agunyaziwe e-Little Feet.', usernameLabel:'I-ID yabasebenzi noma i-imeyili yomzali', passwordLabel:'I-PIN yokuphepha / Iphasiwedi', rememberEmail:'Khumbula i-imeyili yami', loginHelp:'Ukhohlwe i-PIN/iphasiwedi? Xhumana nomphathi wesikole.', signIn:'Ngena ngokuphephile', otherSignIn:'Ezinye izindlela zokungena', newAccount:'Umusha ku-Little Feet?', createAccount:'Dala i-akhawunti', privacyLink:'Ubumfihlo & POPIA', termsLink:'Imigomo', soundShort:'Umsindo'
    },
    xh: {
      overview:'Ushwankathelo', academics:'Imfundo', finance:'Ezemali', operations:'Imisebenzi', safety:'Ukhuseleko', schoolFeed:'Iindaba zesikolo', timetable:'Itheyibhile yexesha', attendance:'Ukuya esikolweni', development:'Uphuhliso', messages:'Imiyalezo', billingFinance:'Amatyala & Ezemali',
      home:'Ikhaya', search:'Khangela', help:'Fumana uncedo', settings:'Izicwangciso', signOut:'Phuma',
      personalSettings:'Izicwangciso zobuqu', profileIcon:'I-ayikhoni yeprofayile', language:'Ulwimi',
      languageDescription:'Khetha ulwimi olukhethayo. Umbhalo ongekaguqulelwa uya kuhlala ngesiNgesi ukuze kungabikho nto ilahlekileyo.',
      dashboardRefresh:'Hlaziya ideshibhodi', refreshDescription:'Gcina ideshibhodi ihlaziyiwe ngaphandle kokulahlekelwa yidrafti engekagcinwa.',
      manualRefresh:'Hlaziya ngesandla kuphela', autoSmart:'Okuzenzekelayo (okukrelekrele)', sound:'Isandi se-Little Feet',
      navigation:'Ukukhangela', install:'Faka i-Little Feet', theme:'Umxholo', mute:'Thulisa i-Little Feet',
      securePortal:'Iphothali yesikolo ekhuselekileyo', accessNote:'Ufikelelo olulawulwa sisikolo ngokwendima kwiiakhawunti ezivunyiweyo ze-Little Feet.', usernameLabel:'I-ID yomsebenzi okanye i-imeyile yomzali', passwordLabel:'I-PIN yokhuseleko / Igama lokugqitha', rememberEmail:'Khumbula i-imeyile yam', loginHelp:'Ulibele i-PIN/igama lokugqitha? Qhagamshelana nomlawuli wesikolo.', signIn:'Ngena ngokukhuselekileyo', otherSignIn:'Ezinye iindlela zokungena', newAccount:'Umtsha kwi-Little Feet?', createAccount:'Yenza iakhawunti', privacyLink:'Ubumfihlo & POPIA', termsLink:'Imiqathango', soundShort:'Isandi'
    },
    nso: {
      overview:'Kakaretšo', academics:'Thuto', finance:'Ditšhelete', operations:'Ditiro', safety:'Polokego', schoolFeed:'Ditaba tša sekolo', timetable:'Lenaneo la dinako', attendance:'Go ba gona', development:'Tlhabollo', messages:'Melaetša', billingFinance:'Ditefelo & Ditšhelete',
      home:'Gae', search:'Nyaka', help:'Hwetša thušo', settings:'Dipeakanyo', signOut:'Tšwa',
      personalSettings:'Dipeakanyo tša gago', profileIcon:'Seswantšho sa profaele', language:'Leleme',
      languageDescription:'Kgetha leleme leo o le ratago. Sengwalwa seo se sego sa fetolelwa se tla dula e le Seisemane.',
      dashboardRefresh:'Mpshafatša dashboard', refreshDescription:'Boloka dashboard e le nakong ntle le go lahlegelwa ke sengwalwa seo se sego sa bolokwa.',
      manualRefresh:'Mpshafatšo ya seatla feela', autoSmart:'Ka go itiragalela', sound:'Modumo wa Little Feet',
      navigation:'Tshepetšo', install:'Tsenya Little Feet', theme:'Sehlogo', mute:'Homotša Little Feet',
      securePortal:'Kgoro ya sekolo ye polokego', accessNote:'Phihlelelo ya sekolo ye go ya ka tema bakeng sa diakhaonto tša Little Feet tše di dumeletšwego.', usernameLabel:'ID ya mošomi goba imeile ya motswadi', passwordLabel:'PIN ya tšhireletšo / Lentšuphetišo', rememberEmail:'Gopola imeile ya ka', loginHelp:'O lebetše PIN/lentšuphetišo? Ikgokaganye le molaodi wa sekolo.', signIn:'Tsena ka polokego', otherSignIn:'Mekgwa ye mengwe ya go tsena', newAccount:'O moswa go Little Feet?', createAccount:'Hlama akhaonto', privacyLink:'Sephiri & POPIA', termsLink:'Melawana', soundShort:'Modumo'
    },
    st: {
      overview:'Kakaretso', academics:'Thuto', finance:'Ditjhelete', operations:'Tshebetso', safety:'Polokeho', schoolFeed:'Ditaba tsa sekolo', timetable:'Lenaneo la nako', attendance:'Boteng', development:'Ntshetsopele', messages:'Melaetsa', billingFinance:'Ditefiso & Ditjhelete',
      home:'Lehae', search:'Batla', help:'Fumana thuso', settings:'Ditlhophiso', signOut:'Tsoa',
      personalSettings:'Ditlhophiso tsa hao', profileIcon:'Letshwao la profaele', language:'Puo',
      languageDescription:'Kgetha puo eo o e ratang. Mongolo o sa fetolelwang o tla sala ka Senyesemane hore ho se ke ha lahleha letho.',
      dashboardRefresh:'Ntjhafatsa dashboard', refreshDescription:'Boloka dashboard e le ntjha ntle le ho lahlehelwa ke mongolo o sa bolokwang.',
      manualRefresh:'Ntjhafatso ya letsoho feela', autoSmart:'Ka boiketsetso', sound:'Modumo wa Little Feet',
      navigation:'Tsamaiso', install:'Kenya Little Feet', theme:'Sehlooho', mute:'Kgutsisa Little Feet',
      securePortal:'Kgoro e sireletsehileng ya sekolo', accessNote:'Phihlello e laolwang ke sekolo ho latela karolo bakeng sa diakhaonto tse amohetsweng tsa Little Feet.', usernameLabel:'ID ya mosebeletsi kapa imeile ya motswadi', passwordLabel:'PIN ya tshireletso / Phasewete', rememberEmail:'Hopola imeile ya ka', loginHelp:'O lebetse PIN/phasewete? Ikopanye le molaodi wa sekolo.', signIn:'Kena ka polokeho', otherSignIn:'Mekgwa e meng ya ho kena', newAccount:'O mocha ho Little Feet?', createAccount:'Theha akhaonto', privacyLink:'Lekunutu & POPIA', termsLink:'Dipehelo', soundShort:'Modumo'
    },
    tn: {
      overview:'Kakaretso', academics:'Thuto', finance:'Ditšhelete', operations:'Ditiro', safety:'Polokesego', schoolFeed:'Dikgang tsa sekolo', timetable:'Lenaneo la nako', attendance:'Go nna teng', development:'Tlhabololo', messages:'Melaetsa', billingFinance:'Dituelo & Ditšhelete',
      home:'Gae', search:'Batla', help:'Fumana thuso', settings:'Dithulaganyo', signOut:'Tswa',
      personalSettings:'Dithulaganyo tsa gago', profileIcon:'Letshwao la profaele', language:'Puo',
      languageDescription:'Tlhopha puo e o e ratang. Mafoko a a sa ranolwang a tla sala ka Sekgoa gore go se ka ga latlhega sepe.',
      dashboardRefresh:'Ntšhwafatsa dashboard', refreshDescription:'Boloka dashboard e le mo nakong ntle le go latlhegelwa ke se o sa se bolokang.',
      manualRefresh:'Ntšhwafatso ya seatla fela', autoSmart:'Ka boitiriso', sound:'Modumo wa Little Feet',
      navigation:'Tsamaiso', install:'Tsenya Little Feet', theme:'Setlhogo', mute:'Didimatša Little Feet',
      securePortal:'Kgoro ya sekolo e e sireletsegileng', accessNote:'Phitlhelelo e e laolwang ke sekolo go ya ka seabe mo diakhaontong tsa Little Feet tse di amogetsweng.', usernameLabel:'ID ya modiri kgotsa imeile ya motsadi', passwordLabel:'PIN ya tshireletso / Lefoko la sephiri', rememberEmail:'Gakologelwa imeile ya me', loginHelp:'O lebetse PIN/lefoko la sephiri? Ikgolaganye le molaodi wa sekolo.', signIn:'Tsena ka pabalesego', otherSignIn:'Ditsela tse dingwe tsa go tsena', newAccount:'O mosha mo Little Feet?', createAccount:'Tlhama akhaonto', privacyLink:'Boiphitlho & POPIA', termsLink:'Melawana', soundShort:'Modumo'
    },
    ss: {
      overview:'Sibutsetelo', academics:'Temfundvo', finance:'Tetimali', operations:'Imisebenti', safety:'Kuphepha', schoolFeed:'Tindzaba tesikolo', timetable:'Luhlelo lwesikhatsi', attendance:'Kuba khona', development:'Kutfutfuka', messages:'Imilayeto', billingFinance:'Kubhadala & Tetimali',
      home:'Ekhaya', search:'Sesha', help:'Tfola lusito', settings:'Tilungiselelo', signOut:'Phuma',
      personalSettings:'Tilungiselelo temuntfu', profileIcon:'Sifaniso sephrofayili', language:'Lulwimi',
      languageDescription:'Khetsa lulwimi lolutsandzako. Lokungakahunyushwa kutawuhlala ngesiNgisi kuze kungalahleki lutfo.',
      dashboardRefresh:'Vuselela ideshibhodi', refreshDescription:'Gcina ideshibhodi ivuselelekile ngaphandle kwekulahlekelwa ngumsebenti longakagcinwa.',
      manualRefresh:'Vuselela ngesandla kuphela', autoSmart:'Ngekutentakalela', sound:'Umsindvo wa Little Feet',
      navigation:'Kuhamba', install:'Faka Little Feet', theme:'Sihloko', mute:'Thulisa Little Feet',
      securePortal:'Iphothali yesikolo lephephile', accessNote:'Kungena lokulawulwa sikolo ngekwendzima kuma-akhawunti e-Little Feet lavunyiwe.', usernameLabel:'I-ID yesisebenti noma i-imeyili yemtali', passwordLabel:'I-PIN yekuphepha / Iphasiwedi', rememberEmail:'Khumbula i-imeyili yami', loginHelp:'Ukhohlwe i-PIN/iphasiwedi? Tsintsana nemphatsi wesikolo.', signIn:'Ngena ngekuphepha', otherSignIn:'Letinye tindlela tekungena', newAccount:'Umusha ku-Little Feet?', createAccount:'Yakha i-akhawunti', privacyLink:'Bumfihlo & POPIA', termsLink:'Imigomo', soundShort:'Umsindvo'
    },
    ve: {
      overview:'Manweledzo', academics:'Pfunzo', finance:'Masheleni', operations:'Mishumo', safety:'Tsireledzo', schoolFeed:'Mafhungo a tshikolo', timetable:'Mbekanyamushumo ya tshifhinga', attendance:'U vha hone', development:'Mvelaphanda', messages:'Milaedza', billingFinance:'Mbadelo & Masheleni',
      home:'Hayani', search:'Ṱoḓa', help:'Wana thuso', settings:'Nzudzanyo', signOut:'Bva',
      personalSettings:'Nzudzanyo dzaṋu', profileIcon:'Tshiga tsha phurofaiḽi', language:'Luambo',
      languageDescription:'Nangani luambo lune na lu takalela. Zwi sa athu ṱalutshedzelwa zwi ḓo dzula zwi nga Luisimane uri hu sa xele tshithu.',
      dashboardRefresh:'Dovholosa dashboard', refreshDescription:'Dzudzanyani dashboard i dzule i ya zwino hu songo xela zwe na sa athu vhulunga.',
      manualRefresh:'Dovholosa nga tshanda fhedzi', autoSmart:'Nga u tou itea', sound:'Mubvumo wa Little Feet',
      navigation:'Tshepetsho', install:'Dzhenisa Little Feet', theme:'Thero', mute:'Fhumudzani Little Feet',
      securePortal:'Phothala ya tshikolo yo tsireledzeaho', accessNote:'U swikelela hu langwaho nga tshikolo u ya nga mushumo kha dziakhaonto dza Little Feet dzo tendelwaho.', usernameLabel:'ID ya mushumi kana imeiḽi ya mubebi', passwordLabel:'PIN ya tsireledzo / Phasiwede', rememberEmail:'Humbula imeiḽi yanga', loginHelp:'No hangwa PIN/phasiwede? Kwamanani na mulanguli wa tshikolo.', signIn:'Dzhena nga tsireledzo', otherSignIn:'Dziṅwe nḓila dza u dzhena', newAccount:'Ni muswa kha Little Feet?', createAccount:'Sikani akhaonto', privacyLink:'Tshiphiri & POPIA', termsLink:'Milayo', soundShort:'Mubvumo'
    },
    ts: {
      overview:'Nkatsakanyo', academics:'Dyondzo', finance:'Timali', operations:'Mintirho', safety:'Vuhlayiseki', schoolFeed:'Mahungu ya xikolo', timetable:'Xiyimiso xa nkarhi', attendance:'Ku va kona', development:'Nhluvuko', messages:'Mahungu', billingFinance:'Mibalo & Timali',
      home:'Kaya', search:'Lava', help:'Kuma mpfuno', settings:'Swiyimiso', signOut:'Huma',
      personalSettings:'Swiyimiso swa wena', profileIcon:'Xifaniso xa phurofayili', language:'Ririmi',
      languageDescription:'Hlawula ririmi leri u ri tsakelaka. Marito lama nga si hundzuluxiwaka ma ta sala hi Xinghezi leswaku ku nga lahleki leswi u swi endleke.',
      dashboardRefresh:'Pfuxeta dashboard', refreshDescription:'Hlayisa dashboard yi ri ya sweswi handle ko lahlekeriwa hi leswi u nga si swi hlayisa.',
      manualRefresh:'Pfuxeta hi voko ntsena', autoSmart:'Hi ku tisungulela', sound:'Mpfumawulo wa Little Feet',
      navigation:'Ku fambafamba', install:'Nghenisa Little Feet', theme:'Nhlokomhaka', mute:'Timela mpfumawulo wa Little Feet',
      securePortal:'Phothali ya xikolo leyi sirhelelekeke', accessNote:'Ku nghena loku lawuriwaka hi xikolo hi ku ya hi xiphemu eka tiakhawunti ta Little Feet leti pfumeleriweke.', usernameLabel:'ID ya mutirhi kumbe imeyili ya mutswari', passwordLabel:'PIN ya vuhlayiseki / Phasiwedi', rememberEmail:'Tsundzuka imeyili ya mina', loginHelp:'U rivele PIN/phasiwedi? Tihlanganise na mulawuri wa xikolo.', signIn:'Nghena hi ku hlayiseka', otherSignIn:'Tindlela tin’wana to nghena', newAccount:'U muntshwa eka Little Feet?', createAccount:'Endla akhawunti', privacyLink:'Vuhlayiseki bya vuxokoxoko & POPIA', termsLink:'Milawu', soundShort:'Mpfumawulo'
    },
    nr: {
      overview:'Isirhunyezo', academics:'Ifundo', finance:'Iimali', operations:'Imisebenzi', safety:'Ukuphepha', schoolFeed:'Iindaba zesikolo', timetable:'Irhelo lesikhathi', attendance:'Ukuba khona', development:'Ukuthuthuka', messages:'Imilayezo', billingFinance:'Ukubhadela & Iimali',
      home:'Ekhaya', search:'Funa', help:'Thola isizo', settings:'Amasethingi', signOut:'Phuma',
      personalSettings:'Amasethingi womuntu', profileIcon:'Isithonjana sephrofayili', language:'Ilimi',
      languageDescription:'Khetha ilimi olithandako. Okungakatjhugululwa kuzokuhlala ngesiNgisi ukuze kungalahleki litho.',
      dashboardRefresh:'Vuselela ideshibhodi', refreshDescription:'Gcina ideshibhodi ivuselelwe ngaphandle kokulahlekelwa msebenzi ongakagcinwa.',
      manualRefresh:'Vuselela ngesandla kwaphela', autoSmart:'Ngokuzenzakalela', sound:'Umsindo we-Little Feet',
      navigation:'Ukuzulazula', install:'Faka i-Little Feet', theme:'Itimu', mute:'Thulisa i-Little Feet',
      securePortal:'Iphothali yesikolo ephephileko', accessNote:'Ukufikelela okulawulwa sikolo ngokuya ngendima kuma-akhawunti avunyelweko we-Little Feet.', usernameLabel:'I-ID yesisebenzi namkha i-imeyili yomzali', passwordLabel:'I-PIN yokuphepha / Iphasikhodi', rememberEmail:'Khumbula i-imeyili yami', loginHelp:'Ukhohlwe i-PIN/iphasikhodi? Thintana nomphathi wesikolo.', signIn:'Ngena ngokuphepha', otherSignIn:'Ezinye iindlela zokungena', newAccount:'Umusha ku-Little Feet?', createAccount:'Yakha i-akhawunti', privacyLink:'Ubumfihlo & POPIA', termsLink:'Imibandela', soundShort:'Umsindo'
    }
  });

  const AUTH_LANGUAGE_PACKS = Object.freeze({
  "en": {
    "tagline": "Every Little Step Matters",
    "displayLanguage": "Display language",
    "soundOn": "Sound On",
    "muted": "Muted",
    "playBackground": "Play background",
    "pauseBackground": "Pause background",
    "backgroundUnavailable": "Background unavailable",
    "reducedMotionBackground": "Background motion follows your reduced-motion setting",
    "usernamePlaceholder": "e.g. teacher@school.com or Parent@school.com",
    "showPassword": "Show password",
    "hidePassword": "Hide password",
    "securityCheck": "Security check",
    "loadingSecurityCheck": "Loading security check…",
    "retryingSecurityCheck": "Retrying security check…",
    "securityUnavailable": "Security check unavailable. Select New check to retry.",
    "answerPlaceholder": "Answer",
    "newCheck": "New check",
    "humanCheckQuestion": "What is {left} {operator} {right}?",
    "providerLabel": "Sign in with a connected provider",
    "continueGoogle": "Continue with Google",
    "continueYahoo": "Continue with Yahoo",
    "continueMicrosoft": "Continue with Microsoft",
    "aboutLittleFeet": "About Little Feet",
    "tickerPlatform": "is a secure ECD, primary and secondary school operations platform",
    "tickerLearning": "Learning & development",
    "tickerAttendance": "Attendance & daily care",
    "tickerFamily": "Family communication",
    "tickerFinance": "Finance & school operations",
    "tickerSafeguarding": "Safeguarding, privacy & support",
    "tickerConnected": "One connected place for everyday school life"
  },
  "af": {
    "tagline": "Elke klein tree maak saak",
    "displayLanguage": "Vertoontaal",
    "soundOn": "Klank aan",
    "muted": "Gedemp",
    "playBackground": "Speel agtergrond",
    "pauseBackground": "Pouseer agtergrond",
    "backgroundUnavailable": "Agtergrond nie beskikbaar nie",
    "reducedMotionBackground": "Agtergrondbeweging volg jou verminderde-beweging-instelling",
    "usernamePlaceholder": "bv. teacher@school.com of Parent@school.com",
    "showPassword": "Wys wagwoord",
    "hidePassword": "Versteek wagwoord",
    "securityCheck": "Sekuriteitskontrole",
    "loadingSecurityCheck": "Laai sekuriteitskontrole…",
    "retryingSecurityCheck": "Probeer sekuriteitskontrole weer…",
    "securityUnavailable": "Sekuriteitskontrole nie beskikbaar nie. Kies Nuwe kontrole om weer te probeer.",
    "answerPlaceholder": "Antwoord",
    "newCheck": "Nuwe kontrole",
    "humanCheckQuestion": "Wat is {left} {operator} {right}?",
    "providerLabel": "Meld aan met ’n gekoppelde verskaffer",
    "continueGoogle": "Gaan voort met Google",
    "continueYahoo": "Gaan voort met Yahoo",
    "continueMicrosoft": "Gaan voort met Microsoft",
    "aboutLittleFeet": "Oor Little Feet",
    "tickerPlatform": "is ’n veilige bedryfsplatform vir ECD-, laer- en hoërskole",
    "tickerLearning": "Leer & ontwikkeling",
    "tickerAttendance": "Bywoning & daaglikse sorg",
    "tickerFamily": "Gesinskommunikasie",
    "tickerFinance": "Finansies & skoolbedrywighede",
    "tickerSafeguarding": "Beskerming, privaatheid & ondersteuning",
    "tickerConnected": "Een gekoppelde plek vir die alledaagse skoollewe"
  },
  "zu": {
    "tagline": "Zonke izinyathelo ezincane zibalulekile",
    "displayLanguage": "Ulimi lokubonisa",
    "soundOn": "Umsindo uvuliwe",
    "muted": "Kuthulisiwe",
    "playBackground": "Dlala ingemuva",
    "pauseBackground": "Misa ingemuva",
    "backgroundUnavailable": "Ingemuva alitholakali",
    "reducedMotionBackground": "Ukunyakaza kwengemuva kulandela isilungiselelo sakho sokunciphisa ukunyakaza",
    "usernamePlaceholder": "isb. teacher@school.com noma Parent@school.com",
    "showPassword": "Bonisa iphasiwedi",
    "hidePassword": "Fihla iphasiwedi",
    "securityCheck": "Ukuhlola ukuphepha",
    "loadingSecurityCheck": "Kulayishwa ukuhlola ukuphepha…",
    "retryingSecurityCheck": "Kuphindwa ukuhlola ukuphepha…",
    "securityUnavailable": "Ukuhlola ukuphepha akutholakali. Khetha Ukuhlola okusha ukuze uzame futhi.",
    "answerPlaceholder": "Impendulo",
    "newCheck": "Ukuhlola okusha",
    "humanCheckQuestion": "Kuyini {left} {operator} {right}?",
    "providerLabel": "Ngena ngomhlinzeki oxhunyiwe",
    "continueGoogle": "Qhubeka nge-Google",
    "continueYahoo": "Qhubeka nge-Yahoo",
    "continueMicrosoft": "Qhubeka nge-Microsoft",
    "aboutLittleFeet": "Mayelana ne-Little Feet",
    "tickerPlatform": "iyinkundla evikelekile yokusebenza kwe-ECD, amabanga aphansi namabanga aphezulu",
    "tickerLearning": "Ukufunda nokuthuthuka",
    "tickerAttendance": "Ukuba khona nokunakekelwa kwansuku zonke",
    "tickerFamily": "Ukuxhumana nomndeni",
    "tickerFinance": "Ezezimali nokusebenza kwesikole",
    "tickerSafeguarding": "Ukuvikelwa, ubumfihlo nosizo",
    "tickerConnected": "Indawo eyodwa exhunyiwe yempilo yesikole yansuku zonke"
  },
  "xh": {
    "tagline": "Onke amanyathelo amancinci abalulekile",
    "displayLanguage": "Ulwimi lokubonisa",
    "soundOn": "Isandi sivuliwe",
    "muted": "Kuthulisiwe",
    "playBackground": "Dlala imvelaphi",
    "pauseBackground": "Misa imvelaphi",
    "backgroundUnavailable": "Imvelaphi ayifumaneki",
    "reducedMotionBackground": "Intshukumo yemvelaphi ilandela useto lwakho lokunciphisa intshukumo",
    "usernamePlaceholder": "umz. teacher@school.com okanye Parent@school.com",
    "showPassword": "Bonisa igama lokugqitha",
    "hidePassword": "Fihla igama lokugqitha",
    "securityCheck": "Uvavanyo lokhuseleko",
    "loadingSecurityCheck": "Kulayishwa uvavanyo lokhuseleko…",
    "retryingSecurityCheck": "Kuphindwa uvavanyo lokhuseleko…",
    "securityUnavailable": "Uvavanyo lokhuseleko alufumaneki. Khetha Uvavanyo olutsha ukuze uzame kwakhona.",
    "answerPlaceholder": "Impendulo",
    "newCheck": "Uvavanyo olutsha",
    "humanCheckQuestion": "Yintoni {left} {operator} {right}?",
    "providerLabel": "Ngena ngomboneleli odityanisiweyo",
    "continueGoogle": "Qhubeka nge-Google",
    "continueYahoo": "Qhubeka nge-Yahoo",
    "continueMicrosoft": "Qhubeka nge-Microsoft",
    "aboutLittleFeet": "Malunga ne-Little Feet",
    "tickerPlatform": "liqonga elikhuselekileyo lemisebenzi ye-ECD, izikolo zamabanga aphantsi nezasesekondari",
    "tickerLearning": "Ukufunda nophuhliso",
    "tickerAttendance": "Ukuya esikolweni nokhathalelo lwemihla ngemihla",
    "tickerFamily": "Unxibelelwano nosapho",
    "tickerFinance": "Ezemali nemisebenzi yesikolo",
    "tickerSafeguarding": "Ukhuseleko, ubumfihlo nenkxaso",
    "tickerConnected": "Indawo enye edityanisiweyo yobomi besikolo bemihla ngemihla"
  },
  "nso": {
    "tagline": "Kgato ye nngwe le ye nngwe ye nnyane e bohlokwa",
    "displayLanguage": "Leleme la pontšho",
    "soundOn": "Modumo o buletšwe",
    "muted": "Modumo o timilwe",
    "playBackground": "Bapala bokamorago",
    "pauseBackground": "Emiša bokamorago",
    "backgroundUnavailable": "Bokamorago ga bo hwetšagale",
    "reducedMotionBackground": "Motsamao wa bokamorago o latela peakanyo ya gago ya go fokotša motsamao",
    "usernamePlaceholder": "mohl. teacher@school.com goba Parent@school.com",
    "showPassword": "Bontšha lentšuphetišo",
    "hidePassword": "Fihla lentšuphetišo",
    "securityCheck": "Tlhahlobo ya tšhireletšo",
    "loadingSecurityCheck": "Go laishwa tlhahlobo ya tšhireletšo…",
    "retryingSecurityCheck": "Go lekwa tlhahlobo ya tšhireletšo gape…",
    "securityUnavailable": "Tlhahlobo ya tšhireletšo ga e hwetšagale. Kgetha Tlhahlobo ye mpsha go leka gape.",
    "answerPlaceholder": "Karabo",
    "newCheck": "Tlhahlobo ye mpsha",
    "humanCheckQuestion": "{left} {operator} {right} ke bokae?",
    "providerLabel": "Tsena ka moabi yo a kgokagantšwego",
    "continueGoogle": "Tšwela pele ka Google",
    "continueYahoo": "Tšwela pele ka Yahoo",
    "continueMicrosoft": "Tšwela pele ka Microsoft",
    "aboutLittleFeet": "Ka ga Little Feet",
    "tickerPlatform": "ke sefala sa polokego sa ditiro tša ECD, dikolo tša praemari le tša sekondari",
    "tickerLearning": "Go ithuta & tlhabollo",
    "tickerAttendance": "Go ba gona & tlhokomelo ya letšatši le letšatši",
    "tickerFamily": "Kgokagano ya lapa",
    "tickerFinance": "Ditšhelete & ditiro tša sekolo",
    "tickerSafeguarding": "Tšhireletšo, sephiri & thekgo",
    "tickerConnected": "Lefelo le tee leo le kgokagantšwego bakeng sa bophelo bja sekolo bja letšatši le letšatši"
  },
  "st": {
    "tagline": "Mohato o mong le o mong o monyenyane o bohlokwa",
    "displayLanguage": "Puo ya pontsho",
    "soundOn": "Modumo o buletswe",
    "muted": "Modumo o kwetsitswe",
    "playBackground": "Bapala bokamorao",
    "pauseBackground": "Emisa bokamorao",
    "backgroundUnavailable": "Bokamorao ha bo fumanehe",
    "reducedMotionBackground": "Motsamao wa bokamorao o latela tlhophiso ya hao ya ho fokotsa motsamao",
    "usernamePlaceholder": "mohl. teacher@school.com kapa Parent@school.com",
    "showPassword": "Bontsha phasewete",
    "hidePassword": "Pata phasewete",
    "securityCheck": "Tlhahlobo ya tshireletso",
    "loadingSecurityCheck": "Ho laelwa tlhahlobo ya tshireletso…",
    "retryingSecurityCheck": "Ho lekwa tlhahlobo ya tshireletso hape…",
    "securityUnavailable": "Tlhahlobo ya tshireletso ha e fumanehe. Kgetha Tlhahlobo e ntjha ho leka hape.",
    "answerPlaceholder": "Karabo",
    "newCheck": "Tlhahlobo e ntjha",
    "humanCheckQuestion": "{left} {operator} {right} ke bokae?",
    "providerLabel": "Kena ka mofani ya hoketsweng",
    "continueGoogle": "Tswela pele ka Google",
    "continueYahoo": "Tswela pele ka Yahoo",
    "continueMicrosoft": "Tswela pele ka Microsoft",
    "aboutLittleFeet": "Ka Little Feet",
    "tickerPlatform": "ke sethala se sireletsehileng sa ditshebetso tsa ECD, dikolo tsa mathomo le tsa sekondari",
    "tickerLearning": "Ho ithuta & ntshetsopele",
    "tickerAttendance": "Boteng & tlhokomelo ya letsatsi le letsatsi",
    "tickerFamily": "Puisano ya lelapa",
    "tickerFinance": "Ditjhelete & ditshebetso tsa sekolo",
    "tickerSafeguarding": "Tshireletso, lekunutu & tshehetso",
    "tickerConnected": "Sebaka se le seng se hoketsweng bakeng sa bophelo ba sekolo ba letsatsi le letsatsi"
  },
  "tn": {
    "tagline": "Kgato nngwe le nngwe e nnye e botlhokwa",
    "displayLanguage": "Puo ya pontsho",
    "soundOn": "Modumo o tshubilwe",
    "muted": "Modumo o didimaditswe",
    "playBackground": "Tshameka bokamorao",
    "pauseBackground": "Emisa bokamorao",
    "backgroundUnavailable": "Bokamorao ga bo teng",
    "reducedMotionBackground": "Motsamao wa bokamorao o latela thulaganyo ya gago ya go fokotsa motsamao",
    "usernamePlaceholder": "sek. teacher@school.com kgotsa Parent@school.com",
    "showPassword": "Bontsha lefoko la sephiri",
    "hidePassword": "Fitlha lefoko la sephiri",
    "securityCheck": "Tlhahlobo ya tshireletso",
    "loadingSecurityCheck": "Go laisiwa tlhahlobo ya tshireletso…",
    "retryingSecurityCheck": "Go lekwa tlhahlobo ya tshireletso gape…",
    "securityUnavailable": "Tlhahlobo ya tshireletso ga e teng. Tlhopha Tlhahlobo e ntšhwa go leka gape.",
    "answerPlaceholder": "Karabo",
    "newCheck": "Tlhahlobo e ntšhwa",
    "humanCheckQuestion": "{left} {operator} {right} ke bokae?",
    "providerLabel": "Tsena ka mofani yo o golagantsweng",
    "continueGoogle": "Tswelela ka Google",
    "continueYahoo": "Tswelela ka Yahoo",
    "continueMicrosoft": "Tswelela ka Microsoft",
    "aboutLittleFeet": "Ka ga Little Feet",
    "tickerPlatform": "ke sethala se se sireletsegileng sa ditiro tsa ECD, dikolo tsa poraemari le tsa sekondari",
    "tickerLearning": "Go ithuta & tlhabololo",
    "tickerAttendance": "Go nna teng & tlhokomelo ya letsatsi le letsatsi",
    "tickerFamily": "Puisano ya lelapa",
    "tickerFinance": "Ditšhelete & ditiro tsa sekolo",
    "tickerSafeguarding": "Tshireletso, boiphitlho & tshegetso",
    "tickerConnected": "Lefelo le le lengwe le le golagantsweng la botshelo jwa sekolo jwa letsatsi le letsatsi"
  },
  "ss": {
    "tagline": "Sinyatselo ngasinye lesincane sibalulekile",
    "displayLanguage": "Lulwimi lwekubonisa",
    "soundOn": "Umsindvo uvuliwe",
    "muted": "Kuthulisiwe",
    "playBackground": "Dlala lingemuva",
    "pauseBackground": "Misa lingemuva",
    "backgroundUnavailable": "Lingemuva alitfolakali",
    "reducedMotionBackground": "Kunyakata kwelingemuva kulandzela tilungiselelo takho tekunciphisa kunyakatela",
    "usernamePlaceholder": "sib. teacher@school.com noma Parent@school.com",
    "showPassword": "Khombisa iphasiwedi",
    "hidePassword": "Fihla iphasiwedi",
    "securityCheck": "Kuhlolwa kwekuphepha",
    "loadingSecurityCheck": "Kulayishwa kuhlolwa kwekuphepha…",
    "retryingSecurityCheck": "Kuphindvwa kuhlolwa kwekuphepha…",
    "securityUnavailable": "Kuhlolwa kwekuphepha akukholakali. Khetsa Kuhlola lokusha uphindze uzame.",
    "answerPlaceholder": "Imphendvulo",
    "newCheck": "Kuhlola lokusha",
    "humanCheckQuestion": "Ngabe {left} {operator} {right} kungakanani?",
    "providerLabel": "Ngena ngemhlinzeki loxhunyiwe",
    "continueGoogle": "Chubeka nge-Google",
    "continueYahoo": "Chubeka nge-Yahoo",
    "continueMicrosoft": "Chubeka nge-Microsoft",
    "aboutLittleFeet": "Mayelana ne-Little Feet",
    "tickerPlatform": "yinkhundla lephephile yekusebenta kwe-ECD, tikolo temabanga laphansi nalasetulu",
    "tickerLearning": "Kufundza & kutfutfuka",
    "tickerAttendance": "Kuba khona & kunakekelwa kwemalanga onkhe",
    "tickerFamily": "Kuchumana kwemndeni",
    "tickerFinance": "Tetimali & imisebenti yesikolo",
    "tickerSafeguarding": "Kuvikelwa, bumfihlo & lusito",
    "tickerConnected": "Indzawo yinye lexhunyiwe yekuphila kwesikolo kwemalanga onkhe"
  },
  "ve": {
    "tagline": "Ligaṋwa ḽiṅwe na ḽiṅwe ḽiṱuku ḽi na ndeme",
    "displayLanguage": "Luambo lwa u sumbedza",
    "soundOn": "Mubvumo wo vulea",
    "muted": "Mubvumo wo fhumudziwa",
    "playBackground": "Tambani tshifanyiso tsha murahu",
    "pauseBackground": "Imisani tshifanyiso tsha murahu",
    "backgroundUnavailable": "Tshifanyiso tsha murahu a tshi wanali",
    "reducedMotionBackground": "Mutsukunyeo wa murahu u tevhela nzudzanyo yaṋu ya u fhungudza mutsukunyeo",
    "usernamePlaceholder": "tsumbo teacher@school.com kana Parent@school.com",
    "showPassword": "Sumbedzani phasiwede",
    "hidePassword": "Dzumbani phasiwede",
    "securityCheck": "Tshikambelo tsha tsireledzo",
    "loadingSecurityCheck": "Hu khou longelwa tshikambelo tsha tsireledzo…",
    "retryingSecurityCheck": "Hu khou lingwa tshikambelo tsha tsireledzo hafhu…",
    "securityUnavailable": "Tshikambelo tsha tsireledzo a tshi wanali. Nangani Tshikambelo tshiswa uri ni lingedze hafhu.",
    "answerPlaceholder": "Phindulo",
    "newCheck": "Tshikambelo tshiswa",
    "humanCheckQuestion": "{left} {operator} {right} ndi zwingana?",
    "providerLabel": "Dzhena nga muṋetshedzi o ṱumanywaho",
    "continueGoogle": "Bvelani phanḓa nga Google",
    "continueYahoo": "Bvelani phanḓa nga Yahoo",
    "continueMicrosoft": "Bvelani phanḓa nga Microsoft",
    "aboutLittleFeet": "Nga ha Little Feet",
    "tickerPlatform": "ndi pulatifomo yo tsireledzeaho ya mishumo ya ECD, zwikolo zwa phuraimari na zwa sekondari",
    "tickerLearning": "U guda & mvelaphanda",
    "tickerAttendance": "U vha hone & ṱhogomelo ya ḓuvha ḽiṅwe na ḽiṅwe",
    "tickerFamily": "Vhudavhidzano ha muṱa",
    "tickerFinance": "Masheleni & mishumo ya tshikolo",
    "tickerSafeguarding": "Tsireledzo, tshiphiri & thikhedzo",
    "tickerConnected": "Fhethu huthihi ho ṱumanywaho ha vhutshilo ha tshikolo ha ḓuvha ḽiṅwe na ḽiṅwe"
  },
  "ts": {
    "tagline": "Goza rin’wana ni rin’wana leritsongo i ra nkoka",
    "displayLanguage": "Ririmi ro kombisiwa",
    "soundOn": "Mpfumawulo wu pfuriwile",
    "muted": "Mpfumawulo wu timiwile",
    "playBackground": "Tlanga xivumbeko xa le ndzhaku",
    "pauseBackground": "Yimisa xivumbeko xa le ndzhaku",
    "backgroundUnavailable": "Xivumbeko xa le ndzhaku a xi kumeki",
    "reducedMotionBackground": "Ku famba ka le ndzhaku ku landzela xiyimiso xa wena xa ku hunguta ku famba",
    "usernamePlaceholder": "xik. teacher@school.com kumbe Parent@school.com",
    "showPassword": "Kombisa phasiwedi",
    "hidePassword": "Fihla phasiwedi",
    "securityCheck": "Xikambelo xa vuhlayiseki",
    "loadingSecurityCheck": "Ku layicha xikambelo xa vuhlayiseki…",
    "retryingSecurityCheck": "Ku ringetiwa xikambelo xa vuhlayiseki nakambe…",
    "securityUnavailable": "Xikambelo xa vuhlayiseki a xi kumeki. Hlawula Xikambelo lexintshwa ku ringeta nakambe.",
    "answerPlaceholder": "Nhlamulo",
    "newCheck": "Xikambelo lexintshwa",
    "humanCheckQuestion": "{left} {operator} {right} i yini?",
    "providerLabel": "Nghena hi muphakeri loyi a hlanganisiweke",
    "continueGoogle": "Yana mahlweni na Google",
    "continueYahoo": "Yana mahlweni na Yahoo",
    "continueMicrosoft": "Yana mahlweni na Microsoft",
    "aboutLittleFeet": "Mayelana na Little Feet",
    "tickerPlatform": "i pulatifomo leyi sirhelelekeke ya mintirho ya ECD, xikolo xa le hansi na xa sekondari",
    "tickerLearning": "Ku dyondza & nhluvuko",
    "tickerAttendance": "Ku va kona & ku hlayisiwa ka siku na siku",
    "tickerFamily": "Vuhlanganisi bya ndyangu",
    "tickerFinance": "Timali & mintirho ya xikolo",
    "tickerSafeguarding": "Vuhlayiseki, vuxokoxoko & nseketelo",
    "tickerConnected": "Ndhawu yin’we leyi hlanganisiweke ya bophelo bya xikolo bya siku na siku"
  },
  "nr": {
    "tagline": "Isinyathelo ngasinye esincani siqakathekile",
    "displayLanguage": "Ilimi lokubonisa",
    "soundOn": "Umsindo uvuliwe",
    "muted": "Kuthulisiwe",
    "playBackground": "Dlala ingemuva",
    "pauseBackground": "Misa ingemuva",
    "backgroundUnavailable": "Ingemuva ayitholakali",
    "reducedMotionBackground": "Ukunyakaza kwengemuva kulandela amasethingi wakho wokunciphisa ukunyakaza",
    "usernamePlaceholder": "isb. teacher@school.com namkha Parent@school.com",
    "showPassword": "Bonisa iphasikhodi",
    "hidePassword": "Fihla iphasikhodi",
    "securityCheck": "Ukuhlolwa kokuphepha",
    "loadingSecurityCheck": "Kulayishwa ukuhlolwa kokuphepha…",
    "retryingSecurityCheck": "Kuphindwa ukuhlolwa kokuphepha…",
    "securityUnavailable": "Ukuhlolwa kokuphepha akutholakali. Khetha Ukuhlola okutjha ukuze uzame godu.",
    "answerPlaceholder": "Ipendulo",
    "newCheck": "Ukuhlola okutjha",
    "humanCheckQuestion": "Yini {left} {operator} {right}?",
    "providerLabel": "Ngena ngomnikeli oxhunyiweko",
    "continueGoogle": "Ragela phambili nge-Google",
    "continueYahoo": "Ragela phambili nge-Yahoo",
    "continueMicrosoft": "Ragela phambili nge-Microsoft",
    "aboutLittleFeet": "Mayelana ne-Little Feet",
    "tickerPlatform": "yiplatifomu ephephileko yemisebenzi ye-ECD, iinkolo zamabanga aphasi nezamabanga aphezulu",
    "tickerLearning": "Ukufunda & ukuthuthuka",
    "tickerAttendance": "Ukuba khona & ukunakekelwa kwansuku zoke",
    "tickerFamily": "Ukukhulumisana komndeni",
    "tickerFinance": "Iimali & imisebenzi yesikolo",
    "tickerSafeguarding": "Ukuvikelwa, ubumfihlo & isekelo",
    "tickerConnected": "Indawo yinye exhunyiweko yokuphila kwesikolo kwansuku zoke"
  }
});

  const LANGUAGE_LOCALES = Object.freeze({
    en:'en-ZA', af:'af-ZA', zu:'zu-ZA', xh:'xh-ZA', nso:'nso-ZA', st:'st-ZA',
    tn:'tn-ZA', ss:'ss-ZA', ve:'ve-ZA', ts:'ts-ZA', nr:'nr-ZA'
  });

  const DRAFT_PREFIX = 'lf_dashboard_draft_v2_';
  const MAX_DRAFT_FIELDS = 300;
  const MAX_DRAFT_VALUE = 5000;
  const SENSITIVE_FIELD = /(password|passcode|\bpin\b|otp|one.?time|token|secret|signature|cvv|cvc|card.?number|access.?code|pickup.?code|payme.?payload)/i;
  const FAST_TABS = new Set(['feedTab','attendanceTab','chatTab','broadcastsTab','schoolDayTab']);
  let refreshTimer = null;
  let refreshInFlight = false;
  let draftSaveTimer = null;
  let lastDraftEditAt = 0;

  const currentAccount = () => window.getLittleFeetCurrentUser?.() || null;
  const draftKey = () => {
    const username = currentAccount()?.username || 'guest';
    return DRAFT_PREFIX + encodeURIComponent(username);
  };
  const translate = (key, language) =>
    AUTH_LANGUAGE_PACKS[language]?.[key]
    || LANGUAGE_PACKS[language]?.[key]
    || AUTH_LANGUAGE_PACKS.en[key]
    || LANGUAGE_PACKS.en[key]
    || null;
  const formatTranslation = (key, language, variables = {}) => {
    const template = translate(key, language);
    if (!template) return null;
    return Object.entries(variables).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value ?? '')),
      template
    );
  };

  function setTranslatedText(element, key, language) {
    if (!element) return;
    if (!element.dataset.lfEnglish) element.dataset.lfEnglish = element.textContent.trim();
    const translated = translate(key, language);
    element.textContent = translated || element.dataset.lfEnglish;
  }

  function applyLittleFeetLanguage(language = 'en') {
    const selected = LANGUAGE_PACKS[language] ? language : 'en';
    document.documentElement.lang = LANGUAGE_LOCALES[selected] || 'en-ZA';

    const sidebarGroups = [...document.querySelectorAll('#mainNavigation [data-nav-group] .sidebar-toggle-label span:last-child')];
    ['academics','finance','operations','safety'].forEach((key, index) => setTranslatedText(sidebarGroups[index], key, selected));
    setTranslatedText(document.querySelector('#mainNavigation .sidebar-heading'), 'overview', selected);
    setTranslatedText(document.querySelector('.nav-shortcut[onclick*="homeTab"] span'), 'home', selected);
    setTranslatedText(document.querySelector('.nav-shortcut[onclick*="openGlobalSearch"] span'), 'search', selected);
    setTranslatedText(document.querySelector('.nav-shortcut[onclick*="ticketsTab"] span'), 'help', selected);
    setTranslatedText(document.querySelector('.nav-btn[onclick*="feedTab"]'), 'schoolFeed', selected);
    setTranslatedText(document.querySelector('.nav-btn[onclick*="scheduleTab"]'), 'timetable', selected);
    setTranslatedText(document.querySelector('.nav-btn[onclick*="attendanceTab"]'), 'attendance', selected);
    setTranslatedText(document.querySelector('.nav-btn[onclick*="progressTab"]'), 'development', selected);
    setTranslatedText(document.querySelector('.nav-btn[onclick*="chatTab"]'), 'messages', selected);
    setTranslatedText(document.querySelector('.nav-btn[onclick*="financeTab"]'), 'billingFinance', selected);
    setTranslatedText(document.querySelector('.nav-btn[onclick*="settingsTab"]'), 'settings', selected);
    setTranslatedText(document.querySelector('.sidebar-signout span'), 'signOut', selected);

    const settingsTab = document.getElementById('settingsTab');
    setTranslatedText(settingsTab?.querySelector('.card-header-bar h2 span:last-child'), 'personalSettings', selected);
    const languageCard = document.getElementById('languagePreference')?.closest('.workspace-card');
    const refreshCard = document.getElementById('refreshPreference')?.closest('.workspace-card');
    const soundCard = settingsTab ? [...settingsTab.querySelectorAll('.workspace-card')].find(card => card.querySelector('[data-portal-audio-mute]')) : null;
    const navCard = settingsTab ? [...settingsTab.querySelectorAll('.workspace-card')].find(card => card.querySelector('[onclick*="toggleSidebarCollapse"]')) : null;
    const installCard = document.getElementById('pwaInstallButton')?.closest('.workspace-card');

    setTranslatedText(settingsTab?.querySelector('.profile-icon-picker')?.closest('.workspace-card')?.querySelector('h3'), 'profileIcon', selected);
    setTranslatedText(languageCard?.querySelector('h3'), 'language', selected);
    setTranslatedText(languageCard?.querySelector('p'), 'languageDescription', selected);
    setTranslatedText(refreshCard?.querySelector('h3'), 'dashboardRefresh', selected);
    setTranslatedText(refreshCard?.querySelector('p'), 'refreshDescription', selected);
    setTranslatedText(soundCard?.querySelector('h3'), 'sound', selected);
    setTranslatedText(navCard?.querySelector('h3'), 'navigation', selected);
    setTranslatedText(installCard?.querySelector('h3'), 'install', selected);

    const refresh = document.getElementById('refreshPreference');
    if (refresh) {
      const manual = refresh.querySelector('option[value="0"]');
      const smart = refresh.querySelector('option[value="auto"]');
      if (manual) manual.textContent = translate('manualRefresh', selected) || 'Manual refresh only';
      if (smart) smart.textContent = translate('autoSmart', selected) || 'Auto (smart)';
    }

    document.querySelectorAll('[data-portal-audio-mute]').forEach(button => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      const span = button.querySelector('span');
      if (span) span.textContent = translate('mute', selected) || 'Mute Little Feet';
    });
    document.querySelectorAll('[data-lf-i18n]').forEach(element => {
      setTranslatedText(element, element.dataset.lfI18n, selected);
    });
    document.querySelectorAll('[data-lf-i18n-placeholder]').forEach(element => {
      if (!element.dataset.lfEnglishPlaceholder) element.dataset.lfEnglishPlaceholder = element.getAttribute('placeholder') || '';
      element.setAttribute('placeholder', translate(element.dataset.lfI18nPlaceholder, selected) || element.dataset.lfEnglishPlaceholder);
    });
    document.querySelectorAll('[data-lf-i18n-title]').forEach(element => {
      if (!element.dataset.lfEnglishTitle) element.dataset.lfEnglishTitle = element.getAttribute('title') || '';
      element.setAttribute('title', translate(element.dataset.lfI18nTitle, selected) || element.dataset.lfEnglishTitle);
    });
    document.querySelectorAll('[data-lf-i18n-aria-label]').forEach(element => {
      if (!element.dataset.lfEnglishAriaLabel) element.dataset.lfEnglishAriaLabel = element.getAttribute('aria-label') || '';
      element.setAttribute('aria-label', translate(element.dataset.lfI18nAriaLabel, selected) || element.dataset.lfEnglishAriaLabel);
    });
    const humanPrompt = document.getElementById('loginHumanCheckPrompt');
    if (humanPrompt?.dataset.humanLeft && humanPrompt?.dataset.humanRight && humanPrompt?.dataset.humanOperator) {
      humanPrompt.textContent = formatTranslation('humanCheckQuestion', selected, {
        left: humanPrompt.dataset.humanLeft,
        operator: humanPrompt.dataset.humanOperator,
        right: humanPrompt.dataset.humanRight
      }) || humanPrompt.textContent;
    }
    const loginLanguage = document.getElementById('loginLanguagePreference');
    if (loginLanguage && loginLanguage.value !== selected) loginLanguage.value = selected;
    try {
      window.dispatchEvent(new CustomEvent('littlefeet:languagechange', { detail: { language: selected } }));
    } catch {}
    return selected;
  }

  function readGuestLanguage() {
    try {
      const stored = JSON.parse(localStorage.getItem('lf_user_preferences') || '{}');
      return LANGUAGE_PACKS[stored.language] ? stored.language : 'en';
    } catch {
      return 'en';
    }
  }

  function setLoginLanguage(language) {
    const selected = LANGUAGE_PACKS[language] ? language : 'en';
    try {
      const stored = JSON.parse(localStorage.getItem('lf_user_preferences') || '{}');
      localStorage.setItem('lf_user_preferences', JSON.stringify({ ...stored, language:selected }));
    } catch {}
    const settingsLanguage = document.getElementById('languagePreference');
    if (settingsLanguage) settingsLanguage.value = selected;
    applyLittleFeetLanguage(selected);
    return selected;
  }

  function initLoginLanguage() {
    const select = document.getElementById('loginLanguagePreference');
    if (!select) return;
    const selected = readGuestLanguage();
    select.value = selected;
    applyLittleFeetLanguage(selected);
    select.addEventListener('change', () => setLoginLanguage(select.value));
  }

  function isDraftEligible(element) {
    if (!(element instanceof HTMLElement) || element.disabled || element.dataset.noDraft !== undefined) return false;
    if (!element.matches('input, textarea, select, [contenteditable="true"]')) return false;
    const type = String(element.getAttribute('type') || '').toLowerCase();
    if (['password','file','hidden','submit','button','reset'].includes(type)) return false;
    const autocomplete = String(element.getAttribute('autocomplete') || '').toLowerCase();
    if (['current-password','new-password','one-time-code'].includes(autocomplete)) return false;
    const identity = [element.id, element.getAttribute('name'), element.getAttribute('aria-label')].filter(Boolean).join(' ');
    if (SENSITIVE_FIELD.test(identity)) return false;
    return Boolean(element.closest('#dashboardSection'));
  }

  function draftFieldKey(element, index) {
    if (element.id) return 'id:' + element.id;
    const name = element.getAttribute('name');
    const form = element.closest('form');
    if (name) return 'name:' + (form?.id || 'form') + ':' + name + ':' + index;
    return 'anon:' + (form?.id || element.closest('.tab-content')?.id || 'dashboard') + ':' + index;
  }

  function readDraftField(element) {
    if (element.matches('[contenteditable="true"]')) return { kind:'text', value:String(element.textContent || '').slice(0, MAX_DRAFT_VALUE) };
    if (element instanceof HTMLInputElement && ['checkbox','radio'].includes(element.type)) return { kind:'checked', checked:Boolean(element.checked) };
    return { kind:'value', value:String(element.value ?? '').slice(0, MAX_DRAFT_VALUE) };
  }

  function dashboardDraftSnapshot() {
    const dashboard = document.getElementById('dashboardSection');
    if (!dashboard || dashboard.classList.contains('hidden') || !currentAccount()) return null;
    const fields = {};
    [...dashboard.querySelectorAll('input, textarea, select, [contenteditable="true"]')]
      .filter(isDraftEligible)
      .slice(0, MAX_DRAFT_FIELDS)
      .forEach((element, index) => { fields[draftFieldKey(element, index)] = readDraftField(element); });
    return {
      version:2,
      savedAt:Date.now(),
      activeTab:dashboard.querySelector('.tab-content.active')?.id || 'homeTab',
      fields
    };
  }

  function saveDashboardDrafts() {
    const snapshot = dashboardDraftSnapshot();
    if (!snapshot) return false;
    try {
      const serialized = JSON.stringify(snapshot);
      if (serialized.length > 250000) return false;
      sessionStorage.setItem(draftKey(), serialized);
      return true;
    } catch {
      return false;
    }
  }

  function restoreDashboardDrafts() {
    let snapshot = null;
    try { snapshot = JSON.parse(sessionStorage.getItem(draftKey()) || 'null'); } catch { snapshot = null; }
    if (!snapshot?.fields || snapshot.version !== 2) return false;
    const dashboard = document.getElementById('dashboardSection');
    if (!dashboard || dashboard.classList.contains('hidden')) return false;
    [...dashboard.querySelectorAll('input, textarea, select, [contenteditable="true"]')]
      .filter(isDraftEligible)
      .slice(0, MAX_DRAFT_FIELDS)
      .forEach((element, index) => {
        const saved = snapshot.fields[draftFieldKey(element, index)];
        if (!saved) return;
        if (saved.kind === 'checked' && element instanceof HTMLInputElement) {
          if (element.checked === element.defaultChecked || element.checked === saved.checked) element.checked = Boolean(saved.checked);
          return;
        }
        const current = element.matches('[contenteditable="true"]') ? String(element.textContent || '') : String(element.value ?? '');
        const defaultValue = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? String(element.defaultValue || '') : '';
        if (current && current !== defaultValue && current !== String(saved.value ?? '')) return;
        if (element.matches('[contenteditable="true"]')) element.textContent = String(saved.value ?? '');
        else element.value = String(saved.value ?? '');
      });
    return true;
  }

  function clearDashboardDrafts(username = currentAccount()?.username) {
    if (!username) return;
    try { sessionStorage.removeItem(DRAFT_PREFIX + encodeURIComponent(username)); } catch {}
  }

  function activeRefreshInterval(preference) {
    if (preference === 'auto') {
      const tabId = document.querySelector('#dashboardSection .tab-content.active')?.id || 'homeTab';
      return FAST_TABS.has(tabId) ? 120000 : 300000;
    }
    const parsed = Number(preference);
    const allowed = new Set([300000,900000,1800000,3600000,7200000,86400000]);
    return allowed.has(parsed) ? parsed : 0;
  }

  async function refreshDashboardSafely() {
    if (refreshInFlight || !currentAccount() || document.hidden) return false;
    if (Date.now() - lastDraftEditAt < 4000) return false;
    refreshInFlight = true;
    try {
      saveDashboardDrafts();
      const activeTab = document.querySelector('#dashboardSection .tab-content.active')?.id || 'homeTab';
      const refreshed = await Promise.resolve(window.refreshActiveWorkspace?.(activeTab));
      if (refreshed === false) return false;
      const syncTag = document.getElementById('liveSyncTag');
      if (syncTag) syncTag.textContent = 'Last synced: Just now';
      [50, 350, 1200].forEach(delay => window.setTimeout(restoreDashboardDrafts, delay));
      return true;
    } finally {
      refreshInFlight = false;
    }
  }

  function scheduleDashboardRefresh(preference) {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = null;
    const interval = activeRefreshInterval(preference);
    if (!interval) return;
    refreshTimer = window.setTimeout(async () => {
      await refreshDashboardSafely();
      if (!currentAccount()) {
        refreshTimer = null;
        return;
      }
      const currentPreference = document.getElementById('refreshPreference')?.value || preference;
      scheduleDashboardRefresh(currentPreference);
    }, interval);
  }

  function configureDashboardAutoRefresh(preference) {
    const raw = String(preference || '0');
    const normalized = ['5000','10000','30000','60000'].includes(raw) ? 'auto' : raw;
    const field = document.getElementById('refreshPreference');
    if (field && field.value !== normalized) field.value = normalized;
    scheduleDashboardRefresh(normalized);
  }

  function stopDashboardAutoRefresh() {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = null;
    refreshInFlight = false;
  }

  function queueDraftSave() {
    lastDraftEditAt = Date.now();
    if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(saveDashboardDrafts, 250);
  }

  document.addEventListener('input', event => {
    if (isDraftEligible(event.target)) queueDraftSave();
  }, true);
  document.addEventListener('change', event => {
    if (isDraftEligible(event.target)) queueDraftSave();
  }, true);
  document.addEventListener('reset', event => {
    if (!event.target.closest?.('#dashboardSection')) return;
    window.setTimeout(saveDashboardDrafts, 0);
  }, true);
  window.addEventListener('beforeunload', saveDashboardDrafts);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      const preference = document.getElementById('refreshPreference')?.value || '0';
      scheduleDashboardRefresh(preference);
    }
  });

  Object.assign(window, {
    applyLittleFeetLanguage,
    setLoginLanguage,
    translateLittleFeetText: (key, variables = {}) => formatTranslation(key, readGuestLanguage(), variables),
    getLittleFeetLanguage: readGuestLanguage,
    saveDashboardDrafts,
    restoreDashboardDrafts,
    clearDashboardDrafts,
    configureDashboardAutoRefresh,
    stopDashboardAutoRefresh,
    refreshDashboardSafely
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLoginLanguage, { once:true });
  } else {
    initLoginLanguage();
  }
})();
