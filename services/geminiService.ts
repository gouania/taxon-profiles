import { TaxonData, ComparisonData } from "../types";
import { MalformedResponseError, validateComparisonData, validateTaxonData } from "../utils/taxonUtils";

export class ApiClientError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

export const analyzeTaxon = async (taxonName: string, locality?: string): Promise<TaxonData> => {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ taxonName, locality }),
  });

  if (!response.ok) {
    const errRes = await response.json().catch(() => ({}));
    const message =
      typeof errRes?.error === "string" && errRes.error.trim().length > 0
        ? errRes.error
        : `Server returned status ${response.status}`;
    throw new ApiClientError(message, response.status);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new MalformedResponseError("Server returned invalid JSON for taxon profile.");
  }

  return validateTaxonData(raw);
};

export const compareTaxa = async (names: string[], locality?: string): Promise<ComparisonData> => {
  const response = await fetch("/api/compare", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ names, locality }),
  });

  if (!response.ok) {
    const errRes = await response.json().catch(() => ({}));
    const message =
      typeof errRes?.error === "string" && errRes.error.trim().length > 0
        ? errRes.error
        : `Server returned status ${response.status}`;
    throw new ApiClientError(message, response.status);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new MalformedResponseError("Server returned invalid JSON for taxon comparison.");
  }

  return validateComparisonData(raw, names.length);
};
