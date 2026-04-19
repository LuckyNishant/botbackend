const express = require("express");
const cors = require("cors");
const config = require("./config");
const { SheetsService } = require("./services/sheetsService");
const { GroqService } = require("./services/groqService");
const { FcmService } = require("./services/fcmService");
const { OrderService } = require("./services/orderService");
const { WhatsAppBot } = require("./services/whatsappBot");
const { ControlService } = require("./services/controlService");
const { connectMongo } = require("./db/mongo");
const { buildAdminRoutes } = require("./routes/adminRoutes");

async function bootstrap() {
  console.log("Bootstrapping backend...");
  await connectMongo();

  const sheetsService = new SheetsService();
  try {
    await sheetsService.init();
  } catch (error) {
    console.error("Google Sheets init failed:", error.message);
  }

  const controlService = new ControlService();
  const groqService = new GroqService();
  const fcmService = new FcmService();
  try {
    fcmService.init();
  } catch (error) {
    console.error("Firebase init failed:", error.message);
  }

  const orderService = new OrderService({ sheetsService, fcmService, controlService });
  const bot = new WhatsAppBot({ sheetsService, groqService, orderService, controlService });

  await orderService.hydrateControlSettings();
  await bot.hydrateControlSettings();

  const app = express();
  app.use(
    cors({
      origin(origin, callback) {
        const allowed = config.cors.allowedOrigins;
        if (!origin || !allowed.length || allowed.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("CORS blocked for this origin"));
      }
    })
  );
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "Lucky Mobile AI Spare Parts Backend",
      botEnabled: bot.isEnabled(),
      botStarted: bot.isStarted()
    });
  });

  app.use(
    "/admin",
    buildAdminRoutes({
      sheetsService,
      orderService,
      botController: bot
    })
  );

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: error.message || "Internal server error" });
  });

  app.listen(config.port, () => {
    console.log(`Backend running on port ${config.port}`);
  });

  try {
    await bot.start();
  } catch (error) {
    console.error("WhatsApp bot startup failed:", error.message);
  }
}

bootstrap().catch((error) => {
  console.error("Bootstrap failed:", error);
  process.exit(1);
});
