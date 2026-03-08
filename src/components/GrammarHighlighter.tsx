import React, { useState, useRef, useEffect } from 'react';
import { GrammarIssue } from '@/types';
import { Check, X, AlertCircle } from 'lucide-react';

interface GrammarHighlighterProps {
  text: string;
  path: string;
  issues: GrammarIssue[];
  onAccept: (issue: GrammarIssue) => void;
  onIgnore: (issue: GrammarIssue) => void;
  style?: React.CSSProperties;
  className?: string;
}

const GrammarHighlighter: React.FC<GrammarHighlighterProps> = ({ 
  text, 
  path, 
  issues, 
  onAccept, 
  onIgnore,
  style,
  className 
}) => {
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<'top' | 'bottom'>('bottom');
  const spanRef = useRef<HTMLSpanElement>(null);
  
  // Normalize path for comparison
  const normalizePath = (p: string) => p.replace(/\[(\d+)\]/g, '.$1');
  
  // Find ALL issues for this specific path
  const fieldIssues = issues.filter(i => normalizePath(i.path) === normalizePath(path));

  if (fieldIssues.length === 0) {
    return <span className={className} style={style}>{text}</span>;
  }

  // Sort issues by their position in the text to render them in order
  // Note: We assume non-overlapping issues for simplicity, which is typical for LLM output
  const sortedIssues = [...fieldIssues]
    .map(issue => ({
        ...issue,
        index: text.indexOf(issue.errorText)
    }))
    .filter(issue => issue.index !== -1)
    .sort((a, b) => a.index - b.index);

  if (sortedIssues.length === 0) {
    return <span className={className} style={style}>{text}</span>;
  }

  const renderParts = () => {
    const result: React.ReactNode[] = [];
    let lastIndex = 0;

    sortedIssues.forEach((issue, idx) => {
      // Add text before the error
      if (issue.index > lastIndex) {
        result.push(text.substring(lastIndex, issue.index));
      }

      const isSpelling = issue.type === 'SPELLING';
      const highlightColor = isSpelling ? '#f87171' : '#4ade80'; // Red for spelling, Green for others
      const bgColor = isSpelling ? '#fef2f2' : '#f0fdf4';
      const iconColor = isSpelling ? '#ef4444' : '#22c55e';
      const label = isSpelling ? 'Spelling Error' : (issue.type === 'GRAMMAR' ? 'Grammar Correction' : 'Writing Improvement');

      result.push(
        <span key={issue.id} className="relative inline-block">
          <span 
            ref={activeIssueId === issue.id ? spanRef : null}
            style={{
              cursor: 'pointer',
              borderBottom: `2px solid ${highlightColor}`,
              backgroundColor: bgColor,
              borderRadius: '2px',
              padding: '0 2px',
              transition: 'background-color 0.2s, border-color 0.2s',
            }}
            onClick={(e) => {
                e.stopPropagation();
                if (activeIssueId === issue.id) {
                    setActiveIssueId(null);
                } else {
                    setActiveIssueId(issue.id);
                    // Calculate position after a brief delay to allow render
                    setTimeout(() => {
                        if (spanRef.current) {
                            const rect = spanRef.current.getBoundingClientRect();
                            // If less than 250px from top, show below
                            if (rect.top < 250) {
                                setPopoverPosition('bottom');
                            } else {
                                setPopoverPosition('top');
                            }
                        }
                    }, 10);
                }
            }}
          >
            {issue.errorText}
          </span>
          
          {activeIssueId === issue.id && (
            <div 
              className={`absolute z-50 left-0 w-72 rounded-lg shadow-xl border p-4 text-sm font-sans animate-in fade-in zoom-in duration-200 ${
                popoverPosition === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
              }`}
              style={{
                backgroundColor: '#ffffff',
                borderColor: '#e2e8f0',
                color: '#1e293b',
                textAlign: 'left',
                minWidth: '300px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-2 mb-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: iconColor }} />
                <div>
                   <div className="font-semibold" style={{ color: '#1e293b' }}>{label}</div>
                   <div className="text-xs mt-1 leading-relaxed" style={{ color: '#64748b' }}>{issue.reason}</div>
                </div>
              </div>
              
              <div className="p-2 rounded border mb-3" style={{ backgroundColor: '#f8fafc', borderColor: '#e2e8f0' }}>
                 <div className="line-through text-xs mb-1 opacity-60" style={{ color: '#475569' }}>{issue.errorText}</div>
                 <div className="flex flex-col gap-1 mt-2">
                    {issue.suggestions.map((suggestion, sIdx) => (
                        <button
                            key={sIdx}
                            onClick={() => { onAccept({ ...issue, suggestions: [suggestion] }); setActiveIssueId(null); }}
                            className={`text-left px-2 py-1.5 text-sm font-medium rounded transition-colors border border-transparent ${
                                isSpelling 
                                ? 'hover:bg-red-100 text-red-700 hover:border-red-200' 
                                : 'hover:bg-green-100 text-green-700 hover:border-green-200'
                            }`}
                        >
                            {suggestion}
                        </button>
                    ))}
                 </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { onIgnore(issue); setActiveIssueId(null); }}
                  className="px-3 py-1.5 text-xs font-medium hover:bg-slate-100 rounded border flex items-center gap-1"
                  style={{ color: '#475569', borderColor: '#e2e8f0' }}
                >
                  <X className="w-3 h-3" /> Ignore
                </button>
              </div>
              
              <div 
                className="absolute top-full left-4 -mt-1 w-2 h-2 border-b border-r transform rotate-45"
                style={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0' }}
              ></div>
            </div>
          )}
        </span>
      );

      lastIndex = issue.index + issue.errorText.length;
    });

    // Add remaining text
    if (lastIndex < text.length) {
      result.push(text.substring(lastIndex));
    }

    return result;
  };

  return (
    <span className={className} style={style}>
      {renderParts()}
    </span>
  );
};

export default GrammarHighlighter;
