// preferences workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function toggleDarkMode() {
  document.body.classList.toggle('light-mode');
}

function normalizeProfileIcon(icon) {
  const migrated = legacyProfileIconMap[icon] || icon;
  return profileIcons.includes(migrated) ? migrated : profileIcons[0];
}

function profileIconMarkup(icon) {
  const selectedIcon = normalizeProfileIcon(icon);
  return `<svg class="profile-avatar-image profile-avatar-${selectedIcon}" viewBox="0 0 128 128" aria-hidden="true" focusable="false"><use href="/assets/profile/penguin-profile-avatars.svg?v=20261004-portraits-v3#avatar-${selectedIcon}"></use></svg>`;
}

function getProfileIconStorageKey() {
  const account = currentUser?.username || 'guest';
  return `lf_profile_icon_${encodeURIComponent(account)}`;
}

function applyProfileIcon(icon = localStorage.getItem(getProfileIconStorageKey()) || profileIcons[0]) {
  const selectedIcon = normalizeProfileIcon(icon);
  if (icon !== selectedIcon) localStorage.setItem(getProfileIconStorageKey(), selectedIcon);
  const avatar = document.getElementById('userAvatar');
  if (avatar) {
    avatar.innerHTML = profileIconMarkup(selectedIcon);
    avatar.title = `${profileIconLabels[selectedIcon]} · ${currentUser?.name || currentUser?.username || 'Profile'}`;
  }
  document.querySelectorAll('.profile-icon-choice').forEach(button => {
    const selected = button.dataset.profileIcon === selectedIcon;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function selectProfileIcon(icon) {
  const selectedIcon = normalizeProfileIcon(icon);
  if (!profileIcons.includes(selectedIcon)) return;
  localStorage.setItem(getProfileIconStorageKey(), selectedIcon);
  applyProfileIcon(selectedIcon);
}

function userPreferencesStorageKey() {
  return currentUser?.username ? `lf_user_preferences_${encodeURIComponent(currentUser.username)}` : 'lf_user_preferences';
}

function readUserPreferences() {
  try {
    const accountValue = localStorage.getItem(userPreferencesStorageKey());
    if (accountValue) return JSON.parse(accountValue);
    const legacyValue = localStorage.getItem('lf_user_preferences');
    return legacyValue ? JSON.parse(legacyValue) : {};
  } catch {
    return {};
  }
}

function applyUserPreferences() {
  const preferences = readUserPreferences();
  const language = document.getElementById('languagePreference');
  const refresh = document.getElementById('refreshPreference');
  if (language) language.value = preferences.language || 'en';
  if (refresh) refresh.value = preferences.refresh || '0';
  if (window.applyLittleFeetLanguage) window.applyLittleFeetLanguage(preferences.language || 'en');
  else document.documentElement.lang = preferences.language || 'en';
  const sidebarCollapsed = localStorage.getItem('lf_sidebar_collapsed') === 'true';
  document.getElementById('dashboardSection')?.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  document.getElementById('mainNavigation')?.classList.toggle('is-collapsed', sidebarCollapsed);
  restoreSidebarGroups();
  applyProfileIcon();
  if (dashboardRefreshTimer) clearInterval(dashboardRefreshTimer);
  dashboardRefreshTimer = null;
  if (window.configureDashboardAutoRefresh) window.configureDashboardAutoRefresh(preferences.refresh || '0');
}

function saveUserPreferences() {
  const preferences = {
    language: document.getElementById('languagePreference')?.value || 'en',
    refresh: document.getElementById('refreshPreference')?.value || '0'
  };
  localStorage.setItem(userPreferencesStorageKey(), JSON.stringify(preferences));
  applyUserPreferences();
}
