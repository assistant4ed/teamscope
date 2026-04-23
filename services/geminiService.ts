
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { DailyLog } from '../types';

// Lazy initialization — avoid crashing the whole bundle at module load when
// the key isn't provided (prod deployments without GEMINI_API_KEY still
// render the UI; AI calls just return a friendly error).
const API_KEY = process.env.API_KEY || process.env.GEMINI_API_KEY || '';
const MODEL_NAME = 'gemini-3-flash-preview';

let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI | null {
  if (!API_KEY || API_KEY === 'not-configured') return null;
  if (!_ai) _ai = new GoogleGenAI({ apiKey: API_KEY });
  return _ai;
}

const NOT_CONFIGURED_MSG =
  "AI features are not configured. Set GEMINI_API_KEY at build time to enable.";

async function safeGenerate(
  config: Parameters<GoogleGenAI['models']['generateContent']>[0]
): Promise<GenerateContentResponse | null> {
  const ai = getAI();
  if (!ai) return null;
  return ai.models.generateContent(config);
}

/**
 * Generates a management summary from a list of team standup updates.
 */
export const generateManagerSummary = async (updates: DailyLog[]): Promise<string> => {
  try {
    const prompt = `Input Data (JSON): ${JSON.stringify(updates)}`;
    const systemInstruction = `
      Role: You are an elite Technical Project Manager.
      Task: Summarize the team's status based on their engineering daily work logs (Check-ins and Check-outs).
      
      Constraints:
      1. Start with a "Health Status": Green/Yellow/Red based on blockers and energy levels.
      2. Highlight the difference between Planned Tasks (Check-in) and Completed Tasks (Check-out) if visible.
      3. Explicitly name users who are blocked or have low energy (< 4).
      4. Summarize total hours worked if available.
      5. Tone: Professional, concise, executive-level.
      6. Return ONLY the summary text, no markdown code blocks.
    `;

    // Always use systemInstruction in the config object
    const response = await safeGenerate({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction,
      }
    });
    if (!response) return NOT_CONFIGURED_MSG;

    return response.text || "Unable to generate summary.";
  } catch (error) {
    console.error("Gemini Summary Error:", error);
    return "Error generating summary. Please check your API key.";
  }
};

/**
 * Generates a personal weekly report for a contributor based on their daily logs.
 */
export const generateWeeklyReport = async (logs: DailyLog[], userName: string): Promise<string> => {
  try {
    const prompt = `User Name: ${userName}\nWeekly Logs (JSON): ${JSON.stringify(logs)}`;
    const systemInstruction = `
      Role: You are a professional career coach helping an employee write their Weekly Review.
      Task: Write a concise yet impactful Weekly Report based on daily log history.
      Structure:
      1. Key Accomplishments (What was actually finished).
      2. Challenges/Blockers Encountered (and how they were handled).
      3. Focus for Next Week (Inferred from unfinished tasks).
      
      Tone: Professional, First-person ("I completed...").
    `;

    // Always use systemInstruction in the config object
    const response = await safeGenerate({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction,
      }
    });
    if (!response) return NOT_CONFIGURED_MSG;

    return response.text || "Unable to generate weekly report.";
  } catch (error) {
    console.error("Gemini Weekly Report Error:", error);
    return "Error generating report.";
  }
};

/**
 * Allows a Manager to ask natural language questions about team logs.
 */
export const queryTeamLogs = async (
  query: string,
  logs: DailyLog[],
  chatHistory: { role: 'user' | 'model'; text: string }[]
): Promise<string> => {
  try {
    const historyFormatted = chatHistory.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));

    const systemInstruction = `
      Role: You are a Data Analyst and Team Lead Assistant.
      Input: A JSON list of team daily logs.
      
      Instructions:
      1. Analyze the provided logs to answer the specific question.
      2. If asking about performance, calculate completion rates or sentiment trends if possible.
      3. If asking about a specific person or day, filter the data accordingly.
      4. Be specific. Cite dates and names.
      5. If the data is missing, state clearly that it's not in the logs.

      Team Logs Context:
      ${JSON.stringify(logs)}
    `;

    // Always use systemInstruction in the config object
    const response = await safeGenerate({
      model: MODEL_NAME,
      contents: [
        ...historyFormatted,
        { role: 'user', parts: [{ text: query }] }
      ],
      config: {
        systemInstruction,
      }
    });
    if (!response) return NOT_CONFIGURED_MSG;

    return response.text || "I couldn't analyze the data at this moment.";
  } catch (error) {
    console.error("Gemini Query Error:", error);
    return "Error analyzing team logs.";
  }
};

/**
 * Simulates a RAG chat response based on a specific document context and selected mode.
 * Now supports linking to internal resources.
 */
export const chatWithDocument = async (
  query: string,
  docContent: string,
  chatHistory: { role: 'user' | 'model'; text: string }[],
  mode: 'general' | 'customer_service' = 'general',
  inventoryContext: string = "" // List of available files/folders for linking
): Promise<string> => {
  try {
    const historyFormatted = chatHistory.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));

    let systemInstruction = "";
    if (mode === 'customer_service') {
      systemInstruction = `
        You are an expert Sales Support Specialist and Customer Success Agent.
        The user is a sales representative asking for help with a customer inquiry or objection.
        
        Instructions:
        1. Analyze the context (product info, policies, sales data).
        2. Draft a professional, persuasive response for the customer, or provide strategic advice to the sales rep.
        3. Highlight key selling points found in the documents.
        4. Tone: Empathetic, professional, persuasive, and solution-oriented.
      `;
    } else {
      systemInstruction = `
        You are a helpful Knowledge Base Assistant.
        
        Instructions:
        1. Answer strictly based on the provided context.
        2. If the answer isn't in the context, say "I don't find that information in this document."
        3. Be helpful and concise.
        
        IMPORTANT: CITATION FORMAT
        If you are referring to a specific document or folder listed in the "Available Inventory", you MUST use the following format:
        - For Documents: [[doc:ID|Document Name]]
        - For Folders: [[folder:ID|Folder Name]]
        
        Example: "You can find the details in [[doc:3|Travel Policy]] located in the [[folder:f2|HR Policies]] folder."
      `;
    }

    const prompt = `
      Available Inventory (Files/Folders you can link to):
      ${inventoryContext}

      Current Context Content:
      "${docContent}"

      User Query: "${query}"
    `;

    // Always use systemInstruction in the config object
    const response = await safeGenerate({
      model: MODEL_NAME,
      contents: [
        ...historyFormatted,
        { role: 'user', parts: [{ text: prompt }] }
      ],
      config: {
        systemInstruction,
      }
    });
    if (!response) return NOT_CONFIGURED_MSG;

    return response.text || "No response generated.";
  } catch (error) {
    console.error("Gemini Chat Error:", error);
    return "I'm having trouble connecting to the Knowledge Base right now.";
  }
};

/**
 * Generates a quick quiz question for a learning module.
 */
export const generateQuizQuestion = async (moduleTitle: string): Promise<string> => {
  try {
    const prompt = `Generate a quiz question for module: "${moduleTitle}".`;
    const systemInstruction = `
      You are an expert instructional designer.
      Generate a single multiple-choice question to test a new hire's understanding.
      
      Format:
      Question: [The Question]
      A) [Option]
      B) [Option]
      C) [Option]
      Correct Answer: [Letter]
    `;

    // Always use systemInstruction in the config object
    const response = await safeGenerate({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction,
      }
    });
    if (!response) return NOT_CONFIGURED_MSG;

    return response.text || "Quiz generation failed.";
  } catch (error) {
    console.error("Gemini Quiz Error:", error);
    return "Could not generate a quiz at this time.";
  }
};
