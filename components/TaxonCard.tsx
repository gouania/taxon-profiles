import React, { useState } from 'react';

interface TaxonCardProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  highlight?: boolean;
  className?: string;
  onCopy?: () => void;
}

export const TaxonCard: React.FC<TaxonCardProps> = ({ title, icon, children, highlight = false, className = '', onCopy }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (onCopy) {
      onCopy();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={`
      relative rounded-xl border p-6 transition-all duration-300 hover:shadow-lg group
      ${highlight 
        ? 'bg-slate-800/50 border-cyan-500/30 shadow-cyan-900/20' 
        : 'bg-slate-900 border-slate-800 shadow-sm'
      }
      ${className}
    `}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${highlight ? 'bg-cyan-900/30 text-cyan-400' : 'bg-slate-800 text-slate-400'}`}>
            {icon}
          </div>
          <h3 className={`font-display text-lg font-semibold ${highlight ? 'text-cyan-400' : 'text-slate-200'}`}>
            {title}
          </h3>
        </div>
        
        {onCopy && (
          <button 
            onClick={handleCopy}
            className="text-slate-500 hover:text-cyan-400 opacity-0 group-hover:opacity-100 transition-all duration-200 text-xs font-medium flex items-center gap-1 print:hidden"
          >
            {copied ? 'Copied!' : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                Copy
              </>
            )}
          </button>
        )}
      </div>
      <div className="text-slate-300 leading-relaxed">
        {children}
      </div>
    </div>
  );
};