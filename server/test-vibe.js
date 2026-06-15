const axios = require("axios");

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "qwen2.5:7b";

const cities = [
  "Amsterdam",
  "Athens",
  "Barcelona",
  "Berlin",
  "Brussels",
  "Copenhagen",
  "Dubai",
  "Dublin",
  "Istanbul",
  "Lisbon",
  "London",
  "Madrid",
  "Milan",
  "Paris",
  "Prague",
  "Rome",
  "Vienna",
  "Zurich",
];

async function testCityClassification() {
  const prompt = `Classify these European cities by climate/vibe preference. For each city, respond with ONE classification.

Cities: ${cities.join(", ")}

Classification options: sunny, temperate, cultural, snowy

Respond with ONLY a list like:
Amsterdam: temperate
Athens: sunny
...

Do not include any other text.`;

  console.log("Testing qwen2.5:7b city classification...\n");
  console.log("Prompt sent to model:\n", prompt, "\n");

  try {
    const response = await axios.post(OLLAMA_URL, {
      model: MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.1,
        num_ctx: 2048,
      },
    });

    const result = response.data.response.trim();
    console.log("Model response:\n");
    console.log(result);
    console.log("\n✅ Classification test complete!");
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

testCityClassification();
