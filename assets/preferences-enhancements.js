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
      navigation:'Navigasie', install:'Installeer Little Feet', theme:'Tema', mute:'Demp Little Feet'
    },
    zu: {
      overview:'Uhlolojikelele', academics:'Ezemfundo', finance:'Ezezimali', operations:'Imisebenzi', safety:'Ukuphepha', schoolFeed:'Izindaba zesikole', timetable:'Uhlelo lwezikhathi', attendance:'Ukuba khona', development:'Intuthuko', messages:'Imiyalezo', billingFinance:'Izinkokhelo & Ezezimali',
      home:'Ikhaya', search:'Sesha', help:'Thola usizo', settings:'Izilungiselelo', signOut:'Phuma',
      personalSettings:'Izilungiselelo zomuntu', profileIcon:'Isithonjana sephrofayela', language:'Ulimi',
      languageDescription:'Khetha ulimi oluthandayo. Umbhalo ongakahunyushwa uzohlala ngesiNgisi ukuze lutho lungalahleki.',
      dashboardRefresh:'Vuselela ideshibhodi', refreshDescription:'Gcina ideshibhodi ivuselelwe ngaphandle kokulahlekelwa umbhalo ongakawugcini.',
      manualRefresh:'Vuselela mathupha kuphela', autoSmart:'Okuzenzakalelayo (okuhlakaniphile)', sound:'Umsindo we-Little Feet',
      navigation:'Ukuzulazula', install:'Faka i-Little Feet', theme:'Itimu', mute:'Thulisa i-Little Feet'
    },
    xh: {
      overview:'Ushwankathelo', academics:'Imfundo', finance:'Ezemali', operations:'Imisebenzi', safety:'Ukhuseleko', schoolFeed:'Iindaba zesikolo', timetable:'Itheyibhile yexesha', attendance:'Ukuya esikolweni', development:'Uphuhliso', messages:'Imiyalezo', billingFinance:'Amatyala & Ezemali',
      home:'Ikhaya', search:'Khangela', help:'Fumana uncedo', settings:'Izicwangciso', signOut:'Phuma',
      personalSettings:'Izicwangciso zobuqu', profileIcon:'I-ayikhoni yeprofayile', language:'Ulwimi',
      languageDescription:'Khetha ulwimi olukhethayo. Umbhalo ongekaguqulelwa uya kuhlala ngesiNgesi ukuze kungabikho nto ilahlekileyo.',
      dashboardRefresh:'Hlaziya ideshibhodi', refreshDescription:'Gcina ideshibhodi ihlaziyiwe ngaphandle kokulahlekelwa yidrafti engekagcinwa.',
      manualRefresh:'Hlaziya ngesandla kuphela', autoSmart:'Okuzenzekelayo (okukrelekrele)', sound:'Isandi se-Little Feet',
      navigation:'Ukukhangela', install:'Faka i-Little Feet', theme:'Umxholo', mute:'Thulisa i-Little Feet'
    },
    nso: {
      overview:'Kakaretšo', academics:'Thuto', finance:'Ditšhelete', operations:'Ditiro', safety:'Polokego', schoolFeed:'Ditaba tša sekolo', timetable:'Lenaneo la dinako', attendance:'Go ba gona', development:'Tlhabollo', messages:'Melaetša', billingFinance:'Ditefelo & Ditšhelete',
      home:'Gae', search:'Nyaka', help:'Hwetša thušo', settings:'Dipeakanyo', signOut:'Tšwa',
      personalSettings:'Dipeakanyo tša gago', profileIcon:'Seswantšho sa profaele', language:'Leleme',
      languageDescription:'Kgetha leleme leo o le ratago. Sengwalwa seo se sego sa fetolelwa se tla dula e le Seisemane.',
      dashboardRefresh:'Mpshafatša dashboard', refreshDescription:'Boloka dashboard e le nakong ntle le go lahlegelwa ke sengwalwa seo se sego sa bolokwa.',
      manualRefresh:'Mpshafatšo ya seatla feela', autoSmart:'Ka go itiragalela', sound:'Modumo wa Little Feet',
      navigation:'Tshepetšo', install:'Tsenya Little Feet', theme:'Sehlogo', mute:'Homotša Little Feet'
    },
    st: {
      overview:'Kakaretso', academics:'Thuto', finance:'Ditjhelete', operations:'Tshebetso', safety:'Polokeho', schoolFeed:'Ditaba tsa sekolo', timetable:'Lenaneo la nako', attendance:'Boteng', development:'Ntshetsopele', messages:'Melaetsa', billingFinance:'Ditefiso & Ditjhelete',
      home:'Lehae', search:'Batla', help:'Fumana thuso', settings:'Ditlhophiso', signOut:'Tsoa',
      personalSettings:'Ditlhophiso tsa hao', profileIcon:'Letshwao la profaele', language:'Puo',
      languageDescription:'Kgetha puo eo o e ratang. Mongolo o sa fetolelwang o tla sala ka Senyesemane hore ho se ke ha lahleha letho.',
      dashboardRefresh:'Ntjhafatsa dashboard', refreshDescription:'Boloka dashboard e le ntjha ntle le ho lahlehelwa ke mongolo o sa bolokwang.',
      manualRefresh:'Ntjhafatso ya letsoho feela', autoSmart:'Ka boiketsetso', sound:'Modumo wa Little Feet',
      navigation:'Tsamaiso', install:'Kenya Little Feet', theme:'Sehlooho', mute:'Kgutsisa Little Feet'
    },
    tn: {
      overview:'Kakaretso', academics:'Thuto', finance:'Ditšhelete', operations:'Ditiro', safety:'Polokesego', schoolFeed:'Dikgang tsa sekolo', timetable:'Lenaneo la nako', attendance:'Go nna teng', development:'Tlhabololo', messages:'Melaetsa', billingFinance:'Dituelo & Ditšhelete',
      home:'Gae', search:'Batla', help:'Fumana thuso', settings:'Dithulaganyo', signOut:'Tswa',
      personalSettings:'Dithulaganyo tsa gago', profileIcon:'Letshwao la profaele', language:'Puo',
      languageDescription:'Tlhopha puo e o e ratang. Mafoko a a sa ranolwang a tla sala ka Sekgoa gore go se ka ga latlhega sepe.',
      dashboardRefresh:'Ntšhwafatsa dashboard', refreshDescription:'Boloka dashboard e le mo nakong ntle le go latlhegelwa ke se o sa se bolokang.',
      manualRefresh:'Ntšhwafatso ya seatla fela', autoSmart:'Ka boitiriso', sound:'Modumo wa Little Feet',
      navigation:'Tsamaiso', install:'Tsenya Little Feet', theme:'Setlhogo', mute:'Didimatša Little Feet'
    },
    ss: {
      overview:'Sibutsetelo', academics:'Temfundvo', finance:'Tetimali', operations:'Imisebenti', safety:'Kuphepha', schoolFeed:'Tindzaba tesikolo', timetable:'Luhlelo lwesikhatsi', attendance:'Kuba khona', development:'Kutfutfuka', messages:'Imilayeto', billingFinance:'Kubhadala & Tetimali',
      home:'Ekhaya', search:'Sesha', help:'Tfola lusito', settings:'Tilungiselelo', signOut:'Phuma',
      personalSettings:'Tilungiselelo temuntfu', profileIcon:'Sifaniso sephrofayili', language:'Lulwimi',
      languageDescription:'Khetsa lulwimi lolutsandzako. Lokungakahunyushwa kutawuhlala ngesiNgisi kuze kungalahleki lutfo.',
      dashboardRefresh:'Vuselela ideshibhodi', refreshDescription:'Gcina ideshibhodi ivuselelekile ngaphandle kwekulahlekelwa ngumsebenti longakagcinwa.',
      manualRefresh:'Vuselela ngesandla kuphela', autoSmart:'Ngekutentakalela', sound:'Umsindvo wa Little Feet',
      navigation:'Kuhamba', install:'Faka Little Feet', theme:'Sihloko', mute:'Thulisa Little Feet'
    },
    ve: {
      overview:'Manweledzo', academics:'Pfunzo', finance:'Masheleni', operations:'Mishumo', safety:'Tsireledzo', schoolFeed:'Mafhungo a tshikolo', timetable:'Mbekanyamushumo ya tshifhinga', attendance:'U vha hone', development:'Mvelaphanda', messages:'Milaedza', billingFinance:'Mbadelo & Masheleni',
      home:'Hayani', search:'Ṱoḓa', help:'Wana thuso', settings:'Nzudzanyo', signOut:'Bva',
      personalSettings:'Nzudzanyo dzaṋu', profileIcon:'Tshiga tsha phurofaiḽi', language:'Luambo',
      languageDescription:'Nangani luambo lune na lu takalela. Zwi sa athu ṱalutshedzelwa zwi ḓo dzula zwi nga Luisimane uri hu sa xele tshithu.',
      dashboardRefresh:'Dovholosa dashboard', refreshDescription:'Dzudzanyani dashboard i dzule i ya zwino hu songo xela zwe na sa athu vhulunga.',
      manualRefresh:'Dovholosa nga tshanda fhedzi', autoSmart:'Nga u tou itea', sound:'Mubvumo wa Little Feet',
      navigation:'Tshepetsho', install:'Dzhenisa Little Feet', theme:'Thero', mute:'Fhumudzani Little Feet'
    },
    ts: {
      overview:'Nkatsakanyo', academics:'Dyondzo', finance:'Timali', operations:'Mintirho', safety:'Vuhlayiseki', schoolFeed:'Mahungu ya xikolo', timetable:'Xiyimiso xa nkarhi', attendance:'Ku va kona', development:'Nhluvuko', messages:'Mahungu', billingFinance:'Mibalo & Timali',
      home:'Kaya', search:'Lava', help:'Kuma mpfuno', settings:'Swiyimiso', signOut:'Huma',
      personalSettings:'Swiyimiso swa wena', profileIcon:'Xifaniso xa phurofayili', language:'Ririmi',
      languageDescription:'Hlawula ririmi leri u ri tsakelaka. Marito lama nga si hundzuluxiwaka ma ta sala hi Xinghezi leswaku ku nga lahleki leswi u swi endleke.',
      dashboardRefresh:'Pfuxeta dashboard', refreshDescription:'Hlayisa dashboard yi ri ya sweswi handle ko lahlekeriwa hi leswi u nga si swi hlayisa.',
      manualRefresh:'Pfuxeta hi voko ntsena', autoSmart:'Hi ku tisungulela', sound:'Mpfumawulo wa Little Feet',
      navigation:'Ku fambafamba', install:'Nghenisa Little Feet', theme:'Nhlokomhaka', mute:'Timela mpfumawulo wa Little Feet'
    },
    nr: {
      overview:'Isirhunyezo', academics:'Ifundo', finance:'Iimali', operations:'Imisebenzi', safety:'Ukuphepha', schoolFeed:'Iindaba zesikolo', timetable:'Irhelo lesikhathi', attendance:'Ukuba khona', development:'Ukuthuthuka', messages:'Imilayezo', billingFinance:'Ukubhadela & Iimali',
      home:'Ekhaya', search:'Funa', help:'Thola isizo', settings:'Amasethingi', signOut:'Phuma',
      personalSettings:'Amasethingi womuntu', profileIcon:'Isithonjana sephrofayili', language:'Ilimi',
      languageDescription:'Khetha ilimi olithandako. Okungakatjhugululwa kuzokuhlala ngesiNgisi ukuze kungalahleki litho.',
      dashboardRefresh:'Vuselela ideshibhodi', refreshDescription:'Gcina ideshibhodi ivuselelwe ngaphandle kokulahlekelwa msebenzi ongakagcinwa.',
      manualRefresh:'Vuselela ngesandla kwaphela', autoSmart:'Ngokuzenzakalela', sound:'Umsindo we-Little Feet',
      navigation:'Ukuzulazula', install:'Faka i-Little Feet', theme:'Itimu', mute:'Thulisa i-Little Feet'
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
  const translate = (key, language) => LANGUAGE_PACKS[language]?.[key] || LANGUAGE_PACKS.en[key] || null;

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
    return selected;
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
      return FAST_TABS.has(tabId) ? 30000 : 120000;
    }
    const parsed = Number(preference);
    const allowed = new Set([5000,10000,30000,60000,300000,900000,1800000,3600000,7200000,86400000]);
    return allowed.has(parsed) ? parsed : 0;
  }

  async function refreshDashboardSafely() {
    if (refreshInFlight || !currentAccount() || document.hidden) return false;
    if (Date.now() - lastDraftEditAt < 4000) return false;
    refreshInFlight = true;
    try {
      saveDashboardDrafts();
      const activeTab = document.querySelector('#dashboardSection .tab-content.active')?.id || 'homeTab';
      await Promise.resolve(window.loadAllData?.());
      window.loadWorkspaceOnDemand?.(activeTab);
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
      const currentPreference = document.getElementById('refreshPreference')?.value || preference;
      scheduleDashboardRefresh(currentPreference);
    }, interval);
  }

  function configureDashboardAutoRefresh(preference) {
    scheduleDashboardRefresh(String(preference || '0'));
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
    saveDashboardDrafts,
    restoreDashboardDrafts,
    clearDashboardDrafts,
    configureDashboardAutoRefresh,
    stopDashboardAutoRefresh,
    refreshDashboardSafely
  });
})();
