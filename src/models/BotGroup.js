const mongoose = require("mongoose");

const botGroupSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true, unique: true },
    groupName: { type: String, default: "" },
    enabled: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("BotGroup", botGroupSchema);
