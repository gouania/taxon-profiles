# Taxon Profiles 🧬🔍

**Taxon Profiles** is an experimental tool designed to generate comprehensive diagnostic profiles for biological taxa. It focuses on the morphological characters essential for identification and provides a side-by-side comparison mode to distinguish between lookalike species.

## 📖 Overview
While standard encyclopedic entries often focus on general facts, **Taxon Profiles** is tuned for the taxonomist. It prioritizes the "Diagnostic Description"—the specific characters (Habit, Leaves, Flowers, etc.) that define a group—and offers a reasoning-heavy comparison mode to isolate the decisive differences between two or three similar taxa.

This is App #2 in **The Biologist's Toolkit**, a suite of experimental prototypes exploring AI's role in systematic botany.

## ✨ Key Features
- **Diagnostic Profiles:** Generates structured descriptions focusing on morphological characters.
- **Comparison Mode:** Compare up to three taxa simultaneously. The AI generates a "Key Diagnostic Characters" table to highlight specific differences.
- **Search-Grounded Reasoning:** Powered by Gemini 3 Flash with Google Search grounding to synthesize data from live taxonomic literature.
- **Etymology & History:** Explores the roots of scientific names and pre-Linnaean historical context.
- **Print/PDF Export:** Includes a dedicated print-optimized view for generating field reports or physical records.
- **Source Transparency:** Direct links to the web sources used to verify the taxonomic data.

## 🛠 Tech Stack
- **Frontend:** React, TypeScript, Tailwind CSS
- **AI/LLM:** Google Gemini 3 Flash (with Thinking Mode enabled)
- **Data Source:** Google Search Grounding
- **Markdown:** Rendered via `marked`

## ⚠️ Disclaimer
This is an **experimental prototype**. While search grounding and "thinking" budgets significantly improve accuracy, AI can still hallucinate specific morphological details or geographic ranges. Always verify diagnostic characters against authoritative floras, faunas, or primary literature.

## 👤 Author
**Daniel Cahen, PhD**  
Botanist at the Royal Botanic Gardens, Kew.  
[iNaturalist Profile](https://www.inaturalist.org/people/danielcahen) | [X (Twitter)](https://x.com/Daniel_Cahen)

---
*Part of "The Biologist's Toolkit" series.*
