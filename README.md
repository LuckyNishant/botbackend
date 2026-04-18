# Lucky Mobile AI Spare Parts Backend

WhatsApp + AI + Inventory automation backend for Lucky Mobile Manasa.

## Features Implemented

- `@bot` trigger format support (`@bot m11`, `@bot m11 battery`, `@bot 10 m11`)
- Default part logic: no part mentioned -> `screen`
- Order confirmation detection (`bhejna hai`, `dispatch`, `order`, `confirm`)
- One-click reorder (`same bhejna hai`)
- Google Sheets integration:
  - Inventory
  - Invoice
  - Purchase
  - Customers
- MongoDB integration:
  - Whitelist numbers (admin controlled)
  - Allowed groups (admin controlled)
  - Bot + notification control settings
- Auto flow on confirm:
  - stock check
  - invoice create
  - stock reduce
  - FCM notify admin
- Admin APIs:
  - Dashboard metrics
  - Inventory stock update
  - Purchase entry
  - Bot on/off
  - FCM token + notification toggle
  - Group selection for bot messaging
  - Whitelist number management

## Project Structure

```txt
src/
  config.js
  index.js
  routes/
    adminRoutes.js
  services/
    fcmService.js
    groqService.js
    messageParser.js
    orderService.js
    sheetsService.js
    whatsappBot.js
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and fill:
   - MongoDB connection string
   - Groq API key
   - Google Sheets credentials
   - Firebase Admin credentials
   - `ALLOWED_ORIGINS` with your Vercel domain

3. Start service:

```bash
npm run dev
```

4. Scan WhatsApp QR in terminal for bot login.

## Required Google Sheet Tabs

- `Inventory` -> `Model | Part | Stock | Price | Compatible`
- `Invoice` -> `Date | Customer | Model | Part | Qty | Price | Total`
- `Purchase` -> `Date | Model | Part | Qty | Cost | Supplier`
- `Customers` -> `Number | Shop | Location | Type`
- `AdminConfig` -> `Key | Value`

## Deployment Notes

- Frontend: Vercel
- Backend/Bot: Render
- Keep alive: UptimeRobot
- Backend base URL: `https://luckymobilebackend.onrender.com`
- If the Render service is configured as a Docker web service, deploy from the backend repo root so Render can find `Dockerfile`
- The Docker image installs Chromium and uses `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` for `whatsapp-web.js`

For production, run WhatsApp bot on a persistent instance with stable storage for session data.
# botbackend
