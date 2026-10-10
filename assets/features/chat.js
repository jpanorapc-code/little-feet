// chat workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function switchChatMode(mode) {
  if (currentUser?.role === 'parent' && mode === 'group') mode = 'direct';
  const groupSec = document.getElementById('groupChatSection');
  const directSec = document.getElementById('directChatSection');
  const btnGroup = document.getElementById('btnGroupChatMode');
  const btnDirect = document.getElementById('btnDirectChatMode');

  if (mode === 'group') {
    groupSec.classList.remove('hidden');
    directSec.classList.add('hidden');
    btnGroup.style.opacity = '1';
    btnDirect.style.opacity = '0.65';
  } else {
    groupSec.classList.add('hidden');
    directSec.classList.remove('hidden');
    btnGroup.style.opacity = '0.65';
    btnDirect.style.opacity = '1';
    loadDirectChatUsers();
  }
}

function safeChatColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#2dd4bf';
}

async function loadChatGroups() {
  try {
    const res = await fetch('/api/chat/groups');
    const groups = await res.json();
    const select = document.getElementById('chatGroupSelect');
    if (!select) return;

    select.innerHTML = groups.length
      ? groups.map(g => `<option value="${escapeWorkspaceText(g.id)}">${escapeWorkspaceText(g.groupName)}</option>`).join('')
      : '<option value="" selected>No group channels yet</option>';
    select.disabled = !groups.length;
    
    const delBtn = document.getElementById('btnDeleteGroup');
    if (delBtn && currentUser && isFullAccessUser()) {
      if (!select.value || select.value === 'general') {
        delBtn.classList.add('hidden');
      } else {
        delBtn.classList.remove('hidden');
      }
    }
  } catch (e) {
    logAppError('ERR_CHAT_GRP', 'Failed to retrieve staff chat groups.');
  }
}

async function loadGroupChatMessages() {
  const select = document.getElementById('chatGroupSelect');
  if (!select) return;
  const groupId = select.value;
  const chatBox = document.getElementById('chatMessages');
  if (!groupId) {
    if (chatBox) chatBox.innerHTML = '<p style="font-size:0.85rem; color:var(--text-muted);">No group channels have been created yet.</p>';
    return;
  }

  const delBtn = document.getElementById('btnDeleteGroup');
  if (delBtn && currentUser && isFullAccessUser()) {
    if (groupId === 'general') {
      delBtn.classList.add('hidden');
    } else {
      delBtn.classList.remove('hidden');
    }
  }

  try {
    const res = await fetch(`/api/chat/messages/${encodeURIComponent(groupId)}`);
    const msgs = await res.json();
    if (res.status === 404) {
      if (chatBox) chatBox.innerHTML = '<p style="font-size:0.85rem; color:var(--text-muted);">This channel is no longer available. Refreshing the channel list…</p>';
      await loadChatGroups();
      return;
    }
    if (!res.ok || !Array.isArray(msgs)) throw new Error(msgs.message || 'Group channel unavailable.');

    chatBox.innerHTML = msgs.length
      ? msgs.map(m => {
          const isMe = currentUser && m.sender === currentUser.username;
          const moderation = isFullAccessUser() && m.id
            ? `<button type="button" class="chat-delete-btn" onclick="deleteGroupChatMessage('${encodeInlineIdentifier(groupId)}','${encodeInlineIdentifier(m.id)}')">Delete</button>` : '';
          return `
            <div class="msg ${isMe ? 'sent' : 'received'}">
              <strong style="color:${safeChatColor(m.textColor)};">${escapeWorkspaceText(m.sender)}:</strong> ${escapeWorkspaceText(m.message)}
              <span class="msg-timestamp">${escapeWorkspaceText(m.timestamp || '')}</span>${moderation}
            </div>`;
        }).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No messages in this channel yet.</p>';
    
    chatBox.scrollTop = chatBox.scrollHeight;
  } catch (e) {
    logAppError('ERR_CHAT_MSG', 'Unable to fetch group messages.');
  }
}

async function deleteGroupChatMessage(encodedGroupId, encodedMessageId) {
  if (!currentUser || !isFullAccessUser() || !confirm('Delete this chat message?')) return;
  const groupId = decodeURIComponent(String(encodedGroupId || ''));
  const messageId = decodeURIComponent(String(encodedMessageId || ''));
  const response = await fetch(`/api/chat/messages/${encodeURIComponent(groupId)}/${encodeURIComponent(messageId)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser.username }) });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to delete this message.');
  loadGroupChatMessages();
}

async function loadDirectChatUsers() {
  try {
    if (!currentUser) return;
    const res = await fetch(`/api/chat/direct/users?username=${encodeURIComponent(currentUser.username)}`);
    const users = await res.json();
    const select = document.getElementById('directRecipientSelect');
    if (!select) return;

    if (!res.ok) throw new Error(users.message || 'Unable to load approved contacts.');
    const filtered = users.filter(u => u.username !== currentUser.username);
    const prompt = currentUser.role === 'parent' ? 'Select your child\'s teacher or principal...' : 'Select approved school contact...';
    select.innerHTML = `<option value="">${prompt}</option>` +
      filtered.map(u => `<option value="${escapeWorkspaceText(u.username)}">${escapeWorkspaceText(u.name || u.username)} (${escapeWorkspaceText(String(u.role || '').toUpperCase())})</option>`).join('');
  } catch (e) {
    logAppError('ERR_DIRECT_USERS', 'Failed to retrieve direct messaging contacts.');
  }
}

async function loadDirectChatMessages() {
  const select = document.getElementById('directRecipientSelect');
  if (!select || !select.value || !currentUser) {
    document.getElementById('directChatMessages').innerHTML = '<p style="font-size:0.85rem; color:var(--text-muted);">Please select a target user from the dropdown menu to load direct messages.</p>';
    return;
  }

  const recipient = select.value;
  try {
    const res = await fetch(`/api/chat/direct/${encodeURIComponent(currentUser.username)}/${encodeURIComponent(recipient)}`);
    const msgs = await res.json();
    const box = document.getElementById('directChatMessages');

    box.innerHTML = msgs.length
      ? msgs.map(m => {
          const isMe = m.sender === currentUser.username;
          const moderation = isFullAccessUser() && m.id
            ? `<button type="button" class="chat-delete-btn" onclick="deleteDirectChatMessage('${encodeInlineIdentifier(m.id)}')">Delete</button>` : '';
          return `
            <div class="msg ${isMe ? 'sent' : 'received'}">
              <strong style="color:${safeChatColor(m.textColor)};">${escapeWorkspaceText(m.sender)}:</strong> ${escapeWorkspaceText(m.message)}
              <span class="msg-timestamp">${escapeWorkspaceText(m.timestamp || '')}</span>${moderation}
            </div>`;
        }).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No private messages exchange recorded yet.</p>';

    box.scrollTop = box.scrollHeight;
  } catch (e) {
    logAppError('ERR_DIRECT_MSG', 'Unable to fetch private messages.');
  }
}

async function deleteDirectChatMessage(encodedMessageId) {
  if (!currentUser || !isFullAccessUser() || !confirm('Delete this private message?')) return;
  const messageId = decodeURIComponent(String(encodedMessageId || ''));
  const response = await fetch(`/api/chat/direct/${encodeURIComponent(messageId)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser.username }) });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to delete this message.');
  loadDirectChatMessages();
}
