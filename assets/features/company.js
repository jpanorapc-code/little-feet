// company workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

async function loadCompanyClients() {
  const host = document.getElementById('companyClientsContent');
  if (!host || !(isFullAccessUser() || currentUser?.role === 'crm')) return;
  const session = workspaceSessionKey();
  try {
    const response = await fetch('/api/company/clients');
    const clients = await response.json();
    if (session !== workspaceSessionKey()) return;
    if (!response.ok) throw new Error(clients.message || 'Could not load clients.');
    host.replaceChildren();
    if (!clients.length) { host.textContent = 'No schools registered yet.'; return; }
    for (const client of clients) {
      const card = document.createElement('div'); card.className = 'workspace-card';
      const name = document.createElement('h3'); name.textContent = client.name;
      const detail = document.createElement('p'); detail.textContent = [client.area, client.status].filter(Boolean).join(' · ');
      const label = document.createElement('label'); label.textContent = 'Your client follow-up note';
      const input = document.createElement('textarea'); input.maxLength = 2000; input.value = client.note || ''; label.append(input);
      const save = document.createElement('button'); save.type = 'button'; save.className = 'action-btn'; save.textContent = 'Save note';
      const status = document.createElement('p'); status.setAttribute('role', 'status');
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          const result = await fetch('/api/company/clients/' + encodeURIComponent(client.id), { method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify({note:input.value}) });
          const data = await result.json(); if (session !== workspaceSessionKey()) return;
          if (!result.ok) throw new Error(data.message || 'Could not save note.'); status.textContent = 'Saved.';
        } catch (error) { if (session === workspaceSessionKey()) status.textContent = error.message; }
        finally { save.disabled = false; }
      });
      card.append(name, detail, label, save, status); host.append(card);
    }
  } catch (error) { if (session === workspaceSessionKey()) host.textContent = error.message; }
}
