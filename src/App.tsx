import React, { useState, useCallback } from 'react';
import { UploadCloud, FileText, Loader2, AlertTriangle, CheckCircle, Sparkles, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppState, ResumeData, ResumeFormat } from './types';
import { extractResumeData } from './services/geminiService';
import { generateResumeDoc } from './services/docxService';
import ResumePreview from './components/ResumePreview';
import FileSaver from 'file-saver';
import { LayoutTemplate } from 'lucide-react';
// @ts-ignore
import mammoth from 'mammoth';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [fileName, setFileName] = useState<string>('');
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [selectedFormat, setSelectedFormat] = useState<ResumeFormat>(ResumeFormat.CLASSIC_PROFESSIONAL);

  // Handle file input (drag & drop or click)
  const handleFileChange = useCallback(async (file: File) => {
    if (!file) return;

    setFileName(file.name);
    setErrorMsg('');
    setAppState(AppState.PROCESSING);

    try {
      // 1. DOCX Handling
      if (
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
        file.name.endsWith('.docx')
      ) {
        const arrayBuffer = await file.arrayBuffer();
        // Extract raw text from DOCX
        const result = await mammoth.extractRawText({ arrayBuffer });
        const text = result.value;
        if (!text || text.trim().length === 0) {
          throw new Error("Could not extract text from this Word document.");
        }
        const extractedData = await extractResumeData({ text, mimeType: 'text/plain', format: selectedFormat });
        setResumeData(extractedData);
        setAppState(AppState.REVIEW);
        return;
      }

      // 2. Text / RTF / Markdown Handling
      if (
        file.type === 'text/plain' || 
        file.type === 'text/markdown' || 
        file.name.endsWith('.txt') || 
        file.name.endsWith('.md') ||
        file.name.endsWith('.rtf')
      ) {
        const text = await file.text();
        const extractedData = await extractResumeData({ text, mimeType: 'text/plain', format: selectedFormat });
        setResumeData(extractedData);
        setAppState(AppState.REVIEW);
        return;
      }

      // 3. PDF / Image Handling (Base64)
      const validVisualTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      if (validVisualTypes.includes(file.type)) {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => {
            const result = reader.result as string;
            // Remove Data URL prefix (e.g., "data:application/pdf;base64,")
            const base64 = result.split(',')[1];
            resolve(base64);
          };
          reader.onerror = (error) => reject(error);
        });

        const extractedData = await extractResumeData({ base64: base64Data, mimeType: file.type, format: selectedFormat });
        setResumeData(extractedData);
        setAppState(AppState.REVIEW);
        return;
      }

      // 4. Unsupported
      throw new Error("Unsupported file format. Please upload DOCX, PDF, Text, or Image files. (Legacy .doc files should be converted to .docx)");

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Failed to process the resume. Please check your API key or try a different file.");
      setAppState(AppState.ERROR);
    }
  }, []);

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleDownload = async () => {
    if (!resumeData) return;
    try {
      const blob = await generateResumeDoc(resumeData, selectedFormat);
      FileSaver.saveAs(blob, `Formatted_${fileName.replace(/\.[^/.]+$/, "")}.docx`);
    } catch (err) {
      console.error(err);
      alert("Failed to generate DOCX file.");
    }
  };

  const handleReset = () => {
    setAppState(AppState.IDLE);
    setResumeData(null);
    setFileName('');
    setErrorMsg('');
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans selection:bg-indigo-500/30">
      {/* Ambient Background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-violet-600/20 blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center py-16 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="text-center mb-16 max-w-3xl"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-6">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-medium text-indigo-200 tracking-wide uppercase">Next-Gen Resume Intelligence</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-slate-400">
            ArthFormat AI
          </h1>
          
          <p className="text-xl text-slate-400 font-light tracking-wide">
            "Resumes Reimagined, Precision Personified."
          </p>
        </motion.div>

        {/* Format Selection (Main Page) */}
        {appState === AppState.IDLE && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center mb-8"
          >
            <label className="text-slate-400 text-sm mb-3 font-medium uppercase tracking-widest">Select Target Format</label>
            <div className="flex gap-4">
              <button 
                onClick={() => setSelectedFormat(ResumeFormat.CLASSIC_PROFESSIONAL)}
                className={`px-6 py-3 rounded-xl border transition-all flex items-center gap-2 ${selectedFormat === ResumeFormat.CLASSIC_PROFESSIONAL ? 'bg-indigo-500/20 border-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'}`}
              >
                <LayoutTemplate className="w-4 h-4" />
                Classic Professional
              </button>
              <button 
                onClick={() => setSelectedFormat(ResumeFormat.MODERN_EXECUTIVE)}
                className={`px-6 py-3 rounded-xl border transition-all flex items-center gap-2 ${selectedFormat === ResumeFormat.MODERN_EXECUTIVE ? 'bg-indigo-500/20 border-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'}`}
              >
                <Sparkles className="w-4 h-4" />
                Modern Executive
              </button>
            </div>
          </motion.div>
        )}

        {/* Main Content Area */}
        <div className="w-full max-w-5xl">
          <AnimatePresence mode="wait">
            {(appState === AppState.IDLE || appState === AppState.ERROR) && (
              <motion.div 
                key="upload"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4 }}
                className="relative group"
              >
                <div 
                  className={`
                    relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-12 md:p-20
                    flex flex-col items-center justify-center text-center transition-all duration-300
                    ${dragActive ? 'border-indigo-500/50 bg-indigo-500/10' : 'hover:border-white/20 hover:bg-white/10'}
                  `}
                  onDragEnter={onDragEnter}
                  onDragLeave={onDragLeave}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                >
                  <input
                    type="file"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                    onChange={(e) => e.target.files && handleFileChange(e.target.files[0])}
                    accept=".pdf,.docx,.txt,.rtf,.png,.jpg,.jpeg,.webp"
                  />
                  
                  <div className="relative z-10 mb-8">
                    <div className="w-24 h-24 rounded-2xl bg-gradient-to-tr from-indigo-500 to-violet-500 p-[1px]">
                      <div className="w-full h-full rounded-2xl bg-[#0f172a] flex items-center justify-center">
                        <UploadCloud className="w-10 h-10 text-indigo-400" />
                      </div>
                    </div>
                    {/* Glow effect */}
                    <div className="absolute inset-0 bg-indigo-500/30 blur-2xl -z-10" />
                  </div>
                  
                  <h3 className="text-2xl font-semibold text-white mb-3">
                    Drop your resume here
                  </h3>
                  <p className="text-slate-400 mb-8 max-w-md mx-auto font-light">
                    Supports Word, PDF, Text, or Images. We'll handle the rest with pixel-perfect precision.
                  </p>
                  
                  <button className="px-8 py-3 bg-white text-slate-900 font-semibold rounded-xl hover:bg-indigo-50 transition-colors flex items-center gap-2 group-hover:scale-105 duration-200">
                    Browse Files <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                {errorMsg && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3 backdrop-blur-md"
                  >
                    <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-200">{errorMsg}</p>
                  </motion.div>
                )}
              </motion.div>
            )}

            {appState === AppState.PROCESSING && (
              <motion.div 
                key="processing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-20 flex flex-col items-center justify-center text-center min-h-[500px]"
              >
                 <div className="relative mb-8">
                    <div className="w-24 h-24 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <FileText className="w-8 h-8 text-indigo-400" />
                    </div>
                 </div>
                 <h2 className="text-3xl font-bold text-white mb-4">Analyzing Structure</h2>
                 <p className="text-slate-400 max-w-md animate-pulse font-light">
                   ArthFormat AI is deconstructing your document layout and extracting semantic data...
                 </p>
              </motion.div>
            )}

            {appState === AppState.REVIEW && resumeData && (
              <motion.div 
                key="review"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <ResumePreview 
                  key={fileName}
                  data={resumeData} 
                  onDownload={() => {}} // Download handled internally by ResumePreview
                  onReset={handleReset} 
                  onUpdate={setResumeData}
                  selectedFormat={selectedFormat}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        {/* Footer */}
        <footer className="mt-24 text-center">
          <p className="text-sm text-slate-500 font-mono">
            ArthFormat AI &bull; Powered by Gemini 3 Pro &bull; Secure Client-Side Processing
          </p>
        </footer>
      </div>
    </div>
  );
};

export default App;