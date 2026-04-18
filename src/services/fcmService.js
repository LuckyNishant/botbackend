const admin = require("firebase-admin");
const config = require("../config");

class FcmService {
  constructor() {
    this.enabled = false;
  }

  init() {
    const { projectId, clientEmail, privateKey } = config.firebase;
    if (!projectId || !clientEmail || !privateKey) {
      console.warn("Firebase credentials missing. FCM disabled.");
      return;
    }
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey
        })
      });
    }
    this.enabled = true;
  }

  async sendOrderNotification(order, deviceToken) {
    if (!this.enabled || !deviceToken) return null;

    const body = [
      `Model: ${order.model}`,
      `Part: ${order.part}`,
      `Customer: ${order.customer}`,
      `Location: ${order.location}`,
      `Qty: ${order.qty}`
    ].join("\n");

    const message = {
      token: deviceToken,
      notification: {
        title: "📦 New Order Received!",
        body
      },
      data: {
        model: order.model,
        part: order.part,
        qty: String(order.qty)
      }
    };

    return admin.messaging().send(message);
  }
}

module.exports = { FcmService };
