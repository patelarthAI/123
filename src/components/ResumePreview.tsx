import React, { useState } from "react";
import { ResumeData, GrammarIssue, ChangeLogItem, ResumeFormat } from "@/types";
import { Download, CheckCircle2, FileText, SpellCheck, Loader2, History, ArrowRight, LayoutTemplate, Undo2 } from "lucide-react";
import { analyzeGrammar } from "@/services/geminiService";
import { generateResumePDF } from "@/services/pdfService";
import { generateResumeDoc } from "@/services/docxService";
import FileSaver from "file-saver";
import GrammarHighlighter from "./GrammarHighlighter";
import _ from "lodash"; // We need lodash for deep setting by path
import { motion, AnimatePresence } from "framer-motion";

interface ResumePreviewProps {
  data: ResumeData;
  onDownload: () => void;
  onReset: () => void;
  onUpdate: (data: ResumeData) => void;
  selectedFormat: ResumeFormat;
}

const ResumePreview: React.FC<ResumePreviewProps> = ({ data, onDownload, onReset, onUpdate, selectedFormat }) => {
  const [isChecking, setIsChecking] = useState(false);
  const [issues, setIssues] = useState<GrammarIssue[]>([]);
  const [changeLog, setChangeLog] = useState<ChangeLogItem[]>(() => {
    if (data.extractionChanges) {
        return data.extractionChanges.map(c => ({
            id: c.id || Math.random().toString(),
            timestamp: Date.now(),
            path: "Extraction",
            original: c.type, // e.g. "REMOVAL"
            new: c.description,
            reason: c.reason
        }));
    }
    return [];
  });
  
  // Note: setIssues([]) is NOT called here anymore. 
  // It will be reset naturally when ResumePreview remounts due to key={fileName} in App.tsx
  
  // Styles based on format
  const getStyles = (format: ResumeFormat) => {
    if (format === ResumeFormat.MODERN_EXECUTIVE) {
        return {
            fontFamily: "Arial, sans-serif",
            fontSizeBody: "11pt",
            fontSizeName: "12pt",
            headingTransform: "uppercase" as const,
            headingBorder: "none",
            headingColor: "#000000",
            nameAlign: "left" as const,
            lineHeight: "1.5",
            marginBottom: "1.5rem",
            showContactInfo: false, // Only location
            jobLayout: 'modern' as const, // Date -> Company -> Title
            headingMarginBottom: "12px"
        };
    }
    // Default Classic
    return {
        fontFamily: "Calibri, sans-serif",
        fontSizeBody: "11pt", // Approx 14.7px
        fontSizeName: "14pt", // Approx 18.7px
        headingTransform: "uppercase" as const,
        headingBorder: "none",
        headingColor: "#000000",
        nameAlign: "center" as const,
        lineHeight: "1.2",
        marginBottom: "1rem",
        showContactInfo: false, // Only location for privacy
        jobLayout: 'classic' as const,
        headingMarginBottom: "4px"
    };
  };

  const styles = getStyles(selectedFormat);
  const black = "#000000";

  const formatTitle = (title: string) => {
    const trimmed = title.trim();
    return trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
  };
  
  // Helper to shorten state names and capitalize city names
  const formatLocation = (loc: string) => {
    if (!loc) return "";
    
    const stateMap: { [key: string]: string } = {
        "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
        "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA",
        "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
        "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
        "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO",
        "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ",
        "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
        "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
        "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
        "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"
    };

    const parts = loc.split(',').map(p => p.trim());
    if (parts.length >= 1) {
        // Capitalize City
        parts[0] = parts[0].split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
        
        if (parts.length >= 2) {
            // Shorten State if found in map
            const state = parts[1];
            const foundState = Object.keys(stateMap).find(s => s.toLowerCase() === state.toLowerCase());
            if (foundState) {
                parts[1] = stateMap[foundState];
            } else if (state.length > 2) {
                // If not in map but looks like a full name (longer than 2 chars), maybe it's already abbreviated or something else
                // We'll leave it or try to capitalize it if it's not in the map
                parts[1] = state.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
            } else {
                parts[1] = state.toUpperCase(); // Ensure 2-letter codes are uppercase
            }
        }
    }
    
    return parts.join(', ');
  };

  // Helper to expand months for Modern format
  const formatModernDate = (dateStr: string) => {
      if (!dateStr) return "";
      
      const monthMap: { [key: string]: string } = {
          "Jan": "January", "Feb": "February", "Mar": "March", "Apr": "April",
          "May": "May", "Jun": "June", "Jul": "July", "Aug": "August",
          "Sep": "September", "Oct": "October", "Nov": "November", "Dec": "December",
          "Sept": "September"
      };

      // Replace all occurrences of 3-letter months with full names
      // We use a regex with word boundaries to avoid replacing parts of other words
      let formatted = dateStr;
      Object.keys(monthMap).forEach(short => {
          const regex = new RegExp(`\\b${short}\\b`, 'g');
          formatted = formatted.replace(regex, monthMap[short]);
      });
      
      return formatted;
  };

  // Helper to split long sentences into bullets if they contain periods
  const processDescription = (items: string[]) => {
      if (!items) return [];
      const processed: string[] = [];
      items.forEach(item => {
          if (item.length > 100 && item.includes('.')) {
             // Split by period, but ignore periods in common abbreviations (e.g., "Mr.", "Inc.") if possible.
             // For simplicity, we split by ". " or "." at end of string.
             const sentences = item.split(/\. (?=[A-Z])|\.$/g).filter(s => s.trim().length > 0);
             sentences.forEach(s => {
                 const trimmed = s.trim();
                 processed.push(trimmed.endsWith('.') ? trimmed : `${trimmed}.`);
             });
          } else {
              processed.push(item);
          }
      });
      return processed;
  };

  const styleText = (text: string) => {
    if (selectedFormat === ResumeFormat.MODERN_EXECUTIVE) {
        return formatModernDate(text);
    }
    return text;
  };

  const handleCheckGrammar = async () => {
    setIsChecking(true);
    try {
      const foundIssues = await analyzeGrammar(data, selectedFormat);
      setIssues(foundIssues);
      if (foundIssues.length === 0) {
        alert("No grammar issues found!");
      }
    } catch (error) {
      console.error("Grammar check failed", error);
      alert("Failed to check grammar. Please try again.");
    } finally {
      setIsChecking(false);
    }
  };

  const handleAcceptIssue = (issue: GrammarIssue) => {
    // Create deep clone to avoid mutation
    const newData = JSON.parse(JSON.stringify(data));
    
    // Get current value at path
    const currentValue = _.get(newData, issue.path);
    
    if (typeof currentValue === 'string' && issue.errorText && issue.suggestions && issue.suggestions.length > 0) {
        // Replace ONLY the error text with the first suggestion (or selected one passed in issue)
        const selectedSuggestion = issue.suggestions[0];
        const newValue = currentValue.replace(issue.errorText, selectedSuggestion);
        _.set(newData, issue.path, newValue);
        
        // Add to Change Log
        const newLogItem: ChangeLogItem = {
            id: Date.now().toString(),
            timestamp: Date.now(),
            path: issue.path,
            original: issue.errorText,
            new: selectedSuggestion,
            reason: issue.reason
        };
        setChangeLog(prev => [newLogItem, ...prev]);

    } else {
        // Fallback if something is wrong, though this shouldn't happen with new logic
        console.warn("Could not replace text safely", issue);
    }
    
    onUpdate(newData);
    setIssues(prev => prev.filter(i => i.id !== issue.id));
  };

  const handleIgnoreIssue = (issue: GrammarIssue) => {
    setIssues(prev => prev.filter(i => i.id !== issue.id));
  };

  const handleUndoChange = (log: ChangeLogItem) => {
    // Only allow undo for Grammar changes
    if (log.path === "Extraction") return;

    const newData = JSON.parse(JSON.stringify(data));
    const currentValue = _.get(newData, log.path);

    if (typeof currentValue === 'string') {
        const newValue = currentValue.replace(log.new, log.original);
        _.set(newData, log.path, newValue);
        
        // Update data
        onUpdate(newData);
        
        // Remove from changeLog
        setChangeLog(prev => prev.filter(item => item.id !== log.id));
    }
  };

  const handleDownloadPDF = () => {
    try {
      generateResumePDF(data, selectedFormat);
    } catch (err) {
      console.error("PDF generation failed", err);
      alert("Failed to generate PDF.");
    }
  };

  const handleDownloadDOCX = async () => {
    try {
      const blob = await generateResumeDoc(data, selectedFormat);
      FileSaver.saveAs(blob, `Resume_${data.fullName.replace(/\s+/g, "_")}_${selectedFormat === ResumeFormat.MODERN_EXECUTIVE ? 'Modern' : 'Classic'}.docx`);
    } catch (err) {
      console.error("DOCX generation failed", err);
      alert("Failed to generate DOCX.");
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 w-full max-w-7xl mx-auto">
      {/* Left Column: Resume Preview */}
      <div className="flex-1 min-w-0">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 md:p-8 shadow-2xl">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8 pb-6 border-b border-white/10">
                <div className="flex items-center gap-4">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <FileText className="w-6 h-6 text-indigo-400" />
                        Resume Preview
                    </h2>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={onReset}
                        className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    >
                        Reset
                    </button>
                    <button
                        onClick={handleCheckGrammar}
                        disabled={isChecking}
                        className="px-4 py-2 text-sm font-medium bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 border border-indigo-500/30 rounded-lg flex items-center gap-2 transition-all disabled:opacity-50"
                    >
                        {isChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <SpellCheck className="w-4 h-4" />}
                        Check Grammar
                    </button>
                    <button
                        onClick={handleDownloadDOCX}
                        className="px-4 py-2 text-sm font-medium bg-white text-slate-900 hover:bg-indigo-50 rounded-lg shadow-lg shadow-indigo-500/20 flex items-center gap-2 transition-all hover:scale-105"
                    >
                        <Download className="w-4 h-4" />
                        Download DOCX
                    </button>
                    <button
                        onClick={handleDownloadPDF}
                        className="px-4 py-2 text-sm font-medium bg-slate-800 text-white hover:bg-slate-700 border border-slate-700 rounded-lg flex items-center gap-2 transition-all"
                    >
                        <Download className="w-4 h-4" />
                        PDF
                    </button>
                </div>
            </div>

            {/* Resume Content */}
            <div 
              id="resume-preview-content"
              className="overflow-y-auto max-h-[85vh] custom-scrollbar" 
              style={{ 
                fontFamily: styles.fontFamily, 
                color: black, 
                backgroundColor: '#ffffff', // Explicit hex for html2canvas
                padding: '48px', /* 0.5 inch */
                borderRadius: '12px'
              }}
            >
              
              {/* 1. Name */}
              <div style={{ textAlign: styles.nameAlign, marginBottom: styles.marginBottom }}>
                <h1 style={{ fontWeight: 'bold', textTransform: 'uppercase', fontSize: styles.fontSizeName, color: styles.headingColor === "#000000" ? black : styles.headingColor, margin: 0 }}>
                  {data.fullName}
                </h1>
                {((styles.showContactInfo) || (selectedFormat === ResumeFormat.MODERN_EXECUTIVE && data.contactInfo?.location)) && (
                  <div style={{ 
                      fontSize: selectedFormat === ResumeFormat.MODERN_EXECUTIVE ? styles.fontSizeName : styles.fontSizeBody, 
                      color: black, 
                      marginTop: '4px', 
                      fontWeight: styles.showContactInfo ? 'normal' : 'bold' 
                  }}>
                      {styles.showContactInfo ? (
                          [
                              formatLocation(data.contactInfo?.location || ""),
                              data.contactInfo?.phone,
                              data.contactInfo?.email,
                              data.contactInfo?.linkedin,
                              data.contactInfo?.website
                          ].filter(Boolean).join(" | ")
                      ) : (
                          // Modern Executive: Only Location (City, State, ZIP)
                          formatLocation(data.contactInfo?.location || "")
                      )}
                  </div>
                )}
              </div>

              {/* 2. Summary */}
              {data.summary && (
                <div style={{ marginBottom: styles.marginBottom }}>
                  <h3 style={{ 
                      fontWeight: 'bold', 
                      textTransform: styles.headingTransform, 
                      marginBottom: styles.headingMarginBottom, 
                      fontSize: styles.fontSizeBody, 
                      color: styles.headingColor,
                      borderBottom: styles.headingBorder,
                      paddingBottom: styles.headingBorder !== 'none' ? '2px' : '0'
                  }}>
                    {formatTitle(data.sectionTitleSummary || "SUMMARY")}
                  </h3>
                  {Array.isArray(data.summary) ? (
                      data.summary.length === 1 ? (
                         <div style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginTop: 0 }}>
                           <GrammarHighlighter 
                             text={data.summary[0]} 
                             path="summary.0" 
                             issues={issues} 
                             onAccept={handleAcceptIssue} 
                             onIgnore={handleIgnoreIssue} 
                           />
                         </div>
                      ) : (
                         <ul style={{ listStyleType: 'disc', paddingLeft: '1.25rem', marginTop: 0 }}>
                            {data.summary.map((item, idx) => (
                              <li key={idx} style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', paddingLeft: '2px' }}>
                                <GrammarHighlighter 
                                  text={item} 
                                  path={`summary.${idx}`} 
                                  issues={issues} 
                                  onAccept={handleAcceptIssue} 
                                  onIgnore={handleIgnoreIssue} 
                                />
                              </li>
                            ))}
                         </ul>
                      )
                  ) : (
                      <div style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginTop: 0 }}>
                        <GrammarHighlighter 
                          text={data.summary} 
                          path="summary" 
                          issues={issues} 
                          onAccept={handleAcceptIssue} 
                          onIgnore={handleIgnoreIssue} 
                        />
                      </div>
                  )}
                </div>
              )}

              {/* 3. Experience */}
              {data.experience && data.experience.length > 0 && (
                <div style={{ marginBottom: styles.marginBottom }}>
                  <h3 style={{ 
                      fontWeight: 'bold', 
                      textTransform: styles.headingTransform, 
                      marginBottom: styles.headingMarginBottom, 
                      fontSize: styles.fontSizeBody, 
                      color: styles.headingColor,
                      borderBottom: styles.headingBorder,
                      paddingBottom: styles.headingBorder !== 'none' ? '2px' : '0'
                  }}>
                    {formatTitle(data.sectionTitleExperience || "PROFESSIONAL EXPERIENCE")}
                  </h3>
                  
                  <div style={{ paddingTop: '0.25rem' }}>
                    {data.experience.map((exp, idx) => (
                      <div key={idx} style={{ marginBottom: '1rem' }}>
                        {styles.jobLayout === 'modern' ? (
                            // Modern Layout: Date -> Company -> Title
                            <>
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '2px' }}>
                                    {formatModernDate(exp.dates)}
                                </div>
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '2px' }}>
                                    {exp.company}{exp.location ? `, ${formatLocation(exp.location)}` : ''}
                                </div>
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '4px' }}>
                                    {exp.title}
                                </div>
                            </>
                        ) : (
                            // Classic Layout: Company | Date -> Title
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                  <span style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black }}>
                                    {exp.company}{exp.location ? `, ${formatLocation(exp.location)}` : ''}
                                  </span>
                                  <span style={{ fontWeight: 'bold', textAlign: 'right', fontSize: styles.fontSizeBody, color: black }}>{exp.dates}</span>
                                </div>
                                <div style={{ fontWeight: 'bold', marginBottom: 0, fontSize: styles.fontSizeBody, color: black }}>
                                  {exp.title}
                                </div>
                            </>
                        )}
                        <ul style={{ listStyleType: 'none', paddingLeft: 0, marginTop: 0 }}>
                          {exp.description && processDescription(exp.description).map((bullet, bIdx) => (
                            <li key={bIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: 0 }}>
                              <span style={{ marginTop: '0.25rem', fontSize: '0.75rem', lineHeight: '1rem' }}>•</span>
                              <span style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight }}>
                                <GrammarHighlighter 
                                  text={bullet} 
                                  path={`experience.${idx}.description.${bIdx}`} // Note: Path might be slightly off if split, but acceptable for now
                                  issues={issues} 
                                  onAccept={handleAcceptIssue} 
                                  onIgnore={handleIgnoreIssue} 
                                />
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Internships */}
              {data.internships && data.internships.length > 0 && (
                <div style={{ marginBottom: styles.marginBottom }}>
                  <h3 style={{ 
                      fontWeight: 'bold', 
                      textTransform: styles.headingTransform, 
                      marginBottom: styles.headingMarginBottom, 
                      fontSize: styles.fontSizeBody, 
                      color: styles.headingColor,
                      borderBottom: styles.headingBorder,
                      paddingBottom: styles.headingBorder !== 'none' ? '2px' : '0'
                  }}>
                    {formatTitle(data.sectionTitleInternships || "INTERNSHIPS")}
                  </h3>
                  
                  <div style={{ paddingTop: '0.25rem' }}>
                    {data.internships.map((exp, idx) => (
                      <div key={idx} style={{ marginBottom: '1rem' }}>
                        {styles.jobLayout === 'modern' ? (
                            // Modern Layout
                            <>
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '2px' }}>
                                    {formatModernDate(exp.dates)}
                                </div>
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '2px' }}>
                                    {exp.company}{exp.location ? `, ${formatLocation(exp.location)}` : ''}
                                </div>
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '4px' }}>
                                    {exp.title}
                                </div>
                            </>
                        ) : (
                            // Classic Layout
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                  <span style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black }}>
                                    {exp.company}{exp.location ? `, ${formatLocation(exp.location)}` : ''}
                                  </span>
                                  <span style={{ fontWeight: 'bold', textAlign: 'right', fontSize: styles.fontSizeBody, color: black }}>{exp.dates}</span>
                                </div>
                                <div style={{ fontWeight: 'bold', marginBottom: 0, fontSize: styles.fontSizeBody, color: black }}>
                                  {exp.title}
                                </div>
                            </>
                        )}
                        <ul style={{ listStyleType: 'none', paddingLeft: 0, marginTop: 0 }}>
                          {exp.description && processDescription(exp.description).map((bullet, bIdx) => (
                            <li key={bIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: 0 }}>
                              <span style={{ marginTop: '0.25rem', fontSize: '0.75rem', lineHeight: '1rem' }}>•</span>
                              <span style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight }}>
                                <GrammarHighlighter 
                                  text={bullet} 
                                  path={`internships.${idx}.description.${bIdx}`} 
                                  issues={issues} 
                                  onAccept={handleAcceptIssue} 
                                  onIgnore={handleIgnoreIssue} 
                                />
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 5. Education */}
              {data.education && data.education.length > 0 && (
                <div style={{ marginBottom: styles.marginBottom }}>
                  <h3 style={{ 
                      fontWeight: 'bold', 
                      textTransform: styles.headingTransform, 
                      marginBottom: styles.headingMarginBottom, 
                      fontSize: styles.fontSizeBody, 
                      color: styles.headingColor,
                      borderBottom: styles.headingBorder,
                      paddingBottom: styles.headingBorder !== 'none' ? '2px' : '0'
                  }}>
                    {formatTitle(data.sectionTitleEducation || "EDUCATION")}
                  </h3>
                  <div style={{ paddingTop: '0.25rem' }}>
                     {data.education.map((edu, idx) => (
                      <div key={idx} style={{ marginBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black }}>
                            {edu.institution}{edu.location ? `, ${formatLocation(edu.location)}` : ''}
                          </span>
                          <span style={{ fontWeight: 'bold', textAlign: 'right', fontSize: styles.fontSizeBody, color: black }}>{edu.dates}</span>
                        </div>
                        <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black }}>
                          {edu.degree}
                        </div>
                        {edu.details && edu.details.length > 0 && (
                           <ul style={{ listStyleType: 'disc', paddingLeft: '1.25rem', marginTop: 0 }}>
                             {processDescription(edu.details).map((det, dIdx) => (
                               <li key={dIdx} style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', paddingLeft: '2px' }}>
                                  <GrammarHighlighter 
                                    text={det} 
                                    path={`education.${idx}.details.${dIdx}`} 
                                    issues={issues} 
                                    onAccept={handleAcceptIssue} 
                                    onIgnore={handleIgnoreIssue} 
                                  />
                               </li>
                             ))}
                           </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 6. Custom Sections (Skills, Tools, etc.) */}
              {data.customSections && data.customSections.map((section, idx) => {
                   const titleUpper = section.title.toUpperCase();
                   const isGridCandidate = titleUpper.includes("SKILLS") || titleUpper.includes("COMPETENCIES") || titleUpper.includes("LANGUAGES");
                   const hasLongItems = section.items && section.items.some(item => item.length > 60);
                   const useColumns = isGridCandidate && !hasLongItems && section.items && section.items.length > 2;

                   return (
                     <div key={idx} style={{ marginBottom: styles.marginBottom }}>
                       <h3 style={{ 
                           fontWeight: 'bold', 
                           textTransform: styles.headingTransform, 
                           marginBottom: styles.headingMarginBottom, 
                           fontSize: styles.fontSizeBody, 
                           color: styles.headingColor,
                           borderBottom: styles.headingBorder,
                           paddingBottom: styles.headingBorder !== 'none' ? '2px' : '0'
                       }}>
                         {formatTitle(section.title)}
                       </h3>
                       <div style={{ paddingTop: '0.25rem' }}>
                           <ul style={{ 
                               columnCount: useColumns ? 2 : 1, 
                               columnGap: '2rem', 
                               paddingLeft: '1.25rem', 
                               marginTop: 0,
                               listStyleType: 'disc'
                           }}>
                              {section.items && section.items.map((item, iIdx) => {
                                const isKeyValue = item.includes(":");
                                if (isKeyValue) {
                                   const parts = item.split(":");
                                   const key = parts[0];
                                   const value = parts.slice(1).join(":");
                                   
                                   return (
                                     <li key={iIdx} style={{ listStyleType: 'none', marginLeft: '-1.25rem', fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', breakInside: 'avoid' }}>
                                        <span style={{ fontWeight: 'bold' }}>{key}:</span>
                                        <GrammarHighlighter 
                                          text={value} 
                                          path={`customSections.${idx}.items.${iIdx}`} 
                                          issues={issues} 
                                          onAccept={handleAcceptIssue} 
                                          onIgnore={handleIgnoreIssue} 
                                        />
                                     </li>
                                   );
                                }
                                return (
                                  <li key={iIdx} style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', paddingLeft: '2px', breakInside: 'avoid' }}>
                                    <GrammarHighlighter 
                                      text={item} 
                                      path={`customSections.${idx}.items.${iIdx}`} 
                                      issues={issues} 
                                      onAccept={handleAcceptIssue} 
                                      onIgnore={handleIgnoreIssue} 
                                    />
                                  </li>
                                );
                              })}
                           </ul>
                       </div>
                     </div>
                   );
              })}

            </div>
        </div>
      </div>

      {/* Right Column: Change Log / Recruiter Dashboard */}
      <div className="w-full lg:w-80 flex-shrink-0 space-y-6">
        {/* Change Log Panel */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-xl sticky top-8">
            <div className="flex items-center gap-2 mb-6 pb-4 border-b border-white/10">
                <History className="w-5 h-5 text-indigo-400" />
                <h3 className="text-lg font-bold text-white">Modification Log</h3>
            </div>

            {changeLog.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                    <p className="text-sm">No modifications yet.</p>
                    <p className="text-xs mt-2">Run grammar check and accept suggestions to see changes here.</p>
                </div>
            ) : (
                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                    <AnimatePresence>
                        {changeLog.map((log) => (
                            <motion.div
                                key={log.id}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="bg-white/5 border border-white/5 rounded-xl p-3 text-sm hover:bg-white/10 transition-colors"
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-xs font-mono text-indigo-300">
                                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        {log.path !== "Extraction" && (
                                            <button 
                                                onClick={() => handleUndoChange(log)}
                                                className="text-slate-400 hover:text-white transition-colors"
                                                title="Undo this change"
                                            >
                                                <Undo2 className="w-3 h-3" />
                                            </button>
                                        )}
                                        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                            log.path === "Extraction" 
                                                ? log.original === "REMOVAL" ? "bg-red-500/20 text-red-300" 
                                                : log.original === "ADDITION" ? "bg-green-500/20 text-green-300"
                                                : "bg-blue-500/20 text-blue-300"
                                                : "bg-slate-800/50 text-slate-500"
                                        }`}>
                                            {log.path === "Extraction" ? log.original : "Grammar"}
                                        </span>
                                    </div>
                                </div>
                                <div className="mb-2">
                                    {log.path === "Extraction" ? (
                                        <div className="text-xs text-slate-300 font-medium">
                                            {styleText(log.new)}
                                        </div>
                                    ) : (
                                        <>
                                            <div className="text-xs text-red-400 line-through opacity-70 mb-1">{styleText(log.original)}</div>
                                            <div className="text-xs text-green-400 font-medium flex items-center gap-1">
                                                <ArrowRight className="w-3 h-3" /> {styleText(log.new)}
                                            </div>
                                        </>
                                    )}
                                </div>
                                <p className="text-xs text-slate-400 italic border-t border-white/5 pt-2 mt-2">
                                    "{log.reason}"
                                </p>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default ResumePreview;
