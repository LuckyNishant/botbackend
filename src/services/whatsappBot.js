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

    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: config.bot.sessionName }),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      }
    });

    this.registerHandlers();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    return this.controlService.setBotEnabled(this.enabled);
  }

  isEnabled() {
    return this.enabled;
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

  registerHandlers() {
    this.client.on("qr", (qr) => qrcode.generate(qr, { small: true }));
    this.client.on("ready", () => console.log("WhatsApp bot ready"));
    this.client.on("message", async (message) => {
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

  async start() {
    await this.client.initialize();
  }
}

module.exports = { WhatsAppBot };
