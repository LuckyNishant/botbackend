const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const config = require("../config");
const {
  parseBotMessage,
  isOrderConfirmation,
  parseOneClickReorder,
  extractQuantity
} = require("./messageParser");

class WhatsAppBot {
  constructor({ sheetsService, groqService, orderService, controlService }) {
    this.sheetsService = sheetsService;
    this.groqService = groqService;
    this.orderService = orderService;
    this.controlService = controlService;
    this.enabled = config.bot.enabled;
    this.client = null;
    this.started = false;
    this.startPromise = null;
    this.lastQr = "";
    this.lastError = "";
    this.connectedAt = null;
    this.mentionPrefix = config.bot.mentionPrefix || "@lucky";
  }

  setEnabled(enabled) {
    return this.updateEnabled(Boolean(enabled));
  }

  isEnabled() {
    return this.enabled;
  }

  isStarted() {
    return this.started;
  }

  getLinkStatus() {
    return {
      started: this.started,
      enabled: this.enabled,
      qr: this.lastQr,
      lastError: this.lastError,
      connectedAt: this.connectedAt
    };
  }

  getMentionPrefix() {
    return this.mentionPrefix;
  }

  async hydrateControlSettings() {
    this.enabled = await this.controlService.getBotEnabled(config.bot.enabled);
    this.mentionPrefix = await this.controlService.getMentionPrefix(config.bot.mentionPrefix || "@lucky");
  }

  async setMentionPrefix(prefix) {
    this.mentionPrefix = await this.controlService.setMentionPrefix(prefix);
    return this.mentionPrefix;
  }

  async getSelectedGroups() {
    return this.controlService.listGroups();
  }

  async addGroup(groupId, groupName) {
    return this.controlService.addGroup(groupId, groupName);
  }

  async removeGroup(groupId) {
    return this.controlService.removeGroup(groupId);
  }

  async replaceGroups(groups = []) {
    const incoming = Array.isArray(groups) ? groups : [];
    const normalized = incoming
      .filter((row) => row && row.groupId)
      .map((row) => ({
        groupId: String(row.groupId).trim(),
        groupName: String(row.groupName || "").trim()
      }));

    const existing = await this.controlService.listGroups();
    const existingIds = new Set(existing.map((row) => row.groupId));
    const nextIds = new Set(normalized.map((row) => row.groupId));

    for (const group of existing) {
      if (!nextIds.has(group.groupId)) {
        await this.controlService.removeGroup(group.groupId);
      }
    }

    for (const group of normalized) {
      await this.controlService.addGroup(group.groupId, group.groupName);
    }

    return this.controlService.listGroups();
  }

  async getAvailableGroups() {
    if (!this.client) return [];
    try {
      const chats = await this.client.getChats();
      return chats
        .filter((chat) => chat.isGroup)
        .map((chat) => ({
          groupId: chat.id?._serialized || "",
          groupName: chat.name || "Unnamed Group"
        }))
        .filter((row) => row.groupId);
    } catch (error) {
      this.lastError = error.message || "Failed to sync WhatsApp groups";
      return [];
    }
  }

  async getWhitelistedNumbers() {
    return this.controlService.listWhitelistNumbers();
  }

  async addWhitelistNumber(phoneNumber, label) {
    return this.controlService.addWhitelistNumber(phoneNumber, label);
  }

  async removeWhitelistNumber(phoneNumber) {
    return this.controlService.removeWhitelistNumber(phoneNumber);
  }

  createClient() {
    if (this.client) return this.client;

    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: config.bot.sessionName }),
      puppeteer: {
        headless: true,
        executablePath: executablePath || undefined,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      }
    });

    this.registerHandlers(this.client);
    return this.client;
  }

  registerHandlers(client) {
    client.on("qr", (qr) => {
      this.lastQr = qr;
      this.lastError = "";
      qrcode.generate(qr, { small: true });
    });
    client.on("ready", () => {
      this.started = true;
      this.lastQr = "";
      this.lastError = "";
      this.connectedAt = new Date().toISOString();
      console.log("WhatsApp bot ready");
    });
    client.on("disconnected", (reason) => {
      this.started = false;
      this.connectedAt = null;
      this.lastError = String(reason || "WhatsApp disconnected");
      console.warn("WhatsApp bot disconnected:", reason);
    });
    client.on("message", async (message) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        console.error("Message handling failed:", error.message);
      }
    });
  }

  async handleMessage(message) {
    if (!this.enabled) return;

    const sender = await message.getContact();
    const chat = await message.getChat();
    const phone = sender.number;
    const userKey = chat.id._serialized;

    if (config.bot.allowedPhones.length && !config.bot.allowedPhones.includes(phone)) return;
    if (
      chat.isGroup &&
      config.bot.allowedGroups.length &&
      !config.bot.allowedGroups.includes(chat.id._serialized)
    ) {
      return;
    }

    if (chat.isGroup) {
      const groupAllowed = await this.controlService.isGroupAllowed(chat.id._serialized);
      if (!groupAllowed) return;
    }

    const whitelisted = await this.controlService.isWhitelisted(phone);
    if (!whitelisted) return;

    const customer = (await this.sheetsService.getCustomerByNumber(phone)) || {
      shop: sender.pushname || "Unknown",
      location: "Unknown"
    };

    const parsed = parseBotMessage(message.body, this.mentionPrefix);
    if (parsed) {
      const item = await this.sheetsService.findInventoryItem(parsed.model, parsed.part);
      if (!item) {
        await message.reply(`❌ ${parsed.model} ${parsed.part} inventory me nahi mila.`);
        return;
      }
      const aiReply = await this.groqService.generateBotReply({
        model: item.model,
        part: item.part,
        compatible: item.compatible,
        location: customer.location
      });

      this.orderService.cacheDraft(userKey, {
        customer: customer.shop,
        location: customer.location,
        model: item.model,
        part: item.part,
        qty: parsed.quantity
      });

      await message.reply(aiReply);
      return;
    }

    if (parseOneClickReorder(message.body)) {
      const draft = this.orderService.getDraft(userKey);
      if (!draft) {
        await message.reply("ℹ️ Pichla order context available nahi hai. Pehle `@bot m11` format use karein.");
        return;
      }
      const result = await this.orderService.confirmOrder(userKey);
      await message.reply(`✅ Same order confirm ho gaya. Stock left: ${result.stockLeft}`);
      return;
    }

    if (isOrderConfirmation(message.body)) {
      const qty = extractQuantity(message.body);
      const result = await this.orderService.confirmOrder(userKey, qty);
      await message.reply(
        `✅ Order confirmed!\nModel: ${result.order.model}\nPart: ${result.order.part}\nQty: ${result.order.qty}\nStock left: ${result.stockLeft}`
      );
    }
  }

  async updateEnabled(enabled) {
    this.enabled = enabled;
    await this.controlService.setBotEnabled(this.enabled);

    if (this.enabled) {
      try {
        await this.start({ force: true });
      } catch (error) {
        this.lastError = error.message || "Failed to start WhatsApp bot";
      }
    } else if (this.client) {
      await this.stop();
    }

    return this.enabled;
  }

  async start(options) {
    return this.startInternal(options);
  }

  async startInternal({ force = false } = {}) {
    if (!this.enabled && !force) {
      console.log("WhatsApp bot disabled. Skipping startup.");
      return false;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    const client = this.createClient();
    this.startPromise = client
      .initialize()
      .then(() => {
        this.started = true;
        return true;
      })
      .catch((error) => {
        this.started = false;
        this.connectedAt = null;
        this.lastError = error.message || "Failed to initialize WhatsApp client";
        this.client = null;
        throw error;
      })
      .finally(() => {
        this.startPromise = null;
      });

    return this.startPromise;
  }

  async stop() {
    if (!this.client) return;

    try {
      await this.client.destroy();
    } finally {
      this.client = null;
      this.started = false;
      this.connectedAt = null;
    }
  }
}

module.exports = { WhatsAppBot };
