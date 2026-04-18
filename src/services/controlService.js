const BotGroup = require("../models/BotGroup");
const WhitelistNumber = require("../models/WhitelistNumber");
const ControlConfig = require("../models/ControlConfig");

const CONTROL_KEYS = {
  botEnabled: "botEnabled",
  notificationsEnabled: "notificationsEnabled",
  adminDeviceToken: "adminDeviceToken"
};

class ControlService {
  async getConfigValue(key, fallback = null) {
    const doc = await ControlConfig.findOne({ key }).lean();
    return doc ? doc.value : fallback;
  }

  async setConfigValue(key, value) {
    await ControlConfig.findOneAndUpdate({ key }, { value }, { upsert: true, new: true });
    return value;
  }

  async getBotEnabled(defaultValue) {
    return this.getConfigValue(CONTROL_KEYS.botEnabled, defaultValue);
  }

  async setBotEnabled(enabled) {
    return this.setConfigValue(CONTROL_KEYS.botEnabled, Boolean(enabled));
  }

  async getNotificationsEnabled(defaultValue = true) {
    return this.getConfigValue(CONTROL_KEYS.notificationsEnabled, defaultValue);
  }

  async setNotificationsEnabled(enabled) {
    return this.setConfigValue(CONTROL_KEYS.notificationsEnabled, Boolean(enabled));
  }

  async getAdminDeviceToken(defaultValue = "") {
    return this.getConfigValue(CONTROL_KEYS.adminDeviceToken, defaultValue);
  }

  async setAdminDeviceToken(token) {
    return this.setConfigValue(CONTROL_KEYS.adminDeviceToken, String(token || ""));
  }

  async listGroups() {
    return BotGroup.find({ enabled: true }).sort({ updatedAt: -1 }).lean();
  }

  async addGroup(groupId, groupName = "") {
    return BotGroup.findOneAndUpdate(
      { groupId: String(groupId).trim() },
      { groupName: String(groupName || ""), enabled: true },
      { upsert: true, new: true }
    ).lean();
  }

  async removeGroup(groupId) {
    await BotGroup.deleteOne({ groupId: String(groupId).trim() });
  }

  async isGroupAllowed(groupId) {
    const groups = await this.listGroups();
    if (!groups.length) return true;
    return groups.some((g) => g.groupId === String(groupId));
  }

  async listWhitelistNumbers() {
    return WhitelistNumber.find({ enabled: true }).sort({ updatedAt: -1 }).lean();
  }

  async addWhitelistNumber(phoneNumber, label = "") {
    return WhitelistNumber.findOneAndUpdate(
      { phoneNumber: String(phoneNumber).trim() },
      { label: String(label || ""), enabled: true },
      { upsert: true, new: true }
    ).lean();
  }

  async removeWhitelistNumber(phoneNumber) {
    await WhitelistNumber.deleteOne({ phoneNumber: String(phoneNumber).trim() });
  }

  async isWhitelisted(phoneNumber) {
    const numbers = await this.listWhitelistNumbers();
    if (!numbers.length) return true;
    return numbers.some((n) => n.phoneNumber === String(phoneNumber).trim());
  }
}

module.exports = { ControlService };
