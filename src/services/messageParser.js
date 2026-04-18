const ORDER_TRIGGERS = ["bhejna hai", "dispatch", "order", "confirm"];
const PART_KEYWORDS = ["screen", "battery", "charging"];

const normalize = (text) => (text || "").trim().toLowerCase();

const extractQuantity = (text) => {
  const match = text.match(/\b(\d+)\b/);
  return match ? Number(match[1]) : 1;
};

const parseBotMessage = (rawText, mentionPrefix) => {
  const text = normalize(rawText);
  if (!text.startsWith(`${mentionPrefix} `)) return null;

  const payload = text.slice(mentionPrefix.length).trim();
  if (!payload) return null;

  const tokens = payload.split(/\s+/);

  let quantity = 1;
  let model = "";
  let part = "screen";

  if (/^\d+$/.test(tokens[0])) {
    quantity = Number(tokens[0]);
    model = tokens[1] || "";
  } else {
    model = tokens[0];
  }

  const explicitPart = tokens.find((token) => PART_KEYWORDS.includes(token));
  if (explicitPart) {
    part = explicitPart;
  }

  return {
    quantity,
    model: model.toUpperCase(),
    part
  };
};

const isOrderConfirmation = (rawText) => {
  const text = normalize(rawText);
  return ORDER_TRIGGERS.some((trigger) => text.includes(trigger));
};

const parseOneClickReorder = (rawText) => normalize(rawText).includes("same bhejna hai");

module.exports = {
  PART_KEYWORDS,
  ORDER_TRIGGERS,
  parseBotMessage,
  isOrderConfirmation,
  parseOneClickReorder,
  extractQuantity
};
