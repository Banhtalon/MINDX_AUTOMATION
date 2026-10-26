import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config";

let genAiInstance: GoogleGenerativeAI | null = null;

/**
 * Returns the GoogleGenerativeAI client singleton.
 * Throws a helpful error if GEMINI_API_KEY is not configured.
 */
export function getGeminiClient(): GoogleGenerativeAI {
  if (genAiInstance) {
    return genAiInstance;
  }

  const apiKey = config.geminiApiKey;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    throw new Error(
      "[Gemini Client] GEMINI_API_KEY chưa được cấu hình trong .env.local. Vui lòng thêm API Key từ Google AI Studio."
    );
  }

  genAiInstance = new GoogleGenerativeAI(apiKey);
  return genAiInstance;
}

/**
 * Returns the configured Gemini model instance with JSON response MIME type.
 */
export function getGeminiModel(customModelName?: string, customTemperature?: number) {
  const client = getGeminiClient();
  const modelName = customModelName || config.geminiModel || "gemini-3.5-flash-lite";

  return client.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: typeof customTemperature === "number" ? customTemperature : 0.3,
    },
  });
}
