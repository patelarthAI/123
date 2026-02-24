import { GoogleGenAI, Type, FunctionDeclaration, FunctionCallingConfigMode, ThinkingLevel } from "@google/genai";
import { ResumeData, ResumeFormat, GrammarIssue } from "@/types";

const SYSTEM_INSTRUCTION = `
You are a Resume Parser that extracts content VERBATIM. 
Your goal is to STRUCTURE the data exactly as seen in the document without losing ANY section.

CRITICAL RULES:
1. **NO REWRITING**: Keep text exactly as is.
2. **CAPTURE EVERYTHING**: Do not skip "Soft Skills", "Tools", "Languages", "Internships", or "Digital Skills".
3. **MAPPING**:
   - **Work History/Professional Experience** -> 'experience' array.
   - **Internships** -> 'internships' array.
   - **Education** -> 'education' array.
   - **Summary/Profile** -> 'summary' array. Split into multiple items if it is a list. If it is a paragraph, return a single item.
   - **EVERYTHING ELSE** -> 'customSections' array.
     - Example: If you see "RECRUITMENT PLATFORMS & TOOLS", create a customSection with title "RECRUITMENT PLATFORMS & TOOLS" and the items.
     - Example: If you see "SOFT SKILLS", create a customSection with title "SOFT SKILLS".
4. **FORMATTING**:
   - For 'experience' and 'internships': Extract Company, Title, Dates, Location, and Bullets.
   - **DATES**: STRICTLY format all dates as "Mmm YYYY" (e.g., "Jan 2024", "Feb 2023", "Mar 2022"). 
     - Use ONLY the first 3 letters for the month (Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec).
     - If a date range is present, use " - " separator (e.g., "Jan 2020 - Feb 2022").
     - If "Present" or "Current", keep as "Present".
5. **LOCATION**: STRICTLY format all locations as "City, ST" (e.g., "San Francisco, CA", "New York, NY").
   - **CITY**: Ensure city names are in Title Case (e.g., "san francisco" -> "San Francisco").
   - **STATE**: Use ONLY the 2-letter postal abbreviation for US states (e.g., "California" -> "CA", "Texas" -> "TX").
6. **TITLES**: Capture the EXACT section titles used in the resume.
7. **PRIVACY**: Do NOT include any phone numbers or email addresses in ANY field (including summary, custom sections, or title). If found, remove them completely.

Call 'save_resume_data' with the extracted data.
`;

const saveResumeTool: FunctionDeclaration = {
  name: "save_resume_data",
  description: "Saves the verbatim extracted resume data.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      fullName: { type: Type.STRING },
      contactInfo: {
        type: Type.OBJECT,
        properties: {
          email: { type: Type.STRING },
          phone: { type: Type.STRING },
          linkedin: { type: Type.STRING },
          website: { type: Type.STRING },
          location: { type: Type.STRING, description: "City, State, Zip Code" },
        }
      },
      
      summary: { type: Type.ARRAY, items: { type: Type.STRING } },
      sectionTitleSummary: { type: Type.STRING, description: "Exact title e.g. 'PROFILE SUMMARY'" },

      experience: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            company: { type: Type.STRING },
            title: { type: Type.STRING },
            dates: { type: Type.STRING },
            location: { type: Type.STRING },
            description: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
      },
      sectionTitleExperience: { type: Type.STRING, description: "Exact title e.g. 'PROFESSIONAL EXPERIENCE'" },

      internships: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            company: { type: Type.STRING },
            title: { type: Type.STRING },
            dates: { type: Type.STRING },
            location: { type: Type.STRING },
            description: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
      },
      sectionTitleInternships: { type: Type.STRING, description: "Exact title e.g. 'INTERNSHIPS'" },

      education: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            institution: { type: Type.STRING },
            degree: { type: Type.STRING },
            dates: { type: Type.STRING },
            location: { type: Type.STRING },
            details: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
      },
      sectionTitleEducation: { type: Type.STRING, description: "Exact title e.g. 'EDUCATION'" },

      customSections: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Exact Section Header, e.g. 'SOFT SKILLS', 'TECHNICAL SKILLS'" },
            items: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of items or lines in this section" }
          }
        },
        description: "All other sections not covered above. MUST NOT BE EMPTY if other sections exist."
      },
      
      extractionChanges: {
        type: Type.ARRAY,
        description: "List of changes made during extraction (e.g. removing phone numbers, formatting dates, adding missing titles)",
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["REMOVAL", "ADDITION", "MODIFICATION"] },
            description: { type: Type.STRING, description: "What was changed (e.g. 'Removed phone number: +1-555-0100')" },
            reason: { type: Type.STRING, description: "Why it was changed (e.g. 'PII Removal Policy')" }
          },
          required: ["id", "type", "description", "reason"]
        }
      }
    },
    required: ["fullName"],
  },
};

const grammarAnalysisTool: FunctionDeclaration = {
  name: "save_grammar_issues",
  description: "Saves a list of grammar and spelling issues found in the resume.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      issues: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            path: { type: Type.STRING, description: "The JSON path to the field, e.g. 'summary.0', 'experience.0.description.2'" },
            original: { type: Type.STRING, description: "The full text content of the field" },
            errorText: { type: Type.STRING, description: "The EXACT substring that contains the error" },
            suggestions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of 3 distinct improvement suggestions" },
            reason: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["SPELLING", "GRAMMAR", "STYLE"], description: "The category of the issue" },
          },
          required: ["id", "path", "original", "errorText", "suggestions", "reason", "type"],
        },
      },
    },
    required: ["issues"],
  },
};

export const analyzeGrammar = async (data: ResumeData, format: ResumeFormat): Promise<GrammarIssue[]> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please set it in the environment.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelId = "gemini-3-flash-preview";

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          {
            text: `Review the following resume data for spelling, grammar, and professional writing improvements. The target style is ${format}.
            
            STYLE-SPECIFIC INSTRUCTIONS:
            ${format === ResumeFormat.MODERN_EXECUTIVE 
              ? "- Ensure suggestions maintain a professional, expanded tone. Dates should remain in the 3-letter abbreviated format (e.g., 'Jan') as they will be expanded by the UI." 
              : "- Maintain a traditional, concise tone. Dates should remain abbreviated."}

            CRITICAL INSTRUCTIONS:
            1. **Spelling**: Identify standard **US English** spelling mistakes. Categorize as 'SPELLING'.
            2. **Grammar & Verb Tense**: Identify grammatical errors, incorrect verb tenses, or punctuation issues. Categorize as 'GRAMMAR'.
            3. **Resume Best Practices (Style)**: 
               - Suggest stronger action verbs (e.g., "Led" instead of "Was in charge of").
               - Identify passive voice and suggest active voice.
               - Categorize these as 'STYLE'.
            4. **Context**: For each issue, explain WHY the change is recommended based on resume writing standards.
            5. **Exclusions**: DO NOT flag technical terms, version numbers, framework names, or proper nouns unless clearly misspelled.
            6. Return a list of issues using the 'save_grammar_issues' tool.
            7. For each issue, provide:
               - 'path': The exact JSON path (dot notation).
               - 'original': The FULL text content of that field.
               - 'errorText': The EXACT substring within 'original' that is incorrect or could be improved.
               - 'suggestions': Provide exactly 3 distinct options to fix or improve the text.
               - 'reason': A detailed explanation of the error or improvement opportunity.
               - 'type': One of 'SPELLING', 'GRAMMAR', or 'STYLE'.
            
            DATA:
            ${JSON.stringify(data)}`
          }
        ],
      },
      config: {
        tools: [{ functionDeclarations: [grammarAnalysisTool] }],
        toolConfig: { 
          functionCallingConfig: { 
            mode: FunctionCallingConfigMode.ANY, 
            allowedFunctionNames: ["save_grammar_issues"]
          } 
        },
      },
    });

    const functionCalls = response.functionCalls;
    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      if (call.name === "save_grammar_issues") {
         const args = call.args as unknown as { issues: GrammarIssue[] };
         return args.issues || [];
      }
    }
    
    return []; // No issues found or model didn't call tool

  } catch (error) {
    console.error("Error analyzing grammar:", error);
    throw error;
  }
};

const cleanText = (text: string): string => {
  if (!text) return "";
  return text.replace(/^[\s\u2022\u00b7\-\*]+/, "").trim();
};

export interface ExtractionPayload {
  base64?: string;
  text?: string;
  mimeType: string;
  format: ResumeFormat;
}

export const extractResumeData = async (
  payload: ExtractionPayload
): Promise<ResumeData> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please set it in the environment.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelId = "gemini-3-flash-preview";

  try {
    const parts: any[] = [];
    
    if (payload.base64) {
      parts.push({
        inlineData: {
          data: payload.base64,
          mimeType: payload.mimeType,
        },
      });
    } else if (payload.text) {
      parts.push({
        text: `Here is the raw text content of a resume:\n\n${payload.text}`
      });
    }

    parts.push({
      text: `Extract resume data for the ${payload.format} style. 
      
      STYLE-SPECIFIC INSTRUCTIONS:
      ${payload.format === ResumeFormat.MODERN_EXECUTIVE 
        ? "- Focus on clarity and professional expansion. Ensure location (City, State, Zip) is clearly extracted. Abbreviate months to 3 letters (e.g., 'Jan') for internal normalization." 
        : "- Focus on brevity and traditional formatting. Abbreviate months to 3 letters (e.g., 'Jan')."}
      
      GENERAL INSTRUCTIONS:
      Do not miss ANY sections. Map Work to Experience, Internships to Internships, Education to Education. Put 'Soft Skills', 'Technical Skills', 'Languages', 'Tools', 'Projects' into customSections. CRITICAL: For contactInfo.location, extract City, State, and Zip Code if available. CRITICAL: For dates, if a month is present, abbreviate it to 3 letters (e.g., 'Jan'). If NO month is present, DO NOT add one (e.g., keep '2023' as '2023'). CRITICAL: Remove ALL phone numbers and email addresses from the main content, but keep them in the contactInfo fields if found.`,
    });

    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: parts,
      },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction: `
You are a Resume Parser that extracts content VERBATIM. 
Your goal is to STRUCTURE the data exactly as seen in the document without losing ANY section.

CRITICAL RULES:
1. **NO REWRITING**: Keep text exactly as is.
2. **CAPTURE EVERYTHING**: Do not skip "Soft Skills", "Tools", "Languages", "Internships", "Projects" or "Digital Skills".
3. **MAPPING**:
   - **Work History/Professional Experience** -> 'experience' array.
   - **Internships** -> 'internships' array.
   - **Education** -> 'education' array.
   - **Summary/Profile** -> 'summary' array.
   - **EVERYTHING ELSE** (including Projects, Certifications, Skills) -> 'customSections' array.
4. **FORMATTING**:
   - **DATES**: EXTRACT DATES EXACTLY AS THEY APPEAR. 
     - **DO NOT** add months if they are not present.
     - **DO NOT** change "2023" to "Jan 2023".
     - **DO NOT** change "Summer 2024" to "Jun 2024".
     - Keep the original format.
   - **TITLES**: Capture the EXACT section titles used in the resume.
5. **PRIVACY**: Do NOT include any phone numbers or email addresses in ANY field.
6. **Custom Sections**:
   - For sections like "Technical Skills" or "Projects", preserve the structure.
   - If a line looks like "Key: Value", keep it as a single string "Key: Value".
7. **CHANGE LOGGING (MANDATORY)**:
   - You MUST populate the 'extractionChanges' array with EVERY modification you make.
   - **REMOVAL**: If you remove a phone number or email, log it. (e.g. "Removed phone number: +1-555-0199", reason: "PII Policy").
   - **MODIFICATION**: If you reformat a date, log it. (e.g. "Changed 'January 2023' to 'Jan 2023'", reason: "Standardization").
   - **ADDITION**: If you add a missing section title or infer a header, log it. (e.g. "Added section title 'Projects'", reason: "Inferred from content").
   - **ELIMINATION**: If you remove irrelevant text (e.g. "References available upon request"), log it.

VERIFICATION STEP (INTERNAL):
Before outputting, you MUST internally verify that:
- You have captured EVERY single bullet point from the original text.
- You have NOT truncated any lists.
- You have captured ALL sections, even small ones like "Interests" or "Volunteering".
`,
        tools: [{ functionDeclarations: [saveResumeTool] }],
        toolConfig: { 
          functionCallingConfig: { 
            mode: FunctionCallingConfigMode.ANY, 
            allowedFunctionNames: ["save_resume_data"]
          } 
        },
      },
    });

    const functionCalls = response.functionCalls;
    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      if (call.name === "save_resume_data") {
         const data = call.args as unknown as ResumeData;
         
         if (!data.contactInfo) data.contactInfo = {};

         // Clean bullets
         if (data.summary) {
            if (typeof data.summary === 'string') {
                data.summary = [data.summary];
            }
            data.summary = data.summary.map(cleanText);
         }
         if (data.experience) {
           data.experience.forEach(exp => {
             if (exp.description) exp.description = exp.description.map(cleanText);
           });
         }
         if (data.internships) {
            data.internships.forEach(exp => {
              if (exp.description) exp.description = exp.description.map(cleanText);
            });
         }
         if (data.education) {
            data.education.forEach(edu => {
                if (edu.details) edu.details = edu.details.map(cleanText);
            });
         }
         if (data.customSections) {
             data.customSections.forEach(sec => {
                 if (sec.items) sec.items = sec.items.map(cleanText);
             });
         }

         return data;
      }
    }
    
    throw new Error("The AI model did not trigger the extraction tool correctly.");

  } catch (error) {
    console.error("Error extracting resume data:", error);
    throw error;
  }
};

export const checkSpelling = async (data: ResumeData, format: ResumeFormat): Promise<ResumeData> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please set it in the environment.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelId = "gemini-3-flash-preview";

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          {
            text: `Review the following resume data for spelling and grammar errors. The target style is ${format}.
            
            STYLE-SPECIFIC INSTRUCTIONS:
            ${format === ResumeFormat.MODERN_EXECUTIVE 
              ? "- Use a professional, expanded tone. Ensure dates follow the 3-letter abbreviation rule (e.g., 'Jan')." 
              : "- Use a traditional, concise tone. Ensure dates follow the 3-letter abbreviation rule."}

            CRITICAL INSTRUCTIONS:
            1. Fix standard English spelling and grammar mistakes.
            2. DO NOT change any technical terms, version numbers, framework names, or proper nouns (e.g., 'React', 'v14.2', 'K8s', 'Kubernetes', 'SQL', 'NoSQL').
            3. DO NOT change the structure of the data.
            4. Return the corrected JSON using the 'save_resume_data' tool.
            
            DATA:
            ${JSON.stringify(data)}`
          }
        ],
      },
      config: {
        tools: [{ functionDeclarations: [saveResumeTool] }],
        toolConfig: { 
          functionCallingConfig: { 
            mode: FunctionCallingConfigMode.ANY, 
            allowedFunctionNames: ["save_resume_data"]
          } 
        },
      },
    });

    const functionCalls = response.functionCalls;
    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      if (call.name === "save_resume_data") {
         const correctedData = call.args as unknown as ResumeData;
         
         // Ensure summary is array if string comes back
         if (correctedData.summary) {
            if (typeof correctedData.summary === 'string') {
                correctedData.summary = [correctedData.summary];
            }
         }

         return correctedData;
      }
    }
    
    throw new Error("The AI model did not return corrected data.");

  } catch (error) {
    console.error("Error checking spelling:", error);
    throw error;
  }
};