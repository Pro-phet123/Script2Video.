import { GoogleGenAI, Type, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface Scene {
  text: string;
  imagePrompt: string;
  imageUrl?: string;
  audioData?: string;
  duration?: number;
}

export async function analyzeScript(script: string): Promise<Scene[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze this YouTube script and break it down into a sequence of scenes. 
    For each scene, provide:
    1. The specific text to be spoken (voiceover).
    2. A detailed prompt for an image generator to create a visual for this scene. The style should be "high-quality 2D digital illustration, cinematic, expressive".
    
    Script: ${script}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            imagePrompt: { type: Type.STRING },
          },
          required: ["text", "imagePrompt"],
        },
      },
    },
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    console.error("Failed to parse scenes", e);
    return [];
  }
}

export async function generateImage(prompt: string): Promise<string | undefined> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
      imageConfig: {
        aspectRatio: "16:9",
      },
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  return undefined;
}

export async function generateAudio(text: string, voice: string = "Kore"): Promise<string | undefined> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
}
