const dotenv = require("dotenv");

dotenv.config();

const parseCsv = (value) =>
  (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

module.exports = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || "development",
  groq: {
    apiKey: process.env.GROQ_API_KEY || "",
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
  },
  bot: {
    mentionPrefix: (process.env.BOT_MENTION_PREFIX || "@bot").toLowerCase(),
    enabled: String(process.env.BOT_ENABLED || "true").toLowerCase() === "true",
    allowedGroups: parseCsv(process.env.ALLOWED_GROUP_IDS),
    allowedPhones: parseCsv(process.env.ALLOWED_PHONE_NUMBERS),
    sessionName: process.env.WHATSAPP_SESSION_NAME || "lucky-mobile-bot"
  },
  cors: {
    allowedOrigins: parseCsv(process.env.ALLOWED_ORIGINS)
  },
  sheets: {
    sheetId: process.env.GOOGLE_SHEET_ID || "",
    serviceEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
  },
  mongodb: {
    uri: process.env.MONGODB_URI || "",
    dbName: process.env.MONGODB_DB_NAME || "luckymobile"
  }
};
