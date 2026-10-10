// store workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function restoreRememberedLogin() {
  try {
    const username = localStorage.getItem(SAVED_LOGIN_USERNAME_KEY) || '';
    if (!username) return;
    const usernameInput = document.getElementById('loginUsername');
    const rememberInput = document.getElementById('rememberLogin');
    if (usernameInput && !usernameInput.value) usernameInput.value = username;
    if (rememberInput) rememberInput.checked = true;
  } catch {}
}

async function storedCustomWallpaper() {
  const database = await openWallpaperDatabase();
  const blob = await new Promise((resolve, reject) => {
    const request = database.transaction('wallpapers', 'readonly').objectStore('wallpapers').get('active');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Unable to read the wallpaper.'));
  });
  database.close();
  return blob;
}

async function restoreCustomWallpaper() {
  const blob = await storedCustomWallpaper();
  if (blob) {
    applyCustomWallpaper(blob);
    const status = document.getElementById('customWallpaperStatus');
    if (status) status.textContent = `${blob.name || 'Your custom wallpaper'} is saved on this device and active.`;
  } else {
    applyCustomWallpaper(null);
  }
}

function restoreSidebarGroups() {
  let collapsed = [];
  try { collapsed = JSON.parse(localStorage.getItem('lf_collapsed_nav_groups') || '[]'); } catch { collapsed = []; }
  document.querySelectorAll('[data-nav-group]').forEach(group => group.classList.toggle('is-collapsed', collapsed.includes(group.querySelector('.sidebar-group-toggle')?.textContent.trim())));
}

function storeOrderStatusClass(order) {
  const payment = String(order?.paymentStatus || '').toLowerCase();
  const fulfilment = String(order?.fulfilmentStatus || '').toLowerCase();
  if (payment === 'paid' && ['ready_to_prepare','preparing','ready_for_collection','collected'].includes(fulfilment)) return 'info';
  if (['refunded','cancelled'].includes(fulfilment) || payment === 'refunded') return 'urgent';
  if (['payment_failed','payment_expired','stock_review_required'].includes(fulfilment) || payment === 'failed') return 'urgent';
  return '';
}

function storeOrderStatusLabel(order) {
  const fulfilment = String(order?.fulfilmentStatus || '').trim();
  const payment = String(order?.paymentStatus || 'awaiting_payment').trim();
  return (fulfilment || payment).replaceAll('_', ' ').toUpperCase();
}

function storeOrderActions(order, canManage) {
  const payment = String(order?.paymentStatus || '').toLowerCase();
  const fulfilment = String(order?.fulfilmentStatus || '').toLowerCase();
  const actions = [];
  if (payment !== 'paid' && !['refunded','cancelled','payment_failed','payment_expired'].includes(fulfilment)) {
    if (currentUser?.role === 'parent' || canManage) actions.push(`<button type="button" class="action-btn btn-red" onclick="cancelStoreOrder('${escapeWorkspaceText(order.id)}')">Cancel order</button>`);
    if (canManage) actions.push(`<button type="button" class="action-btn btn-green" onclick="recordStorePayment('${escapeWorkspaceText(order.id)}','${escapeWorkspaceText(order.reference)}',${Number(order.amount || 0)})">Record cleared payment</button>`);
  }
  if (canManage && payment === 'paid' && fulfilment !== 'refunded') {
    if (!['preparing','ready_for_collection','collected'].includes(fulfilment)) actions.push(`<button type="button" class="action-btn btn-blue" onclick="updateStoreFulfilment('${escapeWorkspaceText(order.id)}','preparing')">Start preparing</button>`);
    if (!['ready_for_collection','collected'].includes(fulfilment)) actions.push(`<button type="button" class="action-btn btn-green" onclick="updateStoreFulfilment('${escapeWorkspaceText(order.id)}','ready_for_collection')">Ready for collection</button>`);
    if (fulfilment !== 'collected') actions.push(`<button type="button" class="action-btn btn-green" onclick="updateStoreFulfilment('${escapeWorkspaceText(order.id)}','collected')">Collected</button>`);
    actions.push(`<button type="button" class="action-btn btn-red" onclick="recordStoreRefund('${escapeWorkspaceText(order.id)}','${escapeWorkspaceText(order.reference)}',${Number(order.amount || 0)})">Record confirmed refund</button>`);
  }
  return actions.length ? `<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px;">${actions.join('')}</div>` : '';
}

async function loadStoreItems() {
  const box = document.getElementById('storeItems');
  if (!box || !currentUser) return;
  try {
    const [storeResponse, ordersResponse] = await Promise.all([fetch('/api/store'), fetch('/api/store/orders')]);
    const store = await storeResponse.json();
    const orders = ordersResponse.ok ? await ordersResponse.json() : [];
    if (!storeResponse.ok) throw new Error(store.message);
    document.getElementById('storeWelcome').textContent = `${store.schoolName} store`;
    window.schoolStoreProducts = store.products || [];
    window.schoolStoreOrders = Array.isArray(orders) ? orders : [];
    const productCards = store.products?.length ? store.products.map(product => {
      const reserved = store.canManage && Number(product.reservedQuantity || 0) > 0 ? `<p class="meta" style="margin:5px 0 0;">Physical stock: ${Number(product.physicalStockQuantity || 0)} · Reserved awaiting payment: ${Number(product.reservedQuantity || 0)}</p>` : '';
      return `<article class="store-item"><span class="badge-tag info">AVAILABLE: ${product.stockQuantity}</span><h3 style="margin:10px 0 6px;">${escapeWorkspaceText(product.name)}</h3><strong style="font-size:1.2rem;color:#2dd4bf;">${formatSubscriptionMoney(product.price)}</strong>${reserved}<p style="margin:8px 0 12px;color:var(--text-muted);font-size:.82rem;">Payment reference and confirmed total are shown before you continue to payment.</p>${currentUser.role === 'parent' ? `<button type="button" class="submit-btn" onclick="openStoreCheckout('${product.id}')" ${product.stockQuantity < 1 ? 'disabled' : ''}>${product.stockQuantity < 1 ? 'Out of stock' : 'Buy item'}</button>` : ''}${store.canManage ? `<button type="button" class="action-btn btn-red" style="margin-top:8px;" onclick="removeStoreProduct('${product.id}')">Remove item</button>` : ''}</article>`;
    }).join('') : `<article class="store-item" style="grid-column:1/-1;text-align:center;"><div style="font-size:2.2rem;margin-bottom:10px;">🛍️</div><h3 style="margin-bottom:8px;">No store items yet</h3><p style="color:var(--text-muted);margin:0;">An administrator can add uniforms, stationery, activity packs or other school items here.</p></article>`;
    const safeStoreUrl = typeof store.webStoreUrl === 'string' && /^https:\/\//i.test(store.webStoreUrl) ? store.webStoreUrl : '';
    const externalStore = safeStoreUrl ? `<article class="store-item" style="grid-column:1/-1;"><span class="badge-tag info">OFFICIAL EXTERNAL SCHOOL STORE</span><h3 style="margin:10px 0 5px;">${escapeWorkspaceText(store.schoolName)} web store</h3><p style="margin:0 0 12px;color:var(--text-muted);">Browse items managed by the school’s linked web-store provider.</p><a class="action-btn btn-blue" style="display:inline-block;text-decoration:none;" href="${safeStoreUrl}" target="_blank" rel="noopener noreferrer">Visit official web store</a></article>` : '';
    const manager = store.canManage ? `<article class="store-item" style="grid-column:1/-1;"><h3 style="margin-bottom:7px;">Add school-store item</h3><form onsubmit="addStoreProduct(event)" style="display:grid;grid-template-columns:minmax(180px,1fr) 130px 130px auto;gap:8px;align-items:end;"><label>Item name<input name="name" required placeholder="e.g. School jersey"></label><label>Price (R)<input name="price" type="number" min="0.01" step="0.01" required></label><label>Stock quantity<input name="stockQuantity" type="number" min="0" step="1" required></label><button class="submit-btn">Add item</button></form></article>` : '';
    const orderTitle = currentUser.role === 'parent' ? 'Your recent orders' : 'Store orders';
    const orderList = window.schoolStoreOrders.length
      ? window.schoolStoreOrders.slice(0, 30).map(order => `<div class="item-row" style="align-items:flex-start;"><div><strong>${escapeWorkspaceText(order.productName)} × ${Number(order.quantity || 0)}</strong> <span class="badge-tag ${storeOrderStatusClass(order)}">${escapeWorkspaceText(storeOrderStatusLabel(order))}</span><p style="margin:5px 0;">${formatSubscriptionMoney(order.amount)} · Ref <strong>${escapeWorkspaceText(order.reference)}</strong></p><p class="meta">Created ${escapeWorkspaceText(new Date(order.createdAt).toLocaleString())}${order.paidAt ? ` · Paid ${escapeWorkspaceText(new Date(order.paidAt).toLocaleString())}` : ''}</p>${storeOrderActions(order, store.canManage)}</div></div>`).join('')
      : '<p class="meta">No store orders yet.</p>';
    const orderPanel = `<article class="store-item" style="grid-column:1/-1;"><h3 style="margin-bottom:10px;">${orderTitle}</h3>${orderList}</article>`;
    box.innerHTML = productCards + externalStore + manager + orderPanel;
  } catch { box.textContent = 'Unable to load school store items.'; }
}

function openStoreCheckout(productId) {
  const product = (window.schoolStoreProducts || []).find(entry => entry.id === productId);
  if (!product || currentUser?.role !== 'parent') return alert('This school-store item is no longer available.');
  window.storeCheckoutProduct = product;
  openModal('Confirm school-store purchase', `<div style="display:grid;gap:12px;"><p style="margin:0;color:var(--text-muted);">You are about to order <strong>${escapeWorkspaceText(product.name)}</strong>. Check the total before continuing to payment.</p><label>Quantity<input id="storeOrderQuantity" type="number" min="1" max="${product.stockQuantity}" value="1" oninput="updateStoreCheckoutTotal()"></label><div style="padding:12px;border-left:4px solid #2dd4bf;border-radius:0 8px 8px 0;background:rgba(45,212,191,.1);"><span style="color:var(--text-muted);">Item price: ${formatSubscriptionMoney(product.price)}</span><br><strong id="storeCheckoutTotal">Total: ${formatSubscriptionMoney(product.price)}</strong></div><p style="margin:0;font-size:.84rem;color:var(--text-muted);">Are you sure you want to continue? A payment reference will be created and the stock room will be notified to prepare your order.</p><button type="button" class="submit-btn" onclick="confirmStoreCheckout()">Yes, continue to payment</button></div>`);
}

function updateStoreCheckoutTotal() {
  const product = window.storeCheckoutProduct;
  const quantity = Math.max(1, Math.min(Number(document.getElementById('storeOrderQuantity')?.value) || 1, product?.stockQuantity || 1));
  const field = document.getElementById('storeOrderQuantity');
  if (field) field.value = quantity;
  const total = document.getElementById('storeCheckoutTotal');
  if (total && product) total.textContent = `Total: ${formatSubscriptionMoney(product.price * quantity)}`;
}

async function confirmStoreCheckout() {
  const product = window.storeCheckoutProduct;
  const quantity = Number(document.getElementById('storeOrderQuantity')?.value);
  if (!product || !quantity) return alert('Choose a valid quantity.');
  try {
    const response = await fetch('/api/store/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ productId: product.id, quantity }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to create the order.');
    const payment = result.payment;
    const destination = paymentDestinationMarkup(payment, 'Continue to secure payment');
    openModal('Order ready for payment', `<p style="margin:0 0 10px;">Your items are reserved while you complete payment. The stock room starts preparation only after payment is confirmed.</p><div style="padding:12px;border-left:4px solid #2dd4bf;background:rgba(45,212,191,.1);margin-bottom:12px;"><strong>${escapeWorkspaceText(result.order.productName)} × ${result.order.quantity}: ${formatSubscriptionMoney(result.order.amount)}</strong><br>Payment reference: <strong>${escapeWorkspaceText(result.order.reference)}</strong>${result.reservationExpiresAt ? `<br><span class="meta">Reservation holds until ${escapeWorkspaceText(new Date(result.reservationExpiresAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</span>` : ''}</div>${destination}<p style="margin:12px 0 0;color:var(--text-muted);font-size:.82rem;">Use the reference exactly as shown so the order and payment can be matched.</p>`);
    renderCapitecPayMeQr(payment);
    loadStoreItems();
  } catch (error) { alert(safeUserFacingError(error, 'Unable to create the order.')); }
}

async function cancelStoreOrder(orderId) {
  if (!confirm('Cancel this unpaid store order and release the reserved stock?')) return;
  try {
    const response = await fetch(`/api/store/orders/${encodeURIComponent(orderId)}/cancel`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to cancel the store order.');
    await loadStoreItems();
  } catch (error) { alert(safeUserFacingError(error, 'Unable to cancel the store order.')); }
}

async function updateStoreFulfilment(orderId, status) {
  try {
    const response = await fetch(`/api/store/orders/${encodeURIComponent(orderId)}/fulfilment`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to update the store order.');
    await loadStoreItems();
  } catch (error) { alert(safeUserFacingError(error, 'Unable to update the store order.')); }
}

function recordStoreRefund(orderId, reference, amount) {
  if (!isFinanceUser()) return alert('Only an administrator or Accounts user can record a confirmed refund.');
  openModal('Record confirmed store refund', `<form onsubmit="submitStoreRefund(event,'${encodeInlineIdentifier(orderId)}','${encodeInlineIdentifier(reference)}',${Number(amount || 0)})" style="display:grid;gap:12px;"><p style="margin:0;">Reference: <strong>${escapeWorkspaceText(reference)}</strong></p><p class="meta" style="margin:0;">This does not send money. Use it only after PayFast or the bank has actually confirmed the refund. Little Feet will then return the item quantity to stock.</p><label>Refunded amount (R)<input name="amount" type="number" min="0.01" step="0.01" value="${Number(amount || 0).toFixed(2)}" required></label><label>Refund/provider reference<input name="bankReference" maxlength="160" required></label><button class="submit-btn">Record confirmed refund</button></form>`);
}

async function submitStoreRefund(event, encodedOrderId, encodedReference, expectedAmount) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await fetch('/api/payments/reconcile', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
      eventId: `store-refund-${decodeURIComponent(encodedOrderId)}-${Date.now()}`,
      reference: decodeURIComponent(encodedReference), status:'refunded', amount: form.elements.amount.value,
      bankReference: form.elements.bankReference.value
    }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to record the store refund.');
    closeModal();
    await loadStoreItems();
    alert('Refund recorded and the item quantity was returned to stock.');
  } catch (error) { alert(safeUserFacingError(error, 'Unable to record the store refund.')); }
}

async function addStoreProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await fetch('/api/store/products', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name: form.elements.name.value, price: form.elements.price.value, stockQuantity: form.elements.stockQuantity.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to add the store item.');
    form.reset(); loadStoreItems();
  } catch (error) { alert(safeUserFacingError(error, 'Unable to add the store item.')); }
}

async function removeStoreProduct(productId) {
  if (!confirm('Remove this school-store item?')) return;
  const response = await fetch(`/api/store/products/${encodeURIComponent(productId)}`, { method:'DELETE' });
  if (!response.ok) return alert('Unable to remove the store item.');
  loadStoreItems();
}

function restoreStickyNotes() {
  document.querySelectorAll('#stickyNotesOverlay [data-note-id]').forEach(note => localStorage.removeItem(stickyNoteClosedKey(note.dataset.noteId)));
  fetch('/api/modules/stickyNotes').then(response => response.json()).then(records => (Array.isArray(records) ? records : []).forEach(record => localStorage.removeItem(stickyNoteClosedKey(record.id)))).finally(() => loadStickyNotes());
}
