class OrderService {
  constructor({ sheetsService, fcmService, controlService }) {
    this.sheetsService = sheetsService;
    this.fcmService = fcmService;
    this.controlService = controlService;
    this.lastOrderContext = new Map();
    this.adminDeviceToken = "";
    this.notificationsEnabled = true;
  }

  async hydrateControlSettings() {
    this.adminDeviceToken = await this.controlService.getAdminDeviceToken("");
    this.notificationsEnabled = await this.controlService.getNotificationsEnabled(true);
  }

  async setAdminDeviceToken(token) {
    this.adminDeviceToken = token || "";
    await this.controlService.setAdminDeviceToken(this.adminDeviceToken);
  }

  async setNotificationsEnabled(enabled) {
    this.notificationsEnabled = Boolean(enabled);
    await this.controlService.setNotificationsEnabled(this.notificationsEnabled);
  }

  cacheDraft(userKey, draft) {
    this.lastOrderContext.set(userKey, draft);
  }

  getDraft(userKey) {
    return this.lastOrderContext.get(userKey);
  }

  async confirmOrder(userKey, qtyOverride) {
    const draft = this.getDraft(userKey);
    if (!draft) throw new Error("No draft order found");

    const qty = qtyOverride || draft.qty || 1;
    const item = await this.sheetsService.findInventoryItem(draft.model, draft.part);
    if (!item) throw new Error("Part not found in inventory");
    if (item.stock < qty) throw new Error(`Stock available only: ${item.stock}`);

    const updatedItem = await this.sheetsService.reduceStock(draft.model, draft.part, qty);
    const invoice = await this.sheetsService.createInvoice({
      customer: draft.customer,
      model: draft.model,
      part: draft.part,
      qty,
      price: item.price
    });

    const order = {
      ...draft,
      qty,
      total: invoice.total
    };

    if (this.notificationsEnabled && this.adminDeviceToken) {
      await this.fcmService.sendOrderNotification(order, this.adminDeviceToken);
    }

    this.lastOrderContext.set(userKey, {
      ...draft,
      qty,
      stock: updatedItem.stock
    });

    return {
      order,
      stockLeft: updatedItem.stock
    };
  }
}

module.exports = { OrderService };
