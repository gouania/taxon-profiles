export enum Mode {
  SINGLE = 'SINGLE',
  COMPARE = 'COMPARE'
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}


export interface ConfusedTaxon {
  name: string;
  difference: string;
  keyFeature: string;
}

export interface Source {
  title: string;
  uri: string;
}

export interface TaxonData {
  scientificName: string;
  author: string; // Scientific author citation
  commonName: string;
  lineage: string[]; // Higher taxonomic lineage from highest to lowest
  includedTaxaCount?: string; // Number of accepted included taxa globally
  localIncludedTaxaCount?: string; // Number of accepted included taxa in the specified locality
  synonyms?: string[]; // Notable synonyms or older classifications
  conservationStatus?: string; // IUCN or regional conservation status
  hazards?: string; // Toxicity, venom, or physical hazards
  fieldNotes?: string; // Non-morphological cues (smell, sound, behavior)
  seasonality?: string; // Phenology (flowering/fruiting), migration, or activity periods
  humanRelevance?: string; // Ethnobotany, uses, economic/agricultural impact
  localityContext?: string; // Geographic context applied
  quickRecap: string;
  diagnosticDescription: string; // Main "How to recognize"
  confusedTaxa: ConfusedTaxon[];
  ecology: string;
  etymology: string;
  history: string; // Pre-Linnaean/Historical context
  distribution: string;
  sources?: Source[];
}

export interface ComparisonData {
  taxa: TaxonData[];
  keyDifferences: {
    feature: string;
    states: string[]; // Array of strings corresponding to the taxa array order
  }[];
  sources?: Source[];
  localityContext?: string; // Geographic context applied
}
