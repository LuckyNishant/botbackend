const express = require("express");
const { TAB_NAMES } = require("../services/sheetsService");

function buildAdminRoutes({ sheetsService, orderService, botController }) {
  const router = express.Router();

  const ensureReady = async () => {
    if (!sheetsService.ready) {
      await sheetsService.init();
    }
  };

  const safe = async (fn, fallback) => {
    try {
      await ensureReady();
      return await fn();
    } catch (error) {
      if (error.message.includes("PERMISSIONS_ERROR") || error.message.includes("STRUCTURE_ERROR")) {
        throw error;
      }
      return fallback;
    }
  };

  router.get("/dashboard", async (_req, res, next) => {
    try {
      const inventoryRows = await safe(() => sheetsService.read(TAB_NAMES.inventory), []);
      const invoiceRows = await safe(() => sheetsService.read(TAB_NAMES.invoice), []);
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

      const botEnabled = await safe(() => botController.isEnabled(), false);
      const botStarted = await safe(() => botController.isStarted(), false);
      const botLink = await safe(() => botController.getLinkStatus(), {
        started: false,
        enabled: false,
        qr: "",
        lastError: "Bot status unavailable",
        connectedAt: null
      });
      const mentionPrefix = await safe(() => botController.getMentionPrefix(), "@lucky");

      res.json({
        totalStock,
        todayOrders,
        lowStockAlertCount: lowStockItems.length,
        lowStockItems,
        recentOrders: invoiceRows.slice(-10).reverse(),
        whitelistedNumbers: await safe(() => botController.getWhitelistedNumbers(), []),
        selectedGroups: await safe(() => botController.getSelectedGroups(), []),
        availableGroups: await safe(() => botController.getAvailableGroups(), []),
        botEnabled,
        botStarted,
        botLink,
        mentionPrefix,
        notificationsEnabled: await safe(() => orderService.notificationsEnabled, true),
        diagnostics: {
          sheetsReady: Boolean(sheetsService.ready),
          serviceEmail: sheetsService.getServiceEmail(),
          serverTime: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/inventory/update-stock", async (req, res, next) => {
    try {
      await ensureReady();
      const { model, part, delta } = req.body;
      if (!model || !part) {
        return res.status(400).json({ error: "model and part are required" });
      }
      if (!Number.isFinite(Number(delta))) {
        return res.status(400).json({ error: "delta must be a number" });
      }
      const item = await sheetsService.findInventoryItem(model, part);
      if (!item) return res.status(404).json({ error: "Inventory item not found" });
      const newStock = item.stock + Number(delta || 0);
      await sheetsService.updateRange(TAB_NAMES.inventory, `C${item.rowNumber}`, [[newStock]]);
      res.json({ ok: true, newStock });
    } catch (error) {
      next(error);
    }
  });

  router.post("/inventory/add-item", async (req, res, next) => {
    try {
      await ensureReady();
      const { model, part, stock, price, compatible } = req.body;
      if (!model || !part) {
        return res.status(400).json({ error: "model and part are required" });
      }
      const existing = await sheetsService.findInventoryItem(model, part);
      if (existing) {
        return res.status(409).json({ error: "Inventory item already exists. Use stock update." });
      }
      const parsedStock = Number(stock || 0);
      const parsedPrice = Number(price || 0);
      if (!Number.isFinite(parsedStock) || !Number.isFinite(parsedPrice)) {
        return res.status(400).json({ error: "stock and price must be numeric values" });
      }
      await sheetsService.appendRow(TAB_NAMES.inventory, [
        String(model).trim().toUpperCase(),
        String(part).trim().toLowerCase(),
        parsedStock,
        parsedPrice,
        String(compatible || "").trim()
      ]);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/purchase/add", async (req, res, next) => {
    try {
      await ensureReady();
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
      await orderService.setAdminDeviceToken(token);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/notifications/toggle", async (req, res, next) => {
    try {
      const { enabled } = req.body;
      await orderService.setNotificationsEnabled(Boolean(enabled));
      res.json({ ok: true, enabled: Boolean(enabled) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/toggle", async (req, res, next) => {
    try {
      const { enabled } = req.body;
      await botController.setEnabled(Boolean(enabled));
      res.json({
        ok: true,
        enabled: botController.isEnabled(),
        started: botController.isStarted(),
        link: botController.getLinkStatus()
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/bot/link-status", async (_req, res) => {
    res.json({ ok: true, link: botController.getLinkStatus() });
  });

  router.post("/bot/restart-link", async (_req, res, next) => {
    try {
      const link = await botController.restartLinkSession();
      res.json({ ok: true, link });
    } catch (error) {
      next(error);
    }
  });

  router.get("/bot/groups", async (_req, res, next) => {
    try {
      res.json({ groups: await botController.getSelectedGroups() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/bot/groups/sync", async (_req, res, next) => {
    try {
      if (!botController.isEnabled()) {
        return res.status(400).json({ error: "Bot is disabled. Enable bot first." });
      }
      if (!botController.isStarted()) {
        return res.status(400).json({
          error:
            "WhatsApp not connected yet. Scan QR first, wait for Connected status, then sync groups."
        });
      }
      const groups = await botController.getAvailableGroups();
      res.json({ groups });
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/groups/replace", async (req, res, next) => {
    try {
      const { groups } = req.body;
      const selected = await botController.replaceGroups(groups);
      res.json({ ok: true, groups: selected });
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/groups", async (req, res, next) => {
    try {
      const { groupId, groupName } = req.body;
      if (!groupId) return res.status(400).json({ error: "groupId is required" });
      await botController.addGroup(groupId, groupName || "");
      res.json({ ok: true, groups: await botController.getSelectedGroups() });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/bot/groups/:groupId", async (req, res, next) => {
    try {
      await botController.removeGroup(req.params.groupId);
      res.json({ ok: true, groups: await botController.getSelectedGroups() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/bot/whitelist", async (_req, res, next) => {
    try {
      res.json({ numbers: await botController.getWhitelistedNumbers() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/whitelist", async (req, res, next) => {
    try {
      const { phoneNumber, label } = req.body;
      if (!phoneNumber) return res.status(400).json({ error: "phoneNumber is required" });
      await botController.addWhitelistNumber(phoneNumber, label || "");
      res.json({ ok: true, numbers: await botController.getWhitelistedNumbers() });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/bot/whitelist/:phoneNumber", async (req, res, next) => {
    try {
      await botController.removeWhitelistNumber(req.params.phoneNumber);
      res.json({ ok: true, numbers: await botController.getWhitelistedNumbers() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/mention-prefix", async (req, res, next) => {
    try {
      const { mentionPrefix } = req.body;
      if (!mentionPrefix) return res.status(400).json({ error: "mentionPrefix is required" });
      const saved = await botController.setMentionPrefix(mentionPrefix);
      res.json({ ok: true, mentionPrefix: saved });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { buildAdminRoutes };
