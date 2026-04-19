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

  async hydrateControlSettings() {
    this.enabled = await this.controlService.getBotEnabled(config.bot.enabled);
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
    client.on("qr", (qr) => qrcode.generate(qr, { small: true }));
    client.on("ready", () => {
      this.started = true;
      console.log("WhatsApp bot ready");
    });
    client.on("disconnected", (reason) => {
      this.started = false;
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

    const parsed = parseBotMessage(message.body, config.bot.mentionPrefix);
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
      await this.start({ force: true });
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
    }
  }
}

module.exports = { WhatsAppBot };
