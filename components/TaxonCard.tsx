import React, { useEffect, useRef, useState } from 'react';

interface TaxonCardProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  highlight?: boolean;
  className?: string;
  onCopy?: () => Promise<boolean> | boolean | void;
}

type CopyState = 'idle' | 'copying' | 'copied' | 'failed';

export const TaxonCard: React.FC<TaxonCardProps> = ({
  title,
  icon,
  children,
  highlight = false,
  className = '',
  onCopy,
}) => {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const scheduleReset = () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setCopyState('idle');
    }, 2200);
  };

  const handleCopy = async () => {
    if (!onCopy || copyState === 'copying') return;
    setCopyState('copying');
    try {
      const result = await onCopy();
      if (result === false) {
        setCopyState('failed');
      } else {
        setCopyState('copied');
      }
    } catch {
      setCopyState('failed');
    }
    scheduleReset();
  };

  return (
    <section
      className={`
        relative rounded-xl border p-5 sm:p-6 transition-all duration-300 hover:shadow-lg group print:break-inside-avoid
        ${
          highlight
            ? 'bg-slate-800/50 border-cyan-500/30 shadow-cyan-900/20'
            : 'bg-slate-900 border-slate-800 shadow-sm'
        }
        ${className}
      `}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            aria-hidden="true"
            className={`p-2 rounded-lg shrink-0 ${
              highlight ? 'bg-cyan-900/30 text-cyan-400' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {icon}
          </div>
          <h3
            className={`font-display text-lg font-semibold break-words ${
              highlight ? 'text-cyan-400' : 'text-slate-200'
            }`}
          >
            {title}
          </h3>
        </div>

        {onCopy && (
          <button
            type="button"
            onClick={handleCopy}
            disabled={copyState === 'copying'}
            aria-label={`Copy ${title}`}
            className={`shrink-0 transition-all duration-200 text-xs font-medium flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 print:hidden ${
              copyState === 'copied'
                ? 'opacity-100 text-emerald-300 bg-emerald-950/50 border-emerald-700/60'
                : copyState === 'failed'
                  ? 'opacity-100 text-red-300 bg-red-950/50 border-red-700/60'
                  : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-800/70 border-slate-800/70 md:border-transparent md:hover:border-slate-700/70 opacity-100 md:opacity-75 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100'
            }`}
          >
            {copyState === 'copied' ? (
              <>
                <svg
                  aria-hidden="true"
                  className="w-3.5 h-3.5 text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span>Copied</span>
              </>
            ) : copyState === 'failed' ? (
              <>
                <svg
                  aria-hidden="true"
                  className="w-3.5 h-3.5 text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>Copy failed</span>
              </>
            ) : (
              <>
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
                    d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                  />
                </svg>
                <span>Copy</span>
              </>
            )}
          </button>
        )}
      </div>
      <div className="text-slate-300 leading-relaxed">{children}</div>
    </section>
  );
};