// Existing handlers, registered at their original middleware positions.
function registerStoreRoutes(app, context) {
app.get('/api/store', (req, res) => {
  const user = context.getSessionAccount(req);
  if (!user) return res.status(401).json({ message: 'Sign in to view the school store.' });
  const schoolName = user.schoolName || 'Your school';
  const schoolId = context.accountSchoolId(user);
  context.releaseExpiredStoreReservations(schoolId);
  const canManage = context.isAdminLike(user);
  const products = context.tenantRecords(context.db.storeProducts || [], user).filter(product => product.active !== false).map(({ schoolName: _schoolName, schoolId: _schoolId, ...product }) => {
    const physicalStockQuantity = Math.max(0, Number(product.stockQuantity) || 0);
    const reservedQuantity = Math.max(0, Number(product.reservedQuantity) || 0);
    return {
      ...product,
      stockQuantity: Math.max(0, physicalStockQuantity - reservedQuantity),
      ...(canManage ? { physicalStockQuantity, reservedQuantity } : {})
    };
  });
  res.json({ schoolName, products, canManage, webStoreUrl: user.schoolStoreUrl || null });
});

app.post('/api/store/products', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator can add school store items.' });
  const name = String(req.body?.name || '').trim().slice(0, 120);
  const price = context.billingAmount(req.body?.price);
  const stockQuantity = Number.parseInt(req.body?.stockQuantity, 10);
  if (!name || price === null || price <= 0 || !Number.isInteger(stockQuantity) || stockQuantity < 0) return res.status(400).json({ message: 'Enter an item name, a price greater than zero, and a valid stock quantity.' });
  if (!Array.isArray(context.db.storeProducts)) context.db.storeProducts = [];
  const product = context.tagSchoolRecord(actor, { id: context.crypto.randomUUID(), name, price, stockQuantity, reservedQuantity: 0, active: true, createdAt: new Date().toISOString(), createdBy: actor.username });
  context.db.storeProducts.unshift(product);
  res.status(201).json({ success: true, product });
});

app.delete('/api/store/products/:id', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator can remove school store items.' });
  const product = (context.db.storeProducts || []).find(entry => entry.id === req.params.id && context.recordInSchool(entry, actor));
  if (!product) return res.status(404).json({ message: 'Store item not found.' });
  product.active = false;
  res.json({ success: true });
});

app.post('/api/store/orders', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || actor.role !== 'parent') return res.status(403).json({ message: 'Only approved parent accounts can place a school store order.' });
  const product = (context.db.storeProducts || []).find(entry => entry.id === req.body?.productId && entry.active !== false && context.recordInSchool(entry, actor));
  const quantity = Number.parseInt(req.body?.quantity, 10);
  if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return res.status(400).json({ message: 'Choose an available store item and quantity.' });
  const schoolId = context.accountSchoolId(actor);
  context.releaseExpiredStoreReservations(schoolId);
  if (context.storeAvailableQuantity(product) < quantity) return res.status(409).json({ message: 'The requested quantity is not currently available.' });
  const billing = context.subscriptionBillingState(actor);
  if (!context.billingPaymentConfigured(billing.payment)) return res.status(409).json({ message: 'The school payment destination is not configured yet.' });
  product.reservedQuantity = Math.max(0, Number(product.reservedQuantity) || 0) + quantity;
  const reference = `${billing.payment.referencePrefix}-STORE-${context.crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const timestamp = new Date().toISOString();
  const order = context.tagSchoolRecord(actor, {
    id: context.crypto.randomUUID(), reference, productId: product.id, productName: product.name, quantity,
    amount: Math.round(product.price * quantity * 100) / 100,
    parentUsername: actor.username, parentName: actor.name || actor.username,
    status: 'awaiting payment', paymentStatus: 'awaiting_payment', fulfilmentStatus: 'awaiting_payment',
    stockAccountingVersion: 2, stockReservationStatus: 'reserved', stockReservedAt: timestamp,
    createdAt: timestamp
  });
  if (!Array.isArray(context.db.storeOrders)) context.db.storeOrders = [];
  context.db.storeOrders.unshift(order);
  context.db.moduleRecords.stock.unshift(context.tagSchoolRecord(actor, {
    id: context.crypto.randomUUID(), orderId: order.id, reference,
    details: `Store order awaiting payment · ${product.name} × ${quantity} · ${order.parentName} · Ref ${reference}`,
    source: 'school-store', status: 'Awaiting payment', createdAt: new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })
  }));
  res.status(201).json({ success: true, order, payment: context.paymentInstructions(billing, reference), reservationExpiresAt: new Date(Date.parse(timestamp) + context.STORE_RESERVATION_TTL_MS).toISOString() });
});

app.get('/api/store/orders', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['parent', 'teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'School-store order access is required.' });
  context.releaseExpiredStoreReservations(context.accountSchoolId(actor));
  let orders = context.tenantRecords(context.db.storeOrders || [], actor);
  if (actor.role === 'parent') orders = orders.filter(order => context.normalizeUsername(order.parentUsername) === context.normalizeUsername(actor.username));
  res.json(orders.map(order => ({
    id: order.id, reference: order.reference, productId: order.productId, productName: order.productName,
    quantity: order.quantity, amount: order.amount, parentName: order.parentName,
    status: order.status, paymentStatus: order.paymentStatus || 'awaiting_payment',
    fulfilmentStatus: order.fulfilmentStatus || '', stockReservationStatus: order.stockReservationStatus || '',
    createdAt: order.createdAt, paidAt: order.paidAt || '', refundedAt: order.refundedAt || '',
    stockReservedAt: order.stockReservedAt || '', stockReleasedAt: order.stockReleasedAt || '',
    fulfilmentUpdatedAt: order.fulfilmentUpdatedAt || ''
  })));
});

app.post('/api/store/orders/:id/cancel', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to cancel a store order.' });
  const order = (context.db.storeOrders || []).find(entry => entry.id === req.params.id && context.recordInSchool(entry, actor));
  if (!order) return res.status(404).json({ message: 'Store order not found.' });
  const ownsOrder = actor.role === 'parent' && context.normalizeUsername(order.parentUsername) === context.normalizeUsername(actor.username);
  const canManage = context.hasPlatformAccess(actor) || ['principal', 'admin', 'staff'].includes(actor.role);
  if (!ownsOrder && !canManage) return res.status(403).json({ message: 'You cannot cancel this store order.' });
  if (order.paymentStatus === 'paid') return res.status(409).json({ message: 'A paid order cannot be cancelled. Confirm the actual refund first, then record that refund in Little Feet.' });
  if (['cancelled', 'refunded', 'collected'].includes(String(order.fulfilmentStatus || '').toLowerCase())) return res.json({ success: true, order });
  context.releaseStoreReservation(order, new Date().toISOString(), 'cancelled');
  res.json({ success: true, order });
});

app.patch('/api/store/orders/:id/fulfilment', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Only authorised store staff can update order fulfilment.' });
  const order = (context.db.storeOrders || []).find(entry => entry.id === req.params.id && context.recordInSchool(entry, actor));
  if (!order) return res.status(404).json({ message: 'Store order not found.' });
  if (order.paymentStatus !== 'paid') return res.status(409).json({ message: 'The order must have a confirmed payment before fulfilment can change.' });
  if (order.fulfilmentStatus === 'refunded') return res.status(409).json({ message: 'A refunded order cannot be fulfilled.' });
  const next = String(req.body?.status || '').trim().toLowerCase();
  const labels = {
    preparing: ['preparing', 'PAID · PREPARING'],
    ready_for_collection: ['ready for collection', 'PAID · READY FOR COLLECTION'],
    collected: ['collected', 'PAID · COLLECTED']
  };
  if (!labels[next]) return res.status(400).json({ message: 'Choose preparing, ready for collection, or collected.' });
  order.fulfilmentStatus = next;
  order.status = labels[next][0];
  order.fulfilmentUpdatedAt = new Date().toISOString();
  order.fulfilmentUpdatedBy = actor.username;
  context.updateStoreRoomRecord(order, labels[next][1], `Store order ${labels[next][0]} · ${order.productName} × ${order.quantity} · ${order.parentName} · Ref ${order.reference}`);
  res.json({ success: true, order });
});
}

module.exports = { registerStoreRoutes };
