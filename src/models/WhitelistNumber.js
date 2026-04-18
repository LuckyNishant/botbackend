const mongoose = require("mongoose");

const whitelistNumberSchema = new mongoose.Schema(
  {
    phoneNumber: { type: String, required: true, unique: true },
    label: { type: String, default: "" },
    enabled: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhitelistNumber", whitelistNumberSchema);
