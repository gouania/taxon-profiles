import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { analyzeTaxon, compareTaxa } from './services/geminiService';
import { TaxonData, ComparisonData, Mode, Source } from './types';
import {
  SearchIcon,
  StarIcon,
  HandLensIcon,
  GlobeIcon,
  BookOpenIcon,
  ScrollIcon,
  AlertTriangleIcon,
  MapPinIcon,
  XIcon,
  PrinterIcon,
} from './components/Icons';
import { TaxonCard } from './components/TaxonCard';
import { parseSafeHttpUrl, renderSafeMarkdown, sanitizeSources } from './utils/sanitize';
import {
  ClassifiedError,
  classifyApiError,
  formatGeneratedTime,
  getCachedResult,
  normalizeInputList,
  setCachedResult,
  validateComparisonData,
  validateTaxonData,
} from './utils/taxonUtils';

const EXAMPLES = [
  'Amanita muscaria',
  'Quercus robur',
  'Canis lupus',
  'Monarch Butterfly',
  'Ginkgo biloba',
  'Octopus vulgaris',
  'Eupatorieae',
  'Ornithorhynchus anatinus',
  'Apis mellifera',
  'Corvus corax',
  'Sphenodon punctatus',
  'Axolotl',
  'Coelacanth',
  'Tardigrada',
  'Escherichia coli',
  'Saccharomyces cerevisiae',
  'Welwitschia mirabilis',
  'Drosophila melanogaster',
  'Tyrannosaurus rex',
  'Homo neanderthalensis',
];

const INITIAL_EXAMPLE_COUNT = 6;
const SLOW_RESPONSE_DELAY_MS = 8000;

interface ActiveResult {
  mode: Mode;
  queryTaxa: string[];
  queryLocality?: string;
  generatedAt: string;
  fromCache: boolean;
  singleData?: TaxonData;
  compareData?: ComparisonData;
}

interface SearchAttempt {
  mode: Mode;
  inputs: string[];
  locality: string;
}

interface ValidationErrorState {
  message: string;
  fieldIndex: number;
}

const getScrollBehavior = (): ScrollBehavior => {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return 'auto';
  }
  return 'smooth';
};

const MarkdownRenderer: React.FC<{ content: string; className?: string }> = ({ content, className = '' }) => {
  const safeHtml = useMemo(() => renderSafeMarkdown(content), [content]);
  if (!safeHtml) return null;

  return (
    <div
      className={`prose-custom text-slate-300 ${className}`}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
};

const SkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`rounded-xl border border-slate-800/50 bg-slate-900/50 p-6 ${className}`} aria-hidden="true">
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

const SourceList: React.FC<{ sources?: Source[] }> = ({ sources }) => {
  const safeSources = useMemo(() => sanitizeSources(sources), [sources]);

  if (safeSources.length === 0) return null;

  return (
    <section aria-labelledby="search-sources-heading" className="mt-10 pt-8 border-t border-slate-800/50">
      <h4
        id="search-sources-heading"
        className="text-sm md:text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-2"
      >
        <span aria-hidden="true" className="w-1 h-4 bg-cyan-500/50 rounded-full inline-block"></span>
        Search sources
      </h4>
      <p className="text-xs text-slate-500 mb-4">
        Web search results returned during generation; verify critical claims with primary literature.
      </p>

      <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
        {safeSources.map((source) => {
          const safeUrl = parseSafeHttpUrl(source.uri);
          if (!safeUrl) return null;
          const displayTitle = source.title || safeUrl.hostname;

          return (
            <li key={safeUrl.href} className="max-w-full">
              <a
                href={safeUrl.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-2 text-sm md:text-xs text-cyan-400 hover:text-cyan-300 bg-slate-900/60 px-3 py-2 rounded-lg border border-slate-800/60 hover:border-cyan-700/60 transition-colors max-w-full sm:max-w-[340px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                title={`${displayTitle} (${safeUrl.href})`}
              >
                <span aria-hidden="true" className="opacity-75 group-hover:opacity-100 transition-opacity shrink-0">
                  🔗
                </span>
                <span className="truncate">{displayTitle}</span>
                <span className="hidden print:inline text-xs font-normal break-all">
                  ({safeUrl.href})
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

const App: React.FC = () => {
  const [mode, setMode] = useState<Mode>(Mode.SINGLE);
  const [inputs, setInputs] = useState<string[]>(['']);
  const [locality, setLocality] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadingQuery, setLoadingQuery] = useState<SearchAttempt | null>(null);
  const [slowHint, setSlowHint] = useState(false);
  const [validationError, setValidationError] = useState<ValidationErrorState | null>(null);
  const [apiError, setApiError] = useState<ClassifiedError | null>(null);
  const [lastFailedAttempt, setLastFailedAttempt] = useState<SearchAttempt | null>(null);
  const [activeResult, setActiveResult] = useState<ActiveResult | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showMoreExamples, setShowMoreExamples] = useState(false);
  const [pendingExample, setPendingExample] = useState<string | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');
  const [copyFeedback, setCopyFeedback] = useState<{ status: 'success' | 'error'; label: string } | null>(null);
  const [tableCopyStatus, setTableCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [inAiStudio] = useState<boolean>(() => typeof window !== 'undefined' && Boolean(window.aistudio));
  const [hasSelectedKey, setHasSelectedKey] = useState<boolean>(true);
  const [keyStatusNote, setKeyStatusNote] = useState<string | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const pendingFocusIndexRef = useRef<number | null>(null);
  const activeRequestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const savedCompareInputsRef = useRef<string[]>(['', '']);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const tableCopyTimerRef = useRef<number | null>(null);

  // Check AI Studio key state (only when running inside AI Studio) and register scroll & "/" shortcut
  useEffect(() => {
    let mounted = true;

    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        try {
          const hasKey = await window.aistudio.hasSelectedApiKey();
          if (mounted) setHasSelectedKey(Boolean(hasKey));
        } catch {
          // Do not assume key state if host check fails
        }
      }
    };
    checkKey();

    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 500);
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          Boolean(target.closest('[contenteditable="true"]')))
      ) {
        return;
      }

      e.preventDefault();
      inputRefs.current[0]?.focus();
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('keydown', handleKeydown);
    return () => {
      mounted = false;
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('keydown', handleKeydown);
      if (copyFeedbackTimerRef.current !== null) window.clearTimeout(copyFeedbackTimerRef.current);
      if (tableCopyTimerRef.current !== null) window.clearTimeout(tableCopyTimerRef.current);
    };
  }, []);

  // Manage delayed slow-response hint cleanly
  useEffect(() => {
    if (!loading) {
      setSlowHint(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setSlowHint(true);
    }, SLOW_RESPONSE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [loading]);

  // Apply deferred focus after adding/removing comparison fields
  useEffect(() => {
    if (pendingFocusIndexRef.current !== null) {
      const idx = pendingFocusIndexRef.current;
      pendingFocusIndexRef.current = null;
      inputRefs.current[idx]?.focus();
    }
  }, [inputs.length]);

  const scrollToResults = useCallback(() => {
    window.requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({
        behavior: getScrollBehavior(),
        block: 'start',
      });
    });
  }, []);

  const announce = useCallback((message: string) => {
    setLiveAnnouncement('');
    window.requestAnimationFrame(() => {
      setLiveAnnouncement(message);
    });
  }, []);

  const copyToClipboard = useCallback(
    async (text: string, label = 'content'): Promise<boolean> => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }

      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        setCopyFeedback({ status: 'error', label });
        announce(`Could not copy ${label}. Clipboard access is unavailable.`);
        copyFeedbackTimerRef.current = window.setTimeout(() => setCopyFeedback(null), 3500);
        return false;
      }

      try {
        await navigator.clipboard.writeText(text);
        setCopyFeedback({ status: 'success', label });
        announce(`Copied ${label} to clipboard.`);
        copyFeedbackTimerRef.current = window.setTimeout(() => setCopyFeedback(null), 2500);
        return true;
      } catch {
        setCopyFeedback({ status: 'error', label });
        announce(`Could not copy ${label} to clipboard.`);
        copyFeedbackTimerRef.current = window.setTimeout(() => setCopyFeedback(null), 3500);
        return false;
      }
    },
    [announce]
  );

  const executeSearch = useCallback(
    async ({
      targetMode,
      rawInputs,
      rawLocality,
      bypassCache = false,
    }: {
      targetMode: Mode;
      rawInputs: string[];
      rawLocality: string;
      bypassCache?: boolean;
    }) => {
      if (inFlightRef.current) return;

      const trimmedEntries = rawInputs
        .map((value, index) => ({ value: value.trim(), index }))
        .filter((entry) => entry.value.length > 0);

      if (targetMode === Mode.SINGLE) {
        if (trimmedEntries.length === 0) {
          setValidationError({
            message: 'Please enter a taxon name to analyze.',
            fieldIndex: 0,
          });
          setApiError(null);
          announce('Validation error: please enter a taxon name.');
          inputRefs.current[0]?.focus();
          return;
        }
      } else {
        if (trimmedEntries.length < 2) {
          const firstBlankIndex = rawInputs.findIndex((v) => v.trim().length === 0);
          const focusIndex = firstBlankIndex >= 0 ? firstBlankIndex : 0;
          setValidationError({
            message: 'Please enter at least two taxa to compare.',
            fieldIndex: focusIndex,
          });
          setApiError(null);
          announce('Validation error: please enter at least two taxa to compare.');
          inputRefs.current[focusIndex]?.focus();
          return;
        }

        const seen = new Set<string>();
        let duplicateIndex = -1;
        for (const entry of trimmedEntries) {
          const lowered = entry.value.toLowerCase().replace(/\s+/g, ' ');
          if (seen.has(lowered)) {
            duplicateIndex = entry.index;
            break;
          }
          seen.add(lowered);
        }

        if (duplicateIndex !== -1) {
          const distinctCount = new Set(
            trimmedEntries.map((e) => e.value.toLowerCase().replace(/\s+/g, ' '))
          ).size;
          const message =
            distinctCount < 2
              ? 'Please enter at least two distinct taxon names to compare.'
              : 'Duplicate taxon detected. Enter distinct taxon names to compare.';
          setValidationError({ message, fieldIndex: duplicateIndex });
          setApiError(null);
          announce(`Validation error: ${message}`);
          inputRefs.current[duplicateIndex]?.focus();
          return;
        }
      }

      const validInputs =
        targetMode === Mode.SINGLE
          ? [trimmedEntries[0].value]
          : trimmedEntries.map((e) => e.value);
      const validLocality = rawLocality.trim();

      setValidationError(null);
      setApiError(null);
      setPendingExample(null);
      setKeyStatusNote(null);

      // Check order-preserving cache unless explicitly bypassing
      if (!bypassCache) {
        if (targetMode === Mode.SINGLE) {
          const cached = getCachedResult(Mode.SINGLE, validInputs, validLocality, validateTaxonData);
          if (cached) {
            setActiveResult({
              mode: Mode.SINGLE,
              queryTaxa: validInputs,
              queryLocality: validLocality || undefined,
              generatedAt: cached.generatedAt,
              fromCache: true,
              singleData: cached.data,
            });
            setLastFailedAttempt(null);
            announce(`Loaded saved profile for ${cached.data.scientificName}.`);
            scrollToResults();
            return;
          }
        } else {
          const cached = getCachedResult(
            Mode.COMPARE,
            validInputs,
            validLocality,
            (raw) => validateComparisonData(raw, validInputs.length)
          );
          if (cached) {
            setActiveResult({
              mode: Mode.COMPARE,
              queryTaxa: validInputs,
              queryLocality: validLocality || undefined,
              generatedAt: cached.generatedAt,
              fromCache: true,
              compareData: cached.data,
            });
            setLastFailedAttempt(null);
            announce(`Loaded saved comparison for ${validInputs.join(', ')}.`);
            scrollToResults();
            return;
          }
        }
      }

      const requestId = ++activeRequestIdRef.current;
      inFlightRef.current = true;
      setLoading(true);
      setLoadingQuery({
        mode: targetMode,
        inputs: validInputs,
        locality: validLocality,
      });
      setLastFailedAttempt(null);
      announce(targetMode === Mode.COMPARE ? 'Comparing taxa…' : 'Researching taxon…');

      try {
        if (targetMode === Mode.SINGLE) {
          const data = await analyzeTaxon(validInputs[0], validLocality || undefined);
          if (activeRequestIdRef.current !== requestId) return;

          const envelope = setCachedResult(Mode.SINGLE, validInputs, validLocality, data);
          setActiveResult({
            mode: Mode.SINGLE,
            queryTaxa: validInputs,
            queryLocality: validLocality || undefined,
            generatedAt: envelope.generatedAt,
            fromCache: false,
            singleData: data,
          });
          setHasSelectedKey(true);
          announce(`Profile ready for ${data.scientificName}.`);
          scrollToResults();
        } else {
          const data = await compareTaxa(validInputs, validLocality || undefined);
          if (activeRequestIdRef.current !== requestId) return;

          const envelope = setCachedResult(Mode.COMPARE, validInputs, validLocality, data);
          setActiveResult({
            mode: Mode.COMPARE,
            queryTaxa: validInputs,
            queryLocality: validLocality || undefined,
            generatedAt: envelope.generatedAt,
            fromCache: false,
            compareData: data,
          });
          setHasSelectedKey(true);
          announce(`Comparison ready for ${data.taxa.map((t) => t.scientificName).join(', ')}.`);
          scrollToResults();
        }
      } catch (err: unknown) {
        if (activeRequestIdRef.current !== requestId) return;

        const classified = classifyApiError(err, inAiStudio);
        setApiError(classified);
        setLastFailedAttempt({
          mode: targetMode,
          inputs: validInputs,
          locality: validLocality,
        });

        if (
          inAiStudio &&
          (classified.category === 'missing_auth' || classified.category === 'permission')
        ) {
          if (window.aistudio?.hasSelectedApiKey) {
            try {
              const hasKey = await window.aistudio.hasSelectedApiKey();
              if (activeRequestIdRef.current === requestId) {
                setHasSelectedKey(Boolean(hasKey));
              }
            } catch {
              setHasSelectedKey(false);
            }
          } else {
            setHasSelectedKey(false);
          }
        }

        announce(`Error: ${classified.title}. ${classified.message}`);
      } finally {
        if (activeRequestIdRef.current === requestId) {
          inFlightRef.current = false;
          setLoading(false);
          setLoadingQuery(null);
        }
      }
    },
    [announce, inAiStudio, scrollToResults]
  );

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void executeSearch({
      targetMode: mode,
      rawInputs: inputs,
      rawLocality: locality,
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) {
      e.preventDefault();
    }
  };

  const runSingleTaxonSearch = useCallback(
    (taxonName: string) => {
      if (inFlightRef.current) return;
      if (mode === Mode.COMPARE) {
        savedCompareInputsRef.current = [...inputs];
      }
      const nextInputs = [taxonName];
      setMode(Mode.SINGLE);
      setInputs(nextInputs);
      setPendingExample(null);
      void executeSearch({
        targetMode: Mode.SINGLE,
        rawInputs: nextInputs,
        rawLocality: locality,
      });
    },
    [executeSearch, inputs, locality, mode]
  );

  const handleExampleClick = (example: string) => {
    if (inFlightRef.current) return;

    const hasComparisonDraft =
      mode === Mode.COMPARE &&
      (inputs.some((v) => v.trim().length > 0) || activeResult?.mode === Mode.COMPARE);

    if (hasComparisonDraft) {
      setPendingExample(example);
      return;
    }

    runSingleTaxonSearch(example);
  };

  const updateInput = (index: number, value: string) => {
    const nextInputs = [...inputs];
    nextInputs[index] = value;
    setInputs(nextInputs);
    if (validationError) setValidationError(null);
    if (apiError) setApiError(null);
  };

  const addInput = () => {
    if (loading || inputs.length >= 3) return;
    const newIndex = inputs.length;
    pendingFocusIndexRef.current = newIndex;
    setInputs([...inputs, '']);
  };

  const removeInput = (index: number) => {
    if (loading || inputs.length <= 2) return;
    const nextInputs = inputs.filter((_, i) => i !== index);
    pendingFocusIndexRef.current = Math.max(0, index - 1);
    setInputs(nextInputs);
    if (validationError) setValidationError(null);
  };

  const switchMode = (nextMode: Mode) => {
    if (loading || nextMode === mode) return;

    // Invalidate any stale async callback id on mode transitions
    activeRequestIdRef.current++;
    inFlightRef.current = false;
    setValidationError(null);
    setApiError(null);
    setPendingExample(null);

    if (nextMode === Mode.COMPARE) {
      const saved = savedCompareInputsRef.current;
      const firstValue = inputs[0] ?? '';
      const secondValue = saved[1] ?? '';
      const merged =
        saved.length >= 3
          ? [firstValue || saved[0] || '', secondValue, saved[2]]
          : [firstValue || saved[0] || '', secondValue];
      setInputs(merged);
      setMode(Mode.COMPARE);
    } else {
      savedCompareInputsRef.current = [...inputs];
      const firstNonEmpty = inputs.find((v) => v.trim().length > 0) ?? '';
      setInputs([inputs[0] || firstNonEmpty || '']);
      setMode(Mode.SINGLE);
    }
  };

  const handleRefresh = () => {
    if (!activeResult || loading) return;
    const targetInputs = activeResult.queryTaxa;
    const targetLocality = activeResult.queryLocality ?? '';
    setMode(activeResult.mode);
    setInputs(activeResult.mode === Mode.COMPARE ? [...targetInputs] : [targetInputs[0] ?? '']);
    setLocality(targetLocality);
    void executeSearch({
      targetMode: activeResult.mode,
      rawInputs: targetInputs,
      rawLocality: targetLocality,
      bypassCache: true,
    });
  };

  const handleRetry = () => {
    if (!lastFailedAttempt || loading) return;
    void executeSearch({
      targetMode: lastFailedAttempt.mode,
      rawInputs: lastFailedAttempt.inputs,
      rawLocality: lastFailedAttempt.locality,
      bypassCache: true,
    });
  };

  const handleOpenSelectKey = async () => {
    if (!window.aistudio?.openSelectKey) {
      setKeyStatusNote('Key selection is only available inside Google AI Studio.');
      return;
    }

    try {
      await window.aistudio.openSelectKey();
      if (window.aistudio.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasSelectedKey(Boolean(hasKey));
        setKeyStatusNote(
          hasKey
            ? 'Key selection updated. Click Retry to verify with a request.'
            : 'No key was confirmed. Select a valid key and retry.'
        );
      } else {
        setKeyStatusNote('Key selector closed. Click Retry to test your connection.');
      }
    } catch {
      setKeyStatusNote('Unable to open the API key selector. Check browser pop-up or AI Studio permissions.');
    }
  };

  const handleCopyComparisonTable = async (data: ComparisonData) => {
    if (tableCopyTimerRef.current !== null) {
      window.clearTimeout(tableCopyTimerRef.current);
    }
    const header = ['Character', ...data.taxa.map((t) => t.scientificName)].join('\t');
    const rows = data.keyDifferences.map((d) => [d.feature, ...d.states].join('\t'));
    const ok = await copyToClipboard([header, ...rows].join('\n'), 'comparison table');
    setTableCopyStatus(ok ? 'copied' : 'failed');
    tableCopyTimerRef.current = window.setTimeout(() => setTableCopyStatus('idle'), 2200);
  };

  const handlePrint = () => {
    if (!activeResult) return;
    window.print();
  };

  // Detect whether draft inputs currently differ from the displayed result
  const draftDiffersFromResult = useMemo(() => {
    if (!activeResult) return false;
    if (activeResult.mode !== mode) return true;

    const draftTaxa = normalizeInputList(inputs).map((t) => t.toLowerCase());
    const resultTaxa = activeResult.queryTaxa.map((t) => t.trim().toLowerCase());
    if (draftTaxa.length !== resultTaxa.length) return true;
    for (let i = 0; i < draftTaxa.length; i++) {
      if (draftTaxa[i] !== resultTaxa[i]) return true;
    }

    const draftLoc = locality.trim().toLowerCase();
    const resultLoc = (activeResult.queryLocality ?? '').trim().toLowerCase();
    return draftLoc !== resultLoc;
  }, [activeResult, inputs, locality, mode]);

  const visibleExamples = showMoreExamples ? EXAMPLES : EXAMPLES.slice(0, INITIAL_EXAMPLE_COUNT);
  const singleData = activeResult?.mode === Mode.SINGLE ? activeResult.singleData : undefined;
  const compareData = activeResult?.mode === Mode.COMPARE ? activeResult.compareData : undefined;
  const hasMeaningfulHazards =
    Boolean(singleData?.hazards) &&
    singleData!.hazards!.trim().length > 0 &&
    singleData!.hazards!.trim().toUpperCase() !== 'N/A';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-200 selection:bg-cyan-500/30 pb-[max(5rem,env(safe-area-inset-bottom))] overflow-x-hidden print:bg-white print:text-black print:pb-0">
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-900/5 via-transparent to-transparent pointer-events-none print:hidden"
      ></div>

      {/* Screen-reader polite announcements for loading, results, and copy feedback */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>

      <header className="relative pt-8 pb-10 sm:pt-14 sm:pb-12 md:pt-20 md:pb-14 px-4 text-center max-w-5xl mx-auto print:pt-0 print:pb-4">
        <div className="flex justify-center items-center gap-3 mb-2">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold font-display text-white tracking-tight print:text-black print:text-3xl">
            Taxon{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400">
              Profiles
            </span>
          </h1>
          {inAiStudio && !hasSelectedKey && (
            <button
              type="button"
              onClick={handleOpenSelectKey}
              aria-label="Select Gemini API key in AI Studio"
              className="text-amber-400 hover:text-amber-300 transition-colors p-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 print:hidden"
              title="Select API Key"
            >
              <AlertTriangleIcon className="w-6 h-6" aria-hidden="true" />
            </button>
          )}
        </div>

        <p className="text-base sm:text-lg md:text-xl text-slate-400 mb-8 sm:mb-10 max-w-3xl mx-auto leading-relaxed font-light print:text-black print:text-sm print:mb-2">
          A biological identification assistant focusing on diagnostic morphological characters and providing other essential information.
        </p>

        <div className="relative bg-slate-900/40 backdrop-blur-xl border border-slate-800/60 p-3 sm:p-4 rounded-3xl shadow-2xl max-w-3xl mx-auto text-left print:hidden">
          {/* Obvious Mode Selector */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-3 mb-2 border-b border-slate-800/40">
            <div
              role="group"
              aria-label="Search mode"
              className="inline-flex p-1 rounded-xl bg-slate-950/70 border border-slate-800/70"
            >
              <button
                type="button"
                onClick={() => switchMode(Mode.SINGLE)}
                disabled={loading}
                aria-pressed={mode === Mode.SINGLE}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50 ${
                  mode === Mode.SINGLE
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Single taxon
              </button>
              <button
                type="button"
                onClick={() => switchMode(Mode.COMPARE)}
                disabled={loading}
                aria-pressed={mode === Mode.COMPARE}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50 ${
                  mode === Mode.COMPARE
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Compare taxa
              </button>
            </div>

            {activeResult && !loading && (
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white px-3 py-2 rounded-xl border border-slate-800/70 hover:border-slate-700 bg-slate-950/40 transition-colors min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                <PrinterIcon className="w-4 h-4" aria-hidden="true" />
                <span>Print / PDF</span>
              </button>
            )}
          </div>

          <form onSubmit={handleFormSubmit} noValidate className="flex flex-col gap-3 p-1 sm:p-2">
            {inputs.map((input, index) => {
              const inputId = `taxon-input-${index}`;
              const hasFieldError = validationError?.fieldIndex === index;
              const labelText = mode === Mode.COMPARE ? `Taxon ${index + 1}` : 'Taxon name';

              return (
                <div key={index} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor={inputId}
                      className="block text-xs font-medium text-slate-400 tracking-wide"
                    >
                      {labelText}
                    </label>
                    {index === 0 && (
                      <span className="hidden sm:inline text-[11px] text-slate-500">
                        Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 font-mono">/</kbd> to focus
                      </span>
                    )}
                  </div>
                  <div className="relative flex items-center gap-2 sm:gap-3">
                    <div className="relative flex-grow group min-w-0">
                      <div
                        aria-hidden="true"
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 flex items-center gap-1 group-focus-within:text-cyan-400 transition-colors pointer-events-none"
                      >
                        <SearchIcon className="w-5 h-5" />
                      </div>
                      <input
                        id={inputId}
                        ref={(el) => {
                          inputRefs.current[index] = el;
                        }}
                        type="text"
                        value={input}
                        onChange={(e) => updateInput(index, e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        aria-invalid={hasFieldError ? 'true' : undefined}
                        aria-describedby={hasFieldError ? 'search-validation-error' : undefined}
                        placeholder={
                          mode === Mode.COMPARE
                            ? `Enter taxon ${index + 1} (e.g., ${index === 0 ? 'Quercus robur' : index === 1 ? 'Quercus petraea' : 'Quercus rubra'})`
                            : 'Enter scientific or common name (e.g., Amanita muscaria)...'
                        }
                        autoComplete="off"
                        className={`w-full bg-slate-950/60 border rounded-2xl py-3.5 pl-11 pr-11 text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-colors ${
                          hasFieldError
                            ? 'border-red-500/80 focus:ring-red-500/40'
                            : 'border-slate-800/70 focus:border-cyan-500/60 focus:ring-cyan-500/30'
                        }`}
                      />
                      {input && (
                        <button
                          type="button"
                          onClick={() => {
                            updateInput(index, '');
                            inputRefs.current[index]?.focus();
                          }}
                          aria-label={`Clear ${labelText}`}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                        >
                          <XIcon className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    {mode === Mode.COMPARE && index > 1 && (
                      <button
                        type="button"
                        onClick={() => removeInput(index)}
                        disabled={loading}
                        aria-label={`Remove Taxon ${index + 1}`}
                        className="p-3.5 bg-slate-950/60 hover:bg-red-950/30 text-slate-400 hover:text-red-300 rounded-2xl border border-slate-800/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50 shrink-0"
                      >
                        <XIcon className="w-5 h-5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {validationError && (
              <p
                id="search-validation-error"
                role="alert"
                className="text-sm text-red-300 bg-red-950/30 border border-red-500/30 rounded-xl px-3.5 py-2"
              >
                {validationError.message}
              </p>
            )}

            {mode === Mode.COMPARE && inputs.length < 3 && (
              <button
                type="button"
                onClick={addInput}
                disabled={loading}
                className="py-2.5 px-4 rounded-2xl border border-dashed border-slate-700/70 text-slate-400 hover:text-cyan-300 hover:border-cyan-700/60 transition-colors text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
              >
                + Add Taxon (max 3)
              </button>
            )}

            <div className="space-y-1 pt-1">
              <label htmlFor="locality-input" className="block text-xs font-medium text-slate-400 tracking-wide">
                Locality (optional)
              </label>
              <div className="relative group">
                <div
                  aria-hidden="true"
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 flex items-center gap-1 group-focus-within:text-cyan-400 transition-colors pointer-events-none"
                >
                  <MapPinIcon className="w-5 h-5" />
                </div>
                <input
                  id="locality-input"
                  type="text"
                  value={locality}
                  onChange={(e) => setLocality(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Geographic context (e.g., California, UK, Pacific Northwest)"
                  autoComplete="off"
                  className="w-full bg-slate-950/40 border border-slate-800/50 rounded-2xl py-3 pl-11 pr-11 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/30 transition-colors"
                />
                {locality && (
                  <button
                    type="button"
                    onClick={() => setLocality('')}
                    aria-label="Clear locality"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  >
                    <XIcon className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="relative mt-2 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-emerald-600 text-white font-semibold py-3.5 px-8 rounded-2xl transition-colors shadow-lg disabled:opacity-60 disabled:cursor-not-allowed w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-3">
                  <span
                    aria-hidden="true"
                    className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"
                  ></span>
                  <span>{mode === Mode.COMPARE ? 'Comparing taxa…' : 'Researching taxon…'}</span>
                </span>
              ) : mode === Mode.COMPARE ? (
                'Compare Taxa'
              ) : (
                'Analyze Taxon'
              )}
            </button>
          </form>
        </div>

        {/* Representative Quick Examples with Disclosure */}
        {!activeResult && !loading && (
          <section aria-labelledby="examples-heading" className="mt-8 max-w-3xl mx-auto print:hidden">
            <p id="examples-heading" className="text-xs text-slate-400 uppercase tracking-widest mb-3">
              Example searches (select to analyze)
            </p>

            {pendingExample && (
              <div
                role="alertdialog"
                aria-labelledby="confirm-example-text"
                className="mb-4 p-4 rounded-2xl bg-slate-900/90 border border-cyan-500/40 text-sm text-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-left"
              >
                <p id="confirm-example-text">
                  Switch to Single taxon mode and analyze <strong className="italic text-white">{pendingExample}</strong>? Your comparison inputs will be saved in case you switch back.
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => runSingleTaxonSearch(pendingExample)}
                    className="px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    Analyze example
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingExample(null)}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-2.5">
              {visibleExamples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => handleExampleClick(ex)}
                  disabled={loading}
                  className="px-4 py-2 bg-slate-900/40 hover:bg-slate-800/70 border border-slate-800/60 hover:border-cyan-700/50 rounded-full text-sm text-slate-300 hover:text-white transition-colors min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
                >
                  {ex}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowMoreExamples((prev) => !prev)}
                aria-expanded={showMoreExamples}
                className="px-4 py-2 bg-slate-950/60 hover:bg-slate-800/60 border border-dashed border-slate-700/70 rounded-full text-sm text-cyan-400 hover:text-cyan-300 transition-colors min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                {showMoreExamples ? 'Fewer examples' : `More examples (+${EXAMPLES.length - INITIAL_EXAMPLE_COUNT})`}
              </button>
            </div>
          </section>
        )}
      </header>

      <main ref={resultsRef} className="relative max-w-7xl mx-auto px-4 print:px-0">
        {/* Non-blocking copy error feedback banner */}
        {copyFeedback?.status === 'error' && (
          <div
            role="status"
            className="max-w-4xl mx-auto mb-6 p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-sm flex items-center justify-between gap-3 print:hidden"
          >
            <span>Could not copy {copyFeedback.label} to clipboard. Check browser clipboard permissions.</span>
            <button
              type="button"
              onClick={() => setCopyFeedback(null)}
              aria-label="Dismiss clipboard error"
              className="p-1.5 text-amber-300 hover:text-white rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <XIcon className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* API Error Panel */}
        {apiError && !loading && (
          <div
            role="alert"
            className="p-6 sm:p-8 bg-red-950/30 border border-red-500/30 rounded-3xl text-red-100 text-center mb-12 max-w-3xl mx-auto print:hidden"
          >
            <AlertTriangleIcon className="w-10 h-10 mx-auto mb-3 text-red-400" aria-hidden="true" />
            <h2 className="text-xl font-bold font-display text-white mb-2">{apiError.title}</h2>
            <p className="text-sm sm:text-base text-red-200 mb-2">{apiError.message}</p>
            {apiError.guidance && <p className="text-sm text-slate-300 mb-5">{apiError.guidance}</p>}
            {keyStatusNote && <p className="text-xs text-amber-300 mb-4">{keyStatusNote}</p>}

            <div className="flex flex-wrap justify-center items-center gap-3">
              {apiError.retryable && lastFailedAttempt && (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                >
                  Retry
                </button>
              )}

              {apiError.canOpenKeySelector && inAiStudio && (
                <button
                  type="button"
                  onClick={handleOpenSelectKey}
                  className="bg-amber-600 hover:bg-amber-500 text-white font-semibold py-2.5 px-6 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                >
                  Select API Key
                </button>
              )}
            </div>

            {apiError.technicalDetails && (
              <details className="mt-5 text-left bg-slate-950/60 border border-slate-800/70 rounded-xl p-3 text-xs text-slate-400">
                <summary className="cursor-pointer font-medium text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded">
                  Technical details
                </summary>
                <p className="mt-2 font-mono break-words text-slate-400">{apiError.technicalDetails}</p>
              </details>
            )}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="max-w-6xl mx-auto space-y-6" aria-busy="true">
            <div className="text-center mb-6 space-y-2">
              <p className="text-base font-medium text-cyan-300">
                {loadingQuery?.mode === Mode.COMPARE ? 'Comparing taxa…' : 'Researching taxon…'}
              </p>
              {loadingQuery && (
                <p className="text-sm text-slate-400">
                  {loadingQuery.inputs.join(' vs. ')}
                  {loadingQuery.locality ? ` · ${loadingQuery.locality}` : ''}
                </p>
              )}
              {slowHint && (
                <p className="text-xs text-slate-400">
                  Still working — search-grounded profiles can take a few extra seconds.
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8">
                <SkeletonCard className="h-64" />
              </div>
              <div className="lg:col-span-4 space-y-6">
                <SkeletonCard className="h-40" />
                <SkeletonCard className="h-40" />
              </div>
            </div>
          </div>
        )}

        {/* Active Result Metadata & Print Header */}
        {activeResult && !loading && (
          <div className="max-w-6xl mx-auto">
            {/* Print-only summary header */}
            <div className="hidden print:block border-b-2 border-gray-800 pb-3 mb-6">
              <h2 className="text-2xl font-bold font-display">
                {activeResult.mode === Mode.COMPARE ? 'Taxon Comparison Report' : 'Taxon Profile Report'}
              </h2>
              <p className="text-sm mt-1">
                Query: <strong>{activeResult.queryTaxa.join(' vs. ')}</strong>
                {activeResult.queryLocality ? ` · Locality: ${activeResult.queryLocality}` : ''}
              </p>
              <p className="text-xs mt-1">
                Profile generated: {formatGeneratedTime(activeResult.generatedAt)}
              </p>
            </div>

            {/* Screen result context & cache refresh bar */}
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-slate-900/50 border border-slate-800/60 text-xs sm:text-sm text-slate-400 print:hidden">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                <span className="text-slate-300 font-medium break-words">
                  Showing {activeResult.mode === Mode.COMPARE ? 'comparison' : 'profile'} for{' '}
                  <span className="text-white">{activeResult.queryTaxa.join(' vs. ')}</span>
                  {activeResult.queryLocality ? ` (${activeResult.queryLocality})` : ''}
                </span>
                <span aria-hidden="true" className="text-slate-600 hidden sm:inline">•</span>
                <span>
                  {activeResult.fromCache ? 'Saved result · ' : ''}generated{' '}
                  {formatGeneratedTime(activeResult.generatedAt)}
                </span>
                {draftDiffersFromResult && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-950/50 border border-amber-700/40 text-amber-300 text-xs">
                    Draft inputs edited — submit to update
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading}
                className="self-start sm:self-auto shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-cyan-300 hover:text-cyan-200 border border-slate-700/70 text-xs font-medium transition-colors min-h-[34px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50"
              >
                <svg
                  aria-hidden="true"
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span>Refresh</span>
              </button>
            </div>
          </div>
        )}

        {/* Single Taxon Results */}
        {singleData && !loading && (
          <div className="space-y-8 max-w-6xl mx-auto">
            <div className="text-center mb-10 relative print:mb-6">
              <h2 className="text-3xl sm:text-5xl md:text-6xl font-bold font-display text-white mb-3 tracking-tight print:text-black print:text-3xl flex items-baseline justify-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => void copyToClipboard(singleData.scientificName, 'scientific name')}
                  aria-label={`Copy scientific name ${singleData.scientificName}`}
                  title="Copy scientific name"
                  className="italic font-display hover:text-cyan-300 transition-colors rounded-lg px-2 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 break-words max-w-full"
                >
                  {singleData.scientificName}
                </button>
                {singleData.author && (
                  <span className="text-lg sm:text-xl md:text-2xl text-slate-400 font-normal not-italic print:text-black">
                    {singleData.author}
                  </span>
                )}
              </h2>

              <p className="text-xl sm:text-2xl text-cyan-400 font-medium mb-2 print:text-black break-words">
                {singleData.commonName}
                {singleData.localityContext && (
                  <span className="ml-2 text-slate-400 text-base sm:text-lg font-normal">
                    ({singleData.localityContext})
                  </span>
                )}
              </p>

              {singleData.synonyms && singleData.synonyms.length > 0 && (
                <p className="text-slate-400 text-sm italic mb-2 print:text-black break-words">
                  Synonyms: {singleData.synonyms.join(', ')}
                </p>
              )}

              <div className="flex justify-center flex-wrap items-center gap-3 mb-5">
                {singleData.includedTaxaCount && (
                  <p className="text-slate-400 text-sm italic print:text-black">
                    Includes:{' '}
                    <span className="text-slate-300 font-medium not-italic">
                      {singleData.includedTaxaCount.replace(/\*/g, '')}
                    </span>
                    {singleData.localIncludedTaxaCount && singleData.localIncludedTaxaCount !== 'N/A' && (
                      <>
                        <span aria-hidden="true" className="mx-2 text-slate-600">
                          •
                        </span>
                        <span className="text-cyan-400 font-medium not-italic">
                          Local to {singleData.localityContext}:{' '}
                          {singleData.localIncludedTaxaCount.replace(/\*/g, '')}
                        </span>
                      </>
                    )}
                  </p>
                )}

                {singleData.conservationStatus &&
                  singleData.conservationStatus !== 'Not Evaluated' &&
                  singleData.conservationStatus !== 'N/A' && (
                    <span className="px-2.5 py-1 rounded-md bg-slate-800/80 text-xs font-semibold text-slate-300 border border-slate-700/50 print:bg-gray-100 print:text-black print:border-gray-300">
                      {singleData.conservationStatus}
                    </span>
                  )}
              </div>

              {singleData.lineage.length > 0 && (
                <nav aria-label="Taxonomic lineage" className="flex flex-wrap justify-center items-center gap-2">
                  {singleData.lineage.map((taxon, idx) => (
                    <div key={`${taxon}-${idx}`} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => runSingleTaxonSearch(taxon)}
                        disabled={loading}
                        className="inline-block px-3 py-1.5 bg-slate-900/50 hover:bg-slate-800/80 text-slate-300 hover:text-cyan-300 text-xs sm:text-xs uppercase tracking-widest rounded-xl border border-slate-800/60 hover:border-cyan-800/60 transition-colors cursor-pointer min-h-[34px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50 print:bg-white print:text-black"
                        title={`View profile for ${taxon}`}
                      >
                        {taxon}
                      </button>
                      {idx < singleData.lineage.length - 1 && (
                        <span aria-hidden="true" className="text-slate-600 text-xs">
                          ›
                        </span>
                      )}
                    </div>
                  ))}
                </nav>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-8 space-y-6">
                <TaxonCard
                  title="Quick Recap"
                  icon={<StarIcon className="w-5 h-5" />}
                  highlight
                  onCopy={() => copyToClipboard(singleData.quickRecap, 'Quick Recap')}
                >
                  <MarkdownRenderer content={singleData.quickRecap} />
                </TaxonCard>

                {/* Hazards & Toxicity placed prominently near Quick Recap and Diagnostic Features */}
                {hasMeaningfulHazards ? (
                  <section
                    aria-labelledby="hazards-heading"
                    className="bg-orange-950/25 border border-orange-800/60 p-5 rounded-2xl text-orange-100 flex gap-4 items-start shadow-lg shadow-orange-900/10 print:border-black print:text-black print:bg-white print:break-inside-avoid"
                  >
                    <AlertTriangleIcon
                      aria-hidden="true"
                      className="w-6 h-6 text-orange-400 shrink-0 mt-0.5 print:text-black"
                    />
                    <div className="min-w-0">
                      <h3
                        id="hazards-heading"
                        className="font-display font-bold uppercase tracking-widest text-sm mb-1.5 text-orange-300 print:text-black"
                      >
                        Hazards & Toxicity
                      </h3>
                      <div className="text-base md:text-sm text-orange-100/90 print:text-black">
                        <MarkdownRenderer content={singleData.hazards!} />
                      </div>
                    </div>
                  </section>
                ) : (
                  <section
                    aria-labelledby="hazards-heading"
                    className="bg-slate-900/60 border border-slate-800/70 p-4 rounded-2xl text-slate-300 flex gap-3 items-start print:border-gray-300 print:text-black print:bg-white print:break-inside-avoid"
                  >
                    <AlertTriangleIcon
                      aria-hidden="true"
                      className="w-5 h-5 text-slate-400 shrink-0 mt-0.5 print:text-black"
                    />
                    <div className="min-w-0">
                      <h3
                        id="hazards-heading"
                        className="font-display font-bold uppercase tracking-widest text-xs mb-1 text-slate-300 print:text-black"
                      >
                        Hazards & Toxicity
                      </h3>
                      <p className="text-sm text-slate-400 print:text-black">
                        No hazard assessment was reported in this response. Do not assume non-toxicity without consulting authoritative sources.
                      </p>
                    </div>
                  </section>
                )}

                <TaxonCard
                  title="Diagnostic Features"
                  icon={<HandLensIcon className="w-5 h-5" />}
                  onCopy={() => copyToClipboard(singleData.diagnosticDescription, 'Diagnostic Features')}
                >
                  <MarkdownRenderer content={singleData.diagnosticDescription} />
                </TaxonCard>
              </div>

              <div className="lg:col-span-4 space-y-6">
                {singleData.fieldNotes && singleData.fieldNotes !== 'N/A' && (
                  <TaxonCard
                    title="Field Notes"
                    icon={
                      <svg
                        className="w-5 h-5"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M2 6h4" />
                        <path d="M2 10h4" />
                        <path d="M2 14h4" />
                        <path d="M2 18h4" />
                        <rect width="16" height="20" x="4" y="2" rx="2" />
                        <path d="M9.5 8h5" />
                        <path d="M9.5 12h5" />
                        <path d="M9.5 16h5" />
                      </svg>
                    }
                    onCopy={() => copyToClipboard(singleData.fieldNotes || '', 'Field Notes')}
                  >
                    <div className="text-slate-400 text-base md:text-sm">
                      <MarkdownRenderer content={singleData.fieldNotes} />
                    </div>
                  </TaxonCard>
                )}

                <TaxonCard
                  title="Ecology & Range"
                  icon={<GlobeIcon className="w-5 h-5" />}
                  onCopy={() =>
                    copyToClipboard(`${singleData.ecology}\n\n${singleData.distribution}`, 'Ecology & Range')
                  }
                >
                  <div className="mb-5">
                    <strong className="block mb-2 text-sm md:text-xs font-bold uppercase tracking-widest text-cyan-400/80 print:text-black">
                      Habitat
                    </strong>
                    <MarkdownRenderer content={singleData.ecology} />
                  </div>
                  <div className={singleData.seasonality && singleData.seasonality !== 'N/A' ? 'mb-5' : ''}>
                    <strong className="block mb-2 text-sm md:text-xs font-bold uppercase tracking-widest text-cyan-400/80 print:text-black">
                      Distribution
                    </strong>
                    <MarkdownRenderer content={singleData.distribution} />
                  </div>
                  {singleData.seasonality && singleData.seasonality !== 'N/A' && (
                    <div>
                      <strong className="block mb-2 text-sm md:text-xs font-bold uppercase tracking-widest text-cyan-400/80 print:text-black">
                        Seasonality
                      </strong>
                      <MarkdownRenderer content={singleData.seasonality} />
                    </div>
                  )}
                </TaxonCard>

                <TaxonCard
                  title="Etymology"
                  icon={<BookOpenIcon className="w-5 h-5" />}
                  onCopy={() => copyToClipboard(singleData.etymology, 'Etymology')}
                >
                  <div className="text-slate-400 text-base md:text-sm">
                    <MarkdownRenderer content={singleData.etymology} />
                  </div>
                </TaxonCard>

                <TaxonCard
                  title="History"
                  icon={<ScrollIcon className="w-5 h-5" />}
                  onCopy={() => copyToClipboard(singleData.history, 'History')}
                >
                  <div className="text-slate-400 text-base md:text-sm">
                    <MarkdownRenderer content={singleData.history} />
                  </div>
                </TaxonCard>

                {singleData.humanRelevance && singleData.humanRelevance !== 'N/A' && (
                  <TaxonCard
                    title="Human Relevance"
                    icon={
                      <svg
                        className="w-5 h-5"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    }
                    onCopy={() => copyToClipboard(singleData.humanRelevance || '', 'Human Relevance')}
                  >
                    <div className="text-slate-400 text-base md:text-sm">
                      <MarkdownRenderer content={singleData.humanRelevance} />
                    </div>
                  </TaxonCard>
                )}
              </div>

              {singleData.confusedTaxa.length > 0 && (
                <div className="lg:col-span-12">
                  <TaxonCard
                    title="Similar Taxa"
                    icon={<AlertTriangleIcon className="w-5 h-5" />}
                    className="border-orange-900/20"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                      {singleData.confusedTaxa.map((taxon, idx) => (
                        <div
                          key={`${taxon.name}-${idx}`}
                          className="bg-slate-950/30 p-5 rounded-xl border border-slate-800/50 hover:border-orange-900/40 transition-colors print:bg-white print:break-inside-avoid"
                        >
                          <button
                            type="button"
                            onClick={() => runSingleTaxonSearch(taxon.name)}
                            disabled={loading}
                            className="font-bold font-display text-orange-300 hover:text-orange-200 mb-3 italic text-lg text-left transition-colors print:text-black cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 rounded disabled:opacity-50"
                            title={`View profile for ${taxon.name}`}
                          >
                            {taxon.name}
                          </button>
                          <div className="text-base md:text-sm text-slate-400 mb-3">
                            <MarkdownRenderer content={taxon.difference} />
                          </div>
                          <div className="pt-3 border-t border-slate-800/50">
                            <span className="text-xs text-orange-400/80 uppercase tracking-wide font-semibold">
                              Key Feature:{' '}
                            </span>
                            <span className="text-sm md:text-xs text-orange-200 print:text-black">
                              {taxon.keyFeature}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </TaxonCard>
                </div>
              )}

              <div className="lg:col-span-12">
                <SourceList sources={singleData.sources} />
              </div>
            </div>
          </div>
        )}

        {/* Comparison Results */}
        {compareData && !loading && (
          <div className="max-w-6xl mx-auto">
            {compareData.localityContext && (
              <div className="text-center mb-8">
                <p className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900/50 rounded-full text-slate-300 border border-slate-800/50 font-medium text-sm">
                  <MapPinIcon className="w-4 h-4 text-cyan-500" aria-hidden="true" />
                  <span>
                    Geographic Context: <span className="text-white">{compareData.localityContext}</span>
                  </span>
                </p>
              </div>
            )}

            <div
              className={`grid gap-6 mb-10 text-center ${
                compareData.taxa.length === 3 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'
              }`}
            >
              {compareData.taxa.map((taxon, idx) => (
                <div
                  key={`${taxon.scientificName}-${idx}`}
                  className="relative p-6 sm:p-8 bg-slate-900/40 backdrop-blur-sm rounded-3xl border border-slate-800/50 flex flex-col justify-center h-full print:bg-white print:break-inside-avoid"
                >
                  <h2 className="text-2xl sm:text-3xl font-bold font-display text-white mb-2 print:text-black break-words">
                    <i className="italic">{taxon.scientificName}</i>
                  </h2>
                  <p className="text-lg sm:text-xl text-cyan-400 font-medium mb-2 print:text-black break-words">
                    {taxon.commonName}
                  </p>
                  {taxon.includedTaxaCount && (
                    <p className="text-slate-400 text-sm italic print:text-black">
                      Includes:{' '}
                      <span className="text-slate-300 font-medium not-italic">
                        {taxon.includedTaxaCount.replace(/\*/g, '')}
                      </span>
                      {taxon.localIncludedTaxaCount &&
                        taxon.localIncludedTaxaCount !== 'N/A' &&
                        compareData.localityContext && (
                          <>
                            <span aria-hidden="true" className="mx-2 text-slate-600">
                              •
                            </span>
                            <span className="text-cyan-400 font-medium not-italic">
                              Local: {taxon.localIncludedTaxaCount.replace(/\*/g, '')}
                            </span>
                          </>
                        )}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="mb-10">
              <div className="bg-slate-900/40 backdrop-blur-sm border border-slate-800/50 rounded-3xl overflow-hidden shadow-2xl print:bg-white">
                <div className="bg-gradient-to-r from-slate-900 to-slate-800/50 p-5 sm:p-6 border-b border-slate-800/50 print:bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-bold font-display text-white print:text-black">
                      Key Diagnostic Characters
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 md:hidden print:hidden">
                      Scroll horizontally to compare all columns →
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyComparisonTable(compareData)}
                    aria-label="Copy comparison table"
                    className="self-start sm:self-auto px-3 py-1.5 rounded-lg border border-slate-700/70 bg-slate-900/70 text-xs font-medium text-slate-300 hover:text-cyan-300 hover:border-cyan-700/60 transition-colors min-h-[34px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 print:hidden"
                  >
                    {tableCopyStatus === 'copied'
                      ? 'Copied'
                      : tableCopyStatus === 'failed'
                        ? 'Copy failed'
                        : 'Copy table'}
                  </button>
                </div>

                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Key diagnostic characters comparison table"
                  className="overflow-x-auto comparison-table focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400"
                >
                  <table className="w-full text-left text-slate-300 text-sm sm:text-base md:text-sm min-w-[540px] print:text-black">
                    <caption className="sr-only">
                      Key diagnostic morphological characters across{' '}
                      {compareData.taxa.map((t) => t.scientificName).join(', ')}
                    </caption>
                    <thead className="bg-slate-950 text-slate-400 text-xs uppercase tracking-wider print:bg-gray-100">
                      <tr>
                        <th scope="col" className="p-4 sm:p-5 font-semibold font-display sticky-col">
                          Character
                        </th>
                        {compareData.taxa.map((taxon, idx) => (
                          <th
                            key={`${taxon.scientificName}-col-${idx}`}
                            scope="col"
                            className="p-4 sm:p-5 font-semibold font-display italic border-l border-slate-800/30"
                          >
                            {taxon.scientificName}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/30">
                      {compareData.keyDifferences.map((diff, idx) => (
                        <tr key={`${diff.feature}-${idx}`} className="hover:bg-cyan-500/5 transition-colors">
                          <th
                            scope="row"
                            className="p-4 sm:p-5 font-medium text-cyan-300 sticky-col border-r border-slate-800/30 align-top text-left"
                          >
                            {diff.feature}
                          </th>
                          {diff.states.map((state, sIdx) => (
                            <td key={sIdx} className="p-4 sm:p-5 border-l border-slate-800/30 align-top">
                              <MarkdownRenderer content={state} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="text-2xl font-bold font-display text-white border-b border-slate-800/50 pb-4 print:text-black">
                Detailed Side-by-Side Profiles
              </h3>
              {[
                { title: 'Overview', icon: <StarIcon className="w-5 h-5" /> },
                { title: 'Ecology', icon: <GlobeIcon className="w-5 h-5" /> },
                { title: 'Etymology', icon: <BookOpenIcon className="w-5 h-5" /> },
                { title: 'Historical Context', icon: <ScrollIcon className="w-5 h-5" /> },
              ].map((section) => (
                <TaxonCard
                  key={section.title}
                  title={section.title}
                  icon={section.icon}
                  onCopy={() =>
                    copyToClipboard(
                      compareData.taxa
                        .map((taxon) => {
                          const body =
                            section.title === 'Overview'
                              ? taxon.quickRecap
                              : section.title === 'Ecology'
                                ? taxon.ecology
                                : section.title === 'Etymology'
                                  ? taxon.etymology
                                  : taxon.history;
                          return `## ${taxon.scientificName}\n${body}`;
                        })
                        .join('\n\n'),
                      section.title
                    )
                  }
                >
                  <div
                    className={`grid gap-6 ${
                      compareData.taxa.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
                    }`}
                  >
                    {compareData.taxa.map((taxon, idx) => (
                      <div
                        key={`${taxon.scientificName}-${section.title}-${idx}`}
                        className="border-l-2 border-slate-800/60 pl-4 sm:pl-5 print:border-gray-300"
                      >
                        <h4 className="font-bold font-display text-white mb-3 italic text-lg print:text-black break-words">
                          {taxon.scientificName}
                        </h4>
                        <MarkdownRenderer
                          content={
                            section.title === 'Overview'
                              ? taxon.quickRecap
                              : section.title === 'Ecology'
                                ? taxon.ecology
                                : section.title === 'Etymology'
                                  ? taxon.etymology
                                  : taxon.history
                          }
                        />
                      </div>
                    ))}
                  </div>
                </TaxonCard>
              ))}
            </div>

            <SourceList sources={compareData.sources} />
          </div>
        )}
      </main>

      <footer className="relative mt-20 max-w-6xl mx-auto px-4 text-center py-10 border-t border-slate-800/30 print:hidden">
        <p className="text-slate-400 text-base md:text-sm mb-3">
          Developed by Daniel Cahen - Powered by Gemini 4 Hydrogen with Search Grounding
        </p>
        <p className="text-slate-500 text-sm md:text-xs">
          AI-generated content. For critical research, verify with authoritative literature.
        </p>
      </footer>

      {showBackToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: getScrollBehavior() })}
          aria-label="Back to top"
          className="fixed bottom-6 right-6 p-3.5 sm:p-4 bg-cyan-600/90 backdrop-blur text-white rounded-full shadow-2xl hover:bg-cyan-500 transition-colors z-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 print:hidden"
          title="Back to Top"
        >
          <svg
            aria-hidden="true"
            className="w-6 h-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default App;