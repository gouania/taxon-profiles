import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { TaxonData, ComparisonData, Source } from "../types";

// Helper to get the API Key securely
const getApiKey = (): string => {
  const key = 
    process.env.GEMINI_API_KEY || 
    process.env.API_KEY || 
    (import.meta.env && import.meta.env.VITE_GEMINI_API_KEY as string) || 
    (import.meta.env && import.meta.env.VITE_API_KEY as string);

  if (!key || key.trim() === "" || key === "undefined" || key === "null" || key === '""') {
    throw new Error("API key is missing. Please set GEMINI_API_KEY in the environment variables or click the 'Connect API Key' button.");
  }
  return key;
};

// Define the response schemas using Gemini's schema format
const confusedTaxonSchema = {
  type: "object" as const,
  properties: {
    name: {
      type: "string" as const,
      description: "Name of confused taxon",
    },
    difference: {
      type: "string" as const,
      description: "How to distinguish it (Markdown supported, use bolding only for critical keywords)",
    },
    keyFeature: {
      type: "string" as const,
      description: "Specific feature to look at",
    },
  },
  required: ["name", "difference", "keyFeature"],
};

const taxonSchema = {
  type: "object" as const,
  properties: {
    scientificName: {
      type: "string" as const,
      description: "Formal scientific name",
    },
    author: {
      type: "string" as const,
      description: "Standard botanical or zoological author citation (e.g. 'L.', 'Linnaeus', '(Lam.) J.St.-Hil.')",
    },
    commonName: {
      type: "string" as const,
      description: "Most common vernacular name",
    },
    lineage: {
      type: "array" as const,
      items: { type: "string" },
      description: "Higher taxonomic lineage from highest to lowest rank (e.g., ['Order', 'Family', 'Subfamily', 'Tribe', 'Genus']). Exclude the profiled taxon itself.",
    },
    includedTaxaCount: {
      type: "string" as const,
      description: "The global number of accepted included taxa for this rank (e.g., 'Approx. 50 genera', '3 subspecies', 'Monotypic'). Use approximate figures if necessary.",
    },
    localIncludedTaxaCount: {
      type: "string" as const,
      description: "The number of accepted included taxa specifically within the requested locality. E.g., '5 species in California'. Write 'N/A' if no locality context is provided or applicable.",
    },
    synonyms: {
      type: "array" as const,
      items: { type: "string" },
      description: "1-3 notable synonyms (especially recent valid reassignments). Empty array if none are notable.",
    },
    conservationStatus: {
      type: "string" as const,
      description: "Current IUCN or regional conservation status (e.g., 'Least Concern', 'Endangered', 'Not Evaluated').",
    },
    hazards: {
      type: "string" as const,
      description: "Toxicity to humans/pets, venom, physical hazards, or 'None known'.",
    },
    fieldNotes: {
      type: "string" as const,
      description: "Sensory or behavioral ID cues: smells, sounds/vocalizations, flight patterns, tracks, bruising, or sap. Return as a Markdown bulleted list. If NA, write 'N/A'.",
    },
    seasonality: {
      type: "string" as const,
      description: "Phenology (flowering/fruiting times), migration, or activity periods. Describe concisely. Write 'N/A' if not applicable.",
    },
    humanRelevance: {
      type: "string" as const,
      description: "Ethnobotany, economic impact, traditional uses, edibility, or pest status. Write 'N/A' if none.",
    },
    quickRecap: {
      type: "string" as const,
      description: "A 2-3 sentence summary. This MUST include the primary diagnostic morphological character. Use bolding sparingly—only for the absolute most decisive traits.",
    },
    diagnosticDescription: {
      type: "string" as const,
      description: "A standard Markdown bulleted list restricted ONLY to purely morphological characteristics. EACH feature (Habit, Leaves, Flowers, Fruit, etc.) MUST be its own bullet point on a NEW LINE. Format: '- **Feature**: Description'. DO NOT merge items or use dashes within a single line to separate features.",
    },
    confusedTaxa: {
      type: "array" as const,
      items: confusedTaxonSchema,
      description: "Taxa commonly confused with this one",
    },
    ecology: {
      type: "string" as const,
      description: "Habitat and ecological role (Markdown supported, use bolding sparingly for keywords)",
    },
    etymology: {
      type: "string" as const,
      description: "Origin of the scientific name (Markdown supported, use bolding for roots)",
    },
    history: {
      type: "string" as const,
      description: "Historical/pre-Linnaean context (Markdown supported, bold key figures)",
    },
    distribution: {
      type: "string" as const,
      description: "Geographic range (Markdown supported, bold primary regions)",
    },
  },
  required: [
    "scientificName",
    "author",
    "commonName",
    "includedTaxaCount",
    "localIncludedTaxaCount",
    "synonyms",
    "conservationStatus",
    "hazards",
    "fieldNotes",
    "seasonality",
    "humanRelevance",
    "lineage",
    "quickRecap",
    "diagnosticDescription",
    "confusedTaxa",
    "ecology",
    "etymology",
    "history",
    "distribution",
  ],
};

// Helper to extract sources from grounding metadata
const extractSources = (response: any): Source[] => {
  const sources: Source[] = [];
  const candidates = response.candidates;
  if (candidates && candidates.length > 0) {
    const candidate = candidates[0];
    const groundingMetadata = candidate.groundingMetadata;
    if (groundingMetadata && groundingMetadata.groundingChunks) {
      groundingMetadata.groundingChunks.forEach((chunk: any) => {
        if (chunk.web) {
          sources.push({
            title: chunk.web.title || "Source",
            uri: chunk.web.uri,
          });
        }
      });
    }
  }
  // Deduplicate sources by URI
  return Array.from(new Map(sources.map((s) => [s.uri, s])).values());
};

const handleApiError = (error: any) => {
  console.error("Gemini API Error:", error);
  const msg = error.message || "";
  const name = error.name || "";

  if (
    name === "AbortError" ||
    msg.includes("aborted") ||
    msg.includes("Failed to fetch")
  ) {
    throw new Error(
      "Connection failed. Please check your internet connection or try a different browser."
    );
  }
  throw error;
};

export const analyzeTaxon = async (taxonName: string, locality?: string, useSearch: boolean = true): Promise<TaxonData> => {
  try {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });

    const prompt = `Taxonomist mode. Analyze: "${taxonName}"${locality ? ` within the locality/geographic context of "${locality}"` : ""}. 
Search for precise diagnostic morphology and verified classification.

STRICT STRUCTURAL RULES:
1. 'quickRecap': Exactly 2-3 sentences. Focus on the most unique identifier.
2. 'diagnosticDescription': This MUST be a valid Markdown bulleted list. 
   - Every Morphological character (Habit, Leaves, Flowers, Fruit, etc.) MUST start on its own line with a hyphen.
   - Use this exact format for every item: "- **Character**: Description text."
   - BOLDING: You MUST explicitly **bold** the most useful diagnostic characters/states within the description text (e.g., "- **Leaves**: **Opposite**, simple, margins **entire**").
   - VERY IMPORTANT: This section MUST ONLY include morphological information. Other significant data (ecology, distribution, toxicity, field notes, etc.) MUST be pushed to their respective sections.
3. CASE SENSITIVITY: Use normal sentence case for feature names (e.g., **Leaves**, not **LEAVES**).
4. 'includedTaxaCount' and 'localIncludedTaxaCount': Specify the global number of accepted included taxa, and if a locality is provided, the number within that locality.
5. 'fieldNotes', 'hazards', 'conservationStatus', 'seasonality', 'humanRelevance': Provide concise context. Map plant traits (sap, smell) or animal traits (calls, behavior) to 'fieldNotes'. Synonyms should capture major recent nomenclatural changes.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: useSearch ? [{ googleSearch: {} }] : undefined,
        temperature: 0.1,
        responseSchema: taxonSchema,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    const data = JSON.parse(text) as TaxonData;
    data.sources = useSearch ? extractSources(response) : [];
    if (locality) data.localityContext = locality;

    return data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const compareTaxa = async (names: string[], locality?: string, useSearch: boolean = true): Promise<ComparisonData> => {
  try {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const count = names.length;

    const taxonProperties: any = {};
    const differenceProperties: any = {};

    names.forEach((_, index) => {
      const key = `taxon${index + 1}`;
      taxonProperties[key] = taxonSchema;
      differenceProperties[`taxon${index + 1}State`] = {
        type: "string" as const,
        description: `State in taxon ${index + 1} (Markdown supported, bold sparingly)`,
      };
    });

    const comparisonSchema = {
      type: "object" as const,
      properties: {
        ...taxonProperties,
        keyDifferences: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              feature: {
                type: "string" as const,
                description: "The morphological character being compared",
              },
              ...differenceProperties,
            },
            required: ["feature", ...Object.keys(differenceProperties)],
          },
          description: "Key diagnostic differences between the taxa",
        },
      },
      required: [
        ...Object.keys(taxonProperties),
        "keyDifferences",
      ],
    };

    const prompt = `Taxonomist mode. Compare: ${names.map((n) => `"${n}"`).join(", ")}${locality ? ` within the locality/geographic context of "${locality}"` : ""}.
Search for precise differences in recent literature.

STRICT LIST FORMATTING:
- For each 'taxon' object, the 'diagnosticDescription' MUST be a bulleted Markdown list.
- One morphological character per line. No merged paragraphs.
- BOLDING: Explicitly **bold** the most useful diagnostic characters/states within the description text.
- VERY IMPORTANT: The 'diagnosticDescription' MUST ONLY include morphological information. Other data MUST go to its respective section.
- Under 'includedTaxaCount', specify the global number of accepted included taxa for that taxon, and 'localIncludedTaxaCount' for the number within the locality if provided.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: useSearch ? [{ googleSearch: {} }] : undefined,
        temperature: 0.1,
        responseSchema: comparisonSchema,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    const rawData = JSON.parse(text);

    const taxa: TaxonData[] = [];
    for (let i = 0; i < count; i++) {
      const key = `taxon${i + 1}`;
      if (rawData[key]) {
        taxa.push(rawData[key]);
      }
    }

    const keyDifferences = (rawData.keyDifferences || []).map((diff: any) => ({
      feature: diff.feature,
      states: names.map((_, i) => diff[`taxon${i + 1}State`] || "N/A"),
    }));

    return {
      taxa,
      keyDifferences,
      sources: useSearch ? extractSources(response) : [],
      ...(locality ? { localityContext: locality } : {}),
    };
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};