import React, { useState, useRef, useEffect, useCallback } from 'react';
import { parse } from 'marked';
import { analyzeTaxon, compareTaxa } from './services/geminiService';
import { TaxonData, ComparisonData, Mode, Source } from './types';
import { 
  SearchIcon, StarIcon, HandLensIcon, GlobeIcon, 
  BookOpenIcon, ScrollIcon, AlertTriangleIcon, ArrowRightLeftIcon, XIcon, PrinterIcon, MapPinIcon
} from './components/Icons';
import { TaxonCard } from './components/TaxonCard';

// Placeholder examples
const EXAMPLES = [
  'Amanita muscaria', 
  'Quercus robur', 
  'Canis lupus', 
  'Monarch Butterfly', 
  'Eupatorieae',
  'Ginkgo biloba',
  'Ornithorhynchus anatinus',
  'Apis mellifera',
  'Corvus corax',
  'Sphenodon punctatus',
  'Axolotl',
  'Coelacanth',
  'Tardigrada',
  'Octopus vulgaris',
  'Escherichia coli',
  'Saccharomyces cerevisiae',
  'Welwitschia mirabilis',
  'Drosophila melanogaster',
  'Tyrannosaurus rex',
  'Homo neanderthalensis'
];

// Cache Key Prefix
const CACHE_PREFIX = 'taxon_cache_v1_';

const LOADING_STAGES = [
  "Consulting biological databases...",
  "Analyzing morphological literature...",
  "Synthesizing diagnostic features...",
  "Extracting verification sources...",
  "Finalizing taxon profile..."
];

/**
 * Component to safely render Markdown content using 'marked'
 */
const MarkdownRenderer: React.FC<{ content: string; className?: string }> = ({ content, className = '' }) => {
  if (!content) return null;
  const html = parse(content) as string;
  return (
    <div 
      className={`prose-custom text-slate-300 ${className}`} 
      dangerouslySetInnerHTML={{ __html: html }} 
    />
  );
};

const SkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`rounded-xl border border-slate-800/50 bg-slate-900/50 p-6 ${className}`}>
    <div className="flex items-center gap-3 mb-4">
      <div className="w-10 h-10 rounded-lg bg-slate-800 animate-pulse"></div>
      <div className="h-6 w-1/3 bg-slate-800 rounded animate-pulse"></div>
    </div>
    <div className="space-y-3">
      <div className="h-4 w-full bg-slate-800/50 rounded animate-pulse"></div>
      <div className="h-4 w-5/6 bg-slate-800/50 rounded animate-pulse"></div>
      <div className="h-4 w-4/6 bg-slate-800/50 rounded animate-pulse"></div>
    </div>
  </div>
);

const SourceList: React.FC<{ sources?: Source[]; sticky?: boolean }> = ({ sources, sticky = false }) => {
  if (!sources || sources.length === 0) return null;
  
  const content = (
    <div className={`${sticky ? 'flex items-center gap-4 py-2 px-4' : 'mt-10 pt-8 border-t border-slate-800/50'}`}>
      {!sticky && (
        <h4 className="text-sm md:text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
          <div className="w-1 h-4 bg-cyan-500/50 rounded-full"></div>
          Verified Sources
        </h4>
      )}
      <div className="flex flex-wrap gap-2 overflow-x-auto no-scrollbar">
        {sources.map((source, idx) => (
          <a 
            key={idx} 
            href={source.uri} 
            target="_blank" 
            rel="noopener noreferrer"
            className={`group text-sm md:text-xs text-cyan-500 hover:text-cyan-400 bg-slate-900/50 px-3 py-1.5 rounded-lg border border-slate-800/50 hover:border-cyan-800/50 transition-all duration-200 truncate ${sticky ? 'max-w-[150px]' : 'max-w-[220px]'}`}
            title={source.title}
          >
            <span className="flex items-center gap-2">
              <span className="opacity-70 group-hover:opacity-100 transition-opacity">🔗</span>
              {source.title || new URL(source.uri).hostname}
            </span>
          </a>
        ))}
      </div>
    </div>
  );

  if (sticky) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-max max-w-[90vw] bg-slate-950/80 backdrop-blur-md border border-slate-800/50 rounded-2xl shadow-2xl print:hidden">
        {content}
      </div>
    );
  }

  return content;
};

const App: React.FC = () => {
  const [mode, setMode] = useState<Mode>(Mode.SINGLE);
  const [inputs, setInputs] = useState<string[]>(['']);
  const [locality, setLocality] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [singleData, setSingleData] = useState<TaxonData | null>(null);
  const [compareData, setCompareData] = useState<ComparisonData | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [hasSelectedKey, setHasSelectedKey] = useState<boolean>(true);
  
  const resultsRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount & keyboard shortcut
  useEffect(() => {
    firstInputRef.current?.focus();
    
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasSelectedKey(hasKey);
      }
    };
    checkKey();

    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 500);
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        firstInputRef.current?.focus();
      }
    };

    window.addEventListener('scroll', handleScroll);
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('keydown', handleKeydown);
    };
  }, []);

  // Cycle loading stages
  useEffect(() => {
    let interval: number;
    if (loading) {
      setLoadingStage(0);
      interval = window.setInterval(() => {
        setLoadingStage(prev => (prev + 1) % LOADING_STAGES.length);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const getCachedData = (key: string) => {
    const cached = localStorage.getItem(CACHE_PREFIX + key.toLowerCase().trim());
    return cached ? JSON.parse(cached) : null;
  };

  const setCacheData = (key: string, data: any) => {
    try {
      localStorage.setItem(CACHE_PREFIX + key.toLowerCase().trim(), JSON.stringify(data));
    } catch (e) {
      console.warn("Storage quota exceeded, cache skipped.");
    }
  };

  const handleSearch = async (overrideInputs?: string[], overrideMode?: Mode) => {
    const currentInputs = Array.isArray(overrideInputs) ? overrideInputs : inputs;
    const currentMode = overrideMode || mode;
    const validInputs = currentInputs.map(i => i.trim()).filter(i => i.length > 0);
    const validLocality = locality.trim();
    if (validInputs.length === 0) return;
    if (currentMode === Mode.COMPARE && validInputs.length < 2) {
      setError("Please enter at least two taxa to compare.");
      return;
    }

    const cacheKey = currentMode + '_' + validInputs.sort().join('|') + '_' + validLocality;
    const cached = getCachedData(cacheKey);
    
    if (cached) {
      setError(null);
      if (currentMode === Mode.SINGLE) setSingleData(cached);
      else setCompareData(cached);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      return;
    }

    setLoading(true);
    setError(null);
    setSingleData(null);
    setCompareData(null);

    try {
      if (currentMode === Mode.SINGLE) {
        const data = await analyzeTaxon(validInputs[0], validLocality || undefined);
        setSingleData(data);
        setCacheData(cacheKey, data);
      } else {
        const data = await compareTaxa(validInputs, validLocality || undefined);
        setCompareData(data);
        setCacheData(cacheKey, data);
      }
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err: any) {
      console.error(err);
      const msg = err.message || "";
      if (msg.includes("403") || msg.includes("PERMISSION_DENIED") || msg.includes("unregistered callers") || msg.includes("API key is missing")) {
        setHasSelectedKey(false);
        setError("API key error. Please select a valid API key to continue.");
      } else if (msg.includes("Requested entity was not found")) {
        setHasSelectedKey(false);
        setError("The selected API key is invalid or has expired. Please re-select your key.");
      } else {
        setError(msg || "An unexpected error occurred. Try re-checking the spelling or use a genus-level name.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const loadExample = (ex: string) => {
    setInputs([ex]);
    setMode(Mode.SINGLE);
    handleSearch([ex], Mode.SINGLE);
  };

  const loadTaxon = (taxonName: string) => {
    setInputs([taxonName]);
    setMode(Mode.SINGLE);
    handleSearch([taxonName], Mode.SINGLE);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const updateInput = (index: number, value: string) => {
    const newInputs = [...inputs];
    newInputs[index] = value;
    setInputs(newInputs);
    if (error) setError(null);
  };

  const addInput = () => {
    if (inputs.length < 3) {
      setInputs([...inputs, '']);
    }
  };

  const removeInput = (index: number) => {
    if (inputs.length > 1) {
      const newInputs = inputs.filter((_, i) => i !== index);
      setInputs(newInputs);
    }
  };

  const toggleMode = () => {
    if (mode === Mode.SINGLE) {
      setMode(Mode.COMPARE);
      if (inputs.length < 2) setInputs([inputs[0] || '', '']);
    } else {
      setMode(Mode.SINGLE);
      setInputs([inputs[0] || '']);
    }
    setSingleData(null);
    setCompareData(null);
  };

  const handleOpenSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasSelectedKey(true);
      setError(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handlePrint = () => {
    const content = resultsRef.current;
    if (!content) return;
    const printWindow = window.open('', '_blank', 'height=800,width=900');
    if (!printWindow) {
      alert("Please allow pop-ups for this site to enable the print view.");
      return;
    }
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map(style => style.outerHTML)
      .join('');
    const scripts = Array.from(document.querySelectorAll('script[src*="tailwindcss"]'))
      .map(script => script.outerHTML)
      .join('');
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Taxon Profile Report</title>
          ${styles}
          ${scripts}
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
          <style>
            body { background: white !important; color: black !important; padding: 40px; font-family: 'Inter', sans-serif; }
            .bg-slate-900, .bg-slate-950, .bg-slate-800 { background: white !important; border: 1px solid #eee !important; color: black !important; }
            * { color: black !important; border-color: #ddd !important; }
            .no-print, .copy-btn { display: none !important; }
            h1, h2, h3, h4 { font-family: 'Outfit', sans-serif !important; }
          </style>
        </head>
        <body>
          <h1 style="font-family: Outfit, sans-serif; font-size: 24px; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px;">Taxon Profile Report</h1>
          ${content.innerHTML}
          <div style="margin-top: 40px; font-size: 10px; text-align: center; border-top: 1px solid #eee; padding-top: 10px;">Generated on ${new Date().toLocaleString()}</div>
          <script>window.onload = () => setTimeout(() => window.print(), 500);</script>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-200 selection:bg-cyan-500/30 pb-24 print:bg-white print:text-black">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-900/5 via-transparent to-transparent pointer-events-none print:hidden"></div>
      
      <header className="relative pt-24 pb-16 px-4 text-center max-w-5xl mx-auto print:pt-4">
        <div className="flex justify-center items-center gap-4 mb-2">
          <h1 className="text-6xl md:text-7xl font-bold font-display text-white tracking-tight print:text-black print:text-4xl">
            Taxon <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400">Profiles</span>
          </h1>
          <div className="flex items-center gap-2 print:hidden">
            {!hasSelectedKey && (
              <button 
                onClick={handleOpenSelectKey}
                className="text-amber-500 hover:text-amber-400 transition-colors animate-pulse"
                title="Connect API Key"
              >
                <AlertTriangleIcon className="w-6 h-6" />
              </button>
            )}
          </div>
        </div>
        <p className="text-lg md:text-xl text-slate-400 mb-12 max-w-3xl mx-auto leading-relaxed font-light print:text-black print:text-sm">
          A biological identification assistant focusing on diagnostic morphological characters and providing other essential information.
        </p>

        <div className="relative bg-slate-900/40 backdrop-blur-xl border border-slate-800/50 p-3 rounded-3xl shadow-2xl max-w-3xl mx-auto print:hidden">
          <div className="flex flex-col gap-3 p-3">
            {inputs.map((input, index) => (
              <div key={index} className="relative flex items-center gap-3 animate-in fade-in slide-in-from-left-4 duration-300">
                <div className="relative flex-grow group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 flex items-center gap-1 group-focus-within:text-cyan-500 transition-colors">
                    <SearchIcon className="w-5 h-5" />
                    {index === 0 && <span className="text-[10px] font-mono opacity-50">/</span>}
                  </div>
                  <input
                    ref={index === 0 ? firstInputRef : null}
                    type="text"
                    value={input}
                    onChange={(e) => updateInput(index, e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={mode === Mode.COMPARE ? `Taxon ${index + 1}` : "Enter name (e.g., Amanita muscaria)..."}
                    className="w-full bg-slate-950/50 border border-slate-800/50 rounded-2xl py-4 pl-12 pr-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all"
                  />
                </div>
                {mode === Mode.COMPARE && index > 1 && (
                  <button onClick={() => removeInput(index)} className="p-4 bg-slate-950/50 hover:bg-red-950/20 text-slate-500 hover:text-red-400 rounded-2xl border border-slate-800/50 transition-all"><XIcon className="w-5 h-5" /></button>
                )}
              </div>
            ))}

            {mode === Mode.COMPARE && inputs.length < 3 && (
              <button onClick={addInput} className="py-3 px-4 rounded-2xl border border-dashed border-slate-800/50 text-slate-500 hover:text-cyan-400 hover:border-cyan-800/50 transition-all text-base md:text-sm font-medium">+ Add Taxon</button>
            )}
            
            <div className="relative group">
               <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 flex items-center gap-1 group-focus-within:text-cyan-500 transition-colors">
                 <MapPinIcon className="w-5 h-5" />
               </div>
               <input
                 type="text"
                 value={locality}
                 onChange={(e) => setLocality(e.target.value)}
                 onKeyDown={handleKeyDown}
                 placeholder="Locality (Optional, e.g., 'California', 'UK')"
                 className="w-full bg-slate-950/30 border border-slate-800/30 rounded-2xl py-3 pl-12 pr-10 text-white text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all"
               />
               {locality && (
                 <button
                   onClick={() => setLocality('')}
                   className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                   title="Clear locality"
                 >
                   <XIcon className="w-4 h-4" />
                 </button>
               )}
            </div>

            <button
              onClick={handleSearch}
              disabled={loading}
              className="relative mt-3 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-emerald-600 text-white font-semibold py-4 px-8 rounded-2xl transition-all shadow-lg disabled:opacity-50 w-full group overflow-hidden"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-3">
                  <span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></span>
                  <span className="animate-pulse">{LOADING_STAGES[loadingStage]}</span>
                </span>
              ) : (
                mode === Mode.COMPARE ? 'Compare Taxa' : 'Analyze Taxon'
              )}
            </button>
          </div>

          <div className="flex justify-between items-center py-3 border-t border-slate-800/30 mt-2 px-2">
             <button onClick={toggleMode} className="flex items-center gap-2 text-base md:text-sm font-medium text-cyan-400 hover:text-cyan-300 transition-colors">
                {mode === Mode.SINGLE ? <><ArrowRightLeftIcon className="w-4 h-4" /> Comparison Mode</> : <><XIcon className="w-4 h-4" /> Cancel Comparison</>}
             </button>
             {(singleData || compareData) && (
               <button onClick={handlePrint} className="flex items-center gap-2 text-base md:text-sm font-medium text-slate-400 hover:text-white transition-colors"><PrinterIcon className="w-4 h-4" /> Print / PDF</button>
             )}
          </div>
        </div>

        {!singleData && !compareData && !loading && (
          <div className="mt-10 flex flex-wrap justify-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-700 print:hidden">
            <span className="text-sm md:text-xs text-slate-500 uppercase tracking-widest mr-2 self-center">Quick Examples:</span>
            {EXAMPLES.map(ex => (
              <button key={ex} onClick={() => loadExample(ex)} className="px-5 py-2 bg-slate-900/30 hover:bg-slate-800/50 border border-slate-800/30 rounded-full text-base md:text-sm text-slate-400 hover:text-slate-200 transition-all">{ex}</button>
            ))}
          </div>
        )}
      </header>

      <main ref={resultsRef} className="relative max-w-7xl mx-auto px-4 print:px-0">
        {error && (
          <div className="p-8 bg-red-950/30 border border-red-500/30 rounded-3xl text-red-200 text-center mb-12 max-w-4xl mx-auto animate-in fade-in slide-in-from-top-4 duration-500">
            <AlertTriangleIcon className="w-12 h-12 mx-auto mb-4 text-red-500" />
            <div className="text-base md:text-sm font-mono break-all mb-6">{error}</div>
            {!hasSelectedKey && (
              <button 
                onClick={handleOpenSelectKey}
                className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold py-3 px-8 rounded-2xl transition-all shadow-lg active:scale-95"
              >
                Connect API Key
              </button>
            )}
          </div>
        )}

        {loading && (
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="text-center mb-8"><div className="h-12 w-64 bg-slate-800/50 rounded-lg mx-auto mb-4 animate-pulse"></div><div className="h-4 w-32 bg-slate-800/50 rounded-lg mx-auto animate-pulse"></div></div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6"><div className="lg:col-span-8"><SkeletonCard className="h-64" /></div><div className="lg:col-span-4 space-y-6"><SkeletonCard className="h-40" /><SkeletonCard className="h-40" /></div></div>
          </div>
        )}

        {singleData && !loading && (
          <div className="space-y-8 animate-in fade-in duration-500 max-w-6xl mx-auto">
            <div className="text-center mb-12 relative group print:mb-6">
               <h2 className="text-5xl md:text-6xl font-bold font-display text-white mb-3 tracking-tight print:text-black print:text-3xl flex items-baseline justify-center gap-4 flex-wrap relative">
                 <i className="italic font-display cursor-help" onClick={() => copyToClipboard(singleData.scientificName)} title="Click to copy">{singleData.scientificName}</i>
                 {singleData.author && <span className="text-xl md:text-2xl text-slate-400 font-normal not-italic print:text-black">{singleData.author}</span>}
               </h2>
               <p className="text-2xl text-cyan-400 font-medium mb-2 print:text-black">
                 {singleData.commonName}
                 {singleData.localityContext && <span className="ml-2 text-slate-400 text-lg font-normal">({singleData.localityContext})</span>}
               </p>
               {singleData.synonyms && singleData.synonyms.length > 0 && (
                 <p className="text-slate-500 text-sm md:text-sm italic mb-2 print:text-black">
                   Synonyms: {singleData.synonyms.join(', ')}
                 </p>
               )}
               <div className="flex justify-center flex-wrap items-center gap-3 mb-5">
                 {singleData.includedTaxaCount && (
                   <p className="text-slate-400 text-sm md:text-sm italic print:text-black">
                     Includes: <span className="text-slate-300 font-medium not-italic">{singleData.includedTaxaCount.replace(/\*/g, '')}</span>
                     {singleData.localIncludedTaxaCount && singleData.localIncludedTaxaCount !== 'N/A' && (
                       <>
                         <span className="mx-2 text-slate-600">•</span>
                         <span className="text-cyan-400 font-medium not-italic">Local to {singleData.localityContext}: {singleData.localIncludedTaxaCount.replace(/\*/g, '')}</span>
                       </>
                     )}
                   </p>
                 )}
                 {singleData.conservationStatus && singleData.conservationStatus !== 'Not Evaluated' && singleData.conservationStatus !== 'N/A' && (
                   <span className="px-2.5 py-1 rounded-md bg-slate-800/80 text-xs font-semibold text-slate-300 border border-slate-700/50 print:bg-gray-100 print:text-black print:border-gray-300">
                     {singleData.conservationStatus}
                   </span>
                 )}
               </div>
               <div className="flex flex-wrap justify-center items-center gap-2">
                 {singleData.lineage && singleData.lineage.map((taxon, idx) => (
                   <div key={idx} className="flex items-center gap-2">
                     <button 
                       onClick={() => loadTaxon(taxon)}
                       className="inline-block px-3 py-1.5 bg-slate-900/50 hover:bg-slate-800/80 text-slate-400 hover:text-cyan-400 text-sm md:text-xs uppercase tracking-widest rounded-xl border border-slate-800/50 hover:border-cyan-800/50 transition-all cursor-pointer print:bg-white print:text-black"
                       title={`View profile for ${taxon}`}
                     >
                       {taxon}
                     </button>
                     {idx < singleData.lineage.length - 1 && (
                       <span className="text-slate-600 text-xs">›</span>
                     )}
                   </div>
                 ))}
               </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-8 space-y-6">
                <TaxonCard title="Quick Recap" icon={<StarIcon className="w-5 h-5" />} highlight onCopy={() => copyToClipboard(singleData.quickRecap)}>
                  <MarkdownRenderer content={singleData.quickRecap} />
                </TaxonCard>
                <TaxonCard title="Diagnostic Features" icon={<HandLensIcon className="w-5 h-5" />} onCopy={() => copyToClipboard(singleData.diagnosticDescription)}>
                  <MarkdownRenderer content={singleData.diagnosticDescription} />
                </TaxonCard>
              </div>
              <div className="lg:col-span-4 space-y-6">
                 {singleData.fieldNotes && singleData.fieldNotes !== 'N/A' && (
                   <TaxonCard title="Field Notes" icon={<svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9.5 8h5"/><path d="M9.5 12h5"/><path d="M9.5 16h5"/></svg>} onCopy={() => copyToClipboard(singleData.fieldNotes || '')}>
                     <div className="text-slate-400 text-base md:text-sm"><MarkdownRenderer content={singleData.fieldNotes} /></div>
                   </TaxonCard>
                 )}
                 <TaxonCard title="Ecology & Range" icon={<GlobeIcon className="w-5 h-5" />} onCopy={() => copyToClipboard(`${singleData.ecology}\n\n${singleData.distribution}`)}>
                    <div className="mb-5"><strong className="text-slate-200 block mb-2 text-sm md:text-xs font-bold uppercase tracking-widest text-cyan-400/70 print:text-black">Habitat</strong><MarkdownRenderer content={singleData.ecology} /></div>
                    <div className={singleData.seasonality && singleData.seasonality !== 'N/A' ? "mb-5" : ""}><strong className="text-slate-200 block mb-2 text-sm md:text-xs font-bold uppercase tracking-widest text-cyan-400/70 print:text-black">Distribution</strong><MarkdownRenderer content={singleData.distribution} /></div>
                    {singleData.seasonality && singleData.seasonality !== 'N/A' && (
                       <div><strong className="text-slate-200 block mb-2 text-sm md:text-xs font-bold uppercase tracking-widest text-cyan-400/70 print:text-black">Seasonality</strong><MarkdownRenderer content={singleData.seasonality} /></div>
                    )}
                 </TaxonCard>
                 <TaxonCard title="Etymology" icon={<BookOpenIcon className="w-5 h-5" />} onCopy={() => copyToClipboard(singleData.etymology)}>
                   <div className="text-slate-400 text-base md:text-sm"><MarkdownRenderer content={singleData.etymology} /></div>
                 </TaxonCard>
                 <TaxonCard title="History" icon={<ScrollIcon className="w-5 h-5" />} onCopy={() => copyToClipboard(singleData.history)}>
                   <div className="text-slate-400 text-base md:text-sm"><MarkdownRenderer content={singleData.history} /></div>
                 </TaxonCard>
                 {singleData.humanRelevance && singleData.humanRelevance !== 'N/A' && (
                   <TaxonCard title="Human Relevance" icon={<svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>} onCopy={() => copyToClipboard(singleData.humanRelevance || '')}>
                     <div className="text-slate-400 text-base md:text-sm"><MarkdownRenderer content={singleData.humanRelevance} /></div>
                   </TaxonCard>
                 )}
              </div>
              {singleData.hazards && !singleData.hazards.toLowerCase().includes('none') && singleData.hazards !== 'N/A' && (
                <div className="lg:col-span-12">
                  <div className="bg-orange-950/20 border border-orange-900/50 p-5 rounded-2xl text-orange-200 flex gap-4 items-start shadow-lg shadow-orange-900/10 print:border-black print:text-black print:bg-white">
                    <AlertTriangleIcon className="w-7 h-7 text-orange-500 shrink-0 mt-0.5 print:text-black" />
                    <div>
                      <h4 className="font-bold uppercase tracking-widest text-sm mb-1 text-orange-400 print:text-black">Hazards & Toxicity</h4>
                      <div className="text-base md:text-sm text-orange-200/90 print:text-black"><MarkdownRenderer content={singleData.hazards} /></div>
                    </div>
                  </div>
                </div>
              )}
              <div className="lg:col-span-12">
                 <TaxonCard title="Similar Taxa" icon={<AlertTriangleIcon className="w-5 h-5" />} className="border-orange-900/20">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                       {singleData.confusedTaxa.map((taxon, idx) => (
                         <div key={idx} className="bg-slate-950/30 p-5 rounded-xl border border-slate-800/50 group hover:border-orange-900/40 transition-all print:bg-white">
                            <button 
                              onClick={() => loadTaxon(taxon.name)}
                              className="font-bold font-display text-orange-300 hover:text-orange-200 mb-3 italic text-lg text-left transition-colors print:text-black cursor-pointer"
                              title={`View profile for ${taxon.name}`}
                            >
                              {taxon.name}
                            </button>
                            <div className="text-base md:text-sm text-slate-400 mb-3"><MarkdownRenderer content={taxon.difference} /></div>
                            <div className="pt-3 border-t border-slate-800/50"><span className="text-sm md:text-xs text-orange-400/70 uppercase tracking-wide font-semibold">Key Feature: </span><span className="text-sm md:text-xs text-orange-300 print:text-black">{taxon.keyFeature}</span></div>
                         </div>
                       ))}
                    </div>
                 </TaxonCard>
              </div>
              {singleData.sources && <div className="lg:col-span-12"><SourceList sources={singleData.sources} /></div>}
            </div>
          </div>
        )}

        {compareData && !loading && (
          <div className="animate-in fade-in duration-500">
             {compareData.localityContext && (
               <div className="text-center mb-8">
                 <p className="inline-block px-4 py-2 bg-slate-900/50 rounded-full text-slate-300 border border-slate-800/50 font-medium">
                   <MapPinIcon className="w-4 h-4 inline-block mr-2 -mt-0.5 text-cyan-500" />
                   Geographic Context: <span className="text-white">{compareData.localityContext}</span>
                 </p>
               </div>
             )}
             <div className={`grid gap-6 mb-10 text-center ${compareData.taxa.length === 3 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'}`}>
                {compareData.taxa.map((taxon, idx) => (
                  <div key={idx} className="relative p-8 bg-slate-900/40 backdrop-blur-sm rounded-3xl border border-slate-800/50 flex flex-col justify-center h-full print:bg-white">
                     <h2 className="text-3xl font-bold font-display text-white mb-2 print:text-black"><i className="italic">{taxon.scientificName}</i></h2>
                     <p className="text-xl text-cyan-400 font-medium mb-2 print:text-black">{taxon.commonName}</p>
                     {taxon.includedTaxaCount && (
                       <p className="text-slate-400 text-sm italic print:text-black">
                         Includes: <span className="text-slate-300 font-medium not-italic">{taxon.includedTaxaCount.replace(/\*/g, '')}</span>
                         {taxon.localIncludedTaxaCount && taxon.localIncludedTaxaCount !== 'N/A' && compareData.localityContext && (
                           <>
                             <span className="mx-2 text-slate-600">•</span>
                             <span className="text-cyan-400 font-medium not-italic">Local: {taxon.localIncludedTaxaCount.replace(/\*/g, '')}</span>
                           </>
                         )}
                       </p>
                     )}
                  </div>
                ))}
             </div>

             <div className="mb-10">
                <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/50 rounded-3xl overflow-hidden shadow-2xl print:bg-white">
                   <div className="bg-gradient-to-r from-slate-900 to-slate-800/50 p-6 text-center border-b border-slate-800/50 print:bg-white flex justify-between items-center px-10">
                      <h3 className="text-xl font-bold font-display text-white flex items-center gap-3 print:text-black">Key Diagnostic Characters</h3>
                      <button onClick={() => copyToClipboard(JSON.stringify(compareData.keyDifferences, null, 2))} className="text-sm md:text-xs text-slate-500 hover:text-white transition-colors print:hidden">Copy Data</button>
                   </div>
                   <div className="overflow-x-auto comparison-table">
                     <table className="w-full text-left text-slate-300 text-base md:text-sm min-w-[600px] print:text-black">
                        <thead className="bg-slate-950 text-slate-400 text-sm md:text-xs uppercase tracking-wider print:bg-gray-100">
                           <tr>
                              <th className="p-5 font-semibold font-display w-1/4 sticky-col">Character</th>
                              {compareData.taxa.map((taxon, idx) => (
                                <th key={idx} className="p-5 font-semibold font-display italic border-l border-slate-800/20">{taxon.scientificName}</th>
                              ))}
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/30">
                           {compareData.keyDifferences.map((diff, idx) => (
                              <tr key={idx} className="hover:bg-cyan-500/5 transition-colors">
                                 <td className="p-5 font-medium text-cyan-300 sticky-col border-r border-slate-800/20">{diff.feature}</td>
                                 {diff.states.map((state, sIdx) => (
                                   <td key={sIdx} className="p-5 border-l border-slate-800/20 align-top"><MarkdownRenderer content={state} /></td>
                                 ))}
                              </tr>
                           ))}
                        </tbody>
                     </table>
                   </div>
                </div>
             </div>

             <div className={`grid gap-6 items-start ${compareData.taxa.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
                <div className={compareData.taxa.length === 3 ? 'lg:col-span-3' : 'lg:col-span-2'}>
                   <h3 className="text-2xl font-bold font-display text-white mb-6 border-b border-slate-800/50 pb-4 print:text-black">Detailed Side-by-Side Profiles</h3>
                </div>
                {[
                   { title: 'Overview', icon: <StarIcon className="w-5 h-5"/> },
                   { title: 'Ecology', icon: <GlobeIcon className="w-5 h-5"/> },
                   { title: 'Etymology', icon: <BookOpenIcon className="w-5 h-5"/> },
                   { title: 'Historical Context', icon: <ScrollIcon className="w-5 h-5"/> }
                ].map((section) => (
                   <TaxonCard key={section.title} title={section.title} icon={section.icon} className={compareData.taxa.length === 3 ? 'lg:col-span-3' : 'lg:col-span-2'}>
                      <div className={`grid gap-6 ${compareData.taxa.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
                         {compareData.taxa.map((taxon, idx) => (
                           <div key={idx} className="border-l-2 border-slate-800/50 pl-5 print:border-gray-300">
                             <h4 className="font-bold font-display text-white mb-3 italic text-lg print:text-black">{taxon.scientificName}</h4>
                             <MarkdownRenderer content={
                               section.title === 'Overview' ? taxon.quickRecap : 
                               section.title === 'Ecology' ? taxon.ecology : 
                               section.title === 'Etymology' ? taxon.etymology : taxon.history
                             } />
                           </div>
                         ))}
                      </div>
                   </TaxonCard>
                ))}
             </div>
             {compareData.sources && <SourceList sources={compareData.sources} />}
          </div>
        )}
      </main>

      {/* Sticky Source Panel */}
      {(singleData?.sources?.length || compareData?.sources?.length) && (
        <SourceList sources={singleData?.sources || compareData?.sources} sticky />
      )}

      <footer className="relative mt-24 max-w-6xl mx-auto px-4 text-center py-10 border-t border-slate-800/30 print:hidden">
        <p className="text-slate-500 text-base md:text-sm mb-3">Developed by Daniel Cahen - Powered by Gemini 3.5 Flash with Search Grounding</p>
        <p className="text-slate-600 text-sm md:text-xs">AI-generated content. For critical research, verify with authoritative literature.</p>
      </footer>

      {showBackToTop && (
        <button 
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-24 right-8 p-4 bg-cyan-600/80 backdrop-blur text-white rounded-full shadow-2xl hover:bg-cyan-500 transition-all z-50 print:hidden"
          title="Back to Top"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
        </button>
      )}
    </div>
  );
};

export default App;