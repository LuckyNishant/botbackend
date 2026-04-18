const axios = require("axios");
const config = require("../config");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

class GroqService {
  async generateBotReply({ model, part, compatible, location }) {
    const fallback = this.fallbackReply({ model, part, compatible, location });
    if (!config.groq.apiKey) return fallback;

    try {
      const prompt = `Generate a short Hindi+English WhatsApp spare-parts response.
Model: ${model}
Part: ${part}
Compatible: ${compatible || "N/A"}
Location: ${location}
Include a dispatch-ready final line.`;

      const { data } = await axios.post(
        GROQ_URL,
        {
          model: config.groq.model,
          messages: [
            { role: "system", content: "You are Lucky Mobile dispatch assistant." },
            { role: "user", content: prompt }
          ],
          temperature: 0.2
        },
        {
          headers: {
            Authorization: `Bearer ${config.groq.apiKey}`,
            "Content-Type": "application/json"
          },
          timeout: 10000
        }
      );

      return data?.choices?.[0]?.message?.content?.trim() || fallback;
    } catch (error) {
      console.error("Groq request failed:", error.message);
      return fallback;
    }
  }

  fallbackReply({ model, part, compatible, location }) {
    return `📦 Model: ${model} (${capitalize(part)})

🔁 Compatible: ${compatible || "No compatibility data"}

📍 Location: ${location}
📦 Dispatch: Lucky Mobile – Manasa

📲 Message:
${model} ${part} ${location} ke liye bhejna hai`;
  }
}

function capitalize(value) {
  if (!value) return "";
  return value[0].toUpperCase() + value.slice(1);
}

module.exports = { GroqService };
