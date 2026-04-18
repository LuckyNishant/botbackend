const express = require("express");
const { TAB_NAMES } = require("../services/sheetsService");

function buildAdminRoutes({ sheetsService, orderService, botController }) {
  const router = express.Router();

  router.get("/dashboard", async (_req, res, next) => {
    try {
      const inventoryRows = await sheetsService.read(TAB_NAMES.inventory);
      const invoiceRows = await sheetsService.read(TAB_NAMES.invoice);
      const dataRows = inventoryRows.slice(1);
      const totalStock = dataRows.reduce((sum, row) => sum + Number(row[2] || 0), 0);
      const lowStockItems = dataRows
        .filter((row) => Number(row[2] || 0) <= 5)
        .map((row) => ({
          model: row[0] || "-",
          part: row[1] || "-",
          stock: Number(row[2] || 0),
          price: Number(row[3] || 0),
          compatible: row[4] || ""
        }));
      const today = new Date().toISOString().slice(0, 10);
      const todayOrders = invoiceRows
        .slice(1)
        .filter((row) => String(row[0] || "").slice(0, 10) === today).length;

      res.json({
        totalStock,
        todayOrders,
        lowStockAlertCount: lowStockItems.length,
        lowStockItems,
        recentOrders: invoiceRows.slice(-10).reverse()
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/inventory/update-stock", async (req, res, next) => {
    try {
      const { model, part, delta } = req.body;
      const item = await sheetsService.findInventoryItem(model, part);
      if (!item) return res.status(404).json({ error: "Inventory item not found" });
      const newStock = item.stock + Number(delta || 0);
      await sheetsService.updateRange(TAB_NAMES.inventory, `C${item.rowNumber}`, [[newStock]]);
      res.json({ ok: true, newStock });
    } catch (error) {
      next(error);
    }
  });

  router.post("/purchase/add", async (req, res, next) => {
    try {
      const { model, part, qty, cost, supplier } = req.body;
      const date = new Date().toISOString();
      await sheetsService.appendRow(TAB_NAMES.purchase, [date, model, part, qty, cost, supplier]);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/notifications/device-token", async (req, res, next) => {
    try {
      const { token } = req.body;
      orderService.setAdminDeviceToken(token);
      await sheetsService.setAdminConfigValue("adminDeviceToken", token);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/notifications/toggle", async (req, res, next) => {
    try {
      const { enabled } = req.body;
      orderService.setNotificationsEnabled(Boolean(enabled));
      await sheetsService.setAdminConfigValue("notificationsEnabled", String(Boolean(enabled)));
      res.json({ ok: true, enabled: Boolean(enabled) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/toggle", async (req, res) => {
    const { enabled } = req.body;
    botController.setEnabled(Boolean(enabled));
    res.json({ ok: true, enabled: botController.isEnabled() });
  });

  return router;
}

module.exports = { buildAdminRoutes };
