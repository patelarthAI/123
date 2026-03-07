import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppState, ResumeData, ResumeFormat } from '@/types';
import { extractResumeData, getUsageStats } from '@/services/geminiService';
import { generateResumeDoc } from '@/services/docxService';
import ResumePreview from '@/components/ResumePreview';
import { saveAs } from 'file-saver';
import { 
  LayoutTemplate, 
  Activity, 
  Database, 
  ShieldCheck, 
  UploadCloud, 
  FileText, 
  Loader2, 
  AlertTriangle, 
  CheckCircle, 
  Sparkles, 
  ArrowRight,
  Lock,
  KeyRound,
  ShieldAlert,
  Settings,
  Clock,
  Check,
  X,
  LogIn,
  LogOut
} from 'lucide-react';
import * as mammoth from 'mammoth';

interface StagedContent {
  text?: string;
  base64?: string;
  mimeType: string;
}

interface PendingResume {
  id: string;
  fileName: string;
  content: StagedContent;
  format: ResumeFormat;
  submittedAt: string;
}

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [fileName, setFileName] = useState<string>('');
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [selectedFormat, setSelectedFormat] = useState<ResumeFormat>(ResumeFormat.CLASSIC_PROFESSIONAL);
  const [usePro, setUsePro] = useState<boolean>(false);
  const [stats, setStats] = useState(getUsageStats(usePro));
  const [stagedContent, setStagedContent] = useState<StagedContent | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [quoteIndex, setQuoteIndex] = useState(0);

  const WAITING_QUOTES = [
    "Great resumes take time. We're making sure yours is perfect.",
    "Did you know? Recruiters spend an average of 7 seconds looking at a resume.",
    "A well-formatted resume increases your chances of getting an interview by 40%.",
    "We're analyzing your experience to highlight your best achievements.",
    "Almost there! Our admin is reviewing your request.",
    "Formatting your skills to stand out from the crowd."
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (appState === AppState.WAITING_APPROVAL) {
      interval = setInterval(() => {
        setQuoteIndex((prev) => (prev + 1) % WAITING_QUOTES.length);
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [appState]);
  const [isAdminMode, setIsAdminMode] = useState<boolean>(false);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState<boolean>(false);
  const [isValidatingAdmin, setIsValidatingAdmin] = useState<boolean>(false);
  const [adminPassword, setAdminPassword] = useState<string>('');
  const [pendingResumes, setPendingResumes] = useState<PendingResume[]>([]);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [adminError, setAdminError] = useState<string>('');
  const [isApproving, setIsApproving] = useState<string | null>(null);
  const [adminStats, setAdminStats] = useState({ approvedToday: 0, declinedToday: 0, approvedMonth: 0, declinedMonth: 0 });
  const [adminConfig, setAdminConfig] = useState<any>(null);

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(data => console.log('Backend Health:', data))
      .catch(err => console.error('Backend Health Check Failed:', err));
  }, []);

  useEffect(() => {
    if (isAdminMode && !isAdminLoggedIn) {
      const token = localStorage.getItem('adminToken');
      if (token) {
        setIsValidatingAdmin(true);
        fetch('/api/admin/stats', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => {
          if (res.ok) {
            setIsAdminLoggedIn(true);
          } else {
            localStorage.removeItem('adminToken');
          }
        })
        .catch(() => localStorage.removeItem('adminToken'))
        .finally(() => setIsValidatingAdmin(false));
      }
    }
  }, [isAdminMode]);

  useEffect(() => {
    if (isAdminLoggedIn) {
      fetchPendingResumes();
      fetchAdminStats();
      fetchAdminConfig();
    }
  }, [isAdminLoggedIn]);

  const fetchAdminConfig = async () => {
    const token = localStorage.getItem('adminToken');
    if (!token) return;
    try {
      const res = await fetch('/api/admin/config', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setAdminConfig(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch admin config", err);
    }
  };

  const fetchAdminStats = async () => {
    const token = localStorage.getItem('adminToken');
    if (!token) return;
    try {
      const res = await fetch('/api/admin/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setAdminStats(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch admin stats", err);
    }
  };

  const fetchPendingResumes = async () => {
    const token = localStorage.getItem('adminToken');
    if (!token) return;

    try {
      const res = await fetch('/api/admin/pending', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) {
        handleAdminLogout();
        return;
      }
      const data = await res.json();
      setPendingResumes(data);
    } catch (err) {
      console.error("Failed to fetch pending resumes", err);
    }
  };

  // Handle file input (drag & drop or click)
  const handleFileChange = useCallback(async (file: File) => {
    if (!file) return;

    setFileName(file.name);
    setErrorMsg('');
    setAppState(AppState.STAGING);

    try {
      // 1. DOCX Handling
      if (
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
        file.name.endsWith('.docx')
      ) {
        const arrayBuffer = await file.arrayBuffer();
        const mammothInstance = (mammoth as any).default || mammoth;
        const result = await mammothInstance.extractRawText({ arrayBuffer });
        const text = result.value;
        if (!text || text.trim().length === 0) {
          throw new Error("Could not extract text from this Word document.");
        }
        setStagedContent({ text, mimeType: 'text/plain' });
        return;
      }

      // 1.5. Legacy .doc Handling (Server-side)
      if (
        file.type === 'application/msword' || 
        file.name.endsWith('.doc')
      ) {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/api/extract-doc', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to extract text from .doc file.");
        }

        const { text } = await response.json();
        setStagedContent({ text, mimeType: 'text/plain' });
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
        setStagedContent({ text, mimeType: 'text/plain' });
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
            const base64 = result.split(',')[1];
            resolve(base64);
          };
          reader.onerror = (error) => reject(error);
        });

        setStagedContent({ base64: base64Data, mimeType: file.type });
        return;
      }

      throw new Error("Unsupported file format. Please upload DOCX, DOC, PDF, Text, or Image files.");

    } catch (err: any) {
      console.error("Extraction Error:", err);
      setErrorMsg(err.message || "Failed to process the resume.");
      setAppState(AppState.ERROR);
    }
  }, [selectedFormat, usePro]);

  const handleSubmitForApproval = async () => {
    if (!stagedContent) return;
    
    setAppState(AppState.PROCESSING);
    try {
      const res = await fetch('/api/admin/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          content: stagedContent,
          format: selectedFormat
        })
      });
      
      if (res.ok) {
        const { id } = await res.json();
        setPendingRequestId(id);
        setAppState(AppState.WAITING_APPROVAL);
      } else {
        throw new Error("Failed to submit for approval");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
      setAppState(AppState.ERROR);
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (appState === AppState.WAITING_APPROVAL && pendingRequestId) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/request/${pendingRequestId}/status`);
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'APPROVED') {
              clearInterval(interval);
              setAppState(AppState.PROCESSING);
              processApprovedResume();
            } else if (data.status === 'REJECTED') {
              clearInterval(interval);
              setAppState(AppState.ERROR);
              setErrorMsg("Your resume formatting request was declined by the administrator.");
              setPendingRequestId(null);
            }
          }
        } catch (err) {
          console.error("Polling error", err);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [appState, pendingRequestId]);

  const processApprovedResume = async () => {
    if (!stagedContent) return;
    try {
      const extractedData = await extractResumeData({ 
        text: stagedContent.text,
        base64: stagedContent.base64,
        mimeType: stagedContent.mimeType, 
        format: selectedFormat
      }, usePro);

      setResumeData(extractedData);
      setAppState(AppState.REVIEW);
    } catch (err: any) {
      setErrorMsg(err.message);
      setAppState(AppState.ERROR);
    } finally {
      setPendingRequestId(null);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setAdminError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('adminToken', data.token);
        setIsAdminLoggedIn(true);
        setAdminPassword('');
      } else {
        setAdminError(data.error);
      }
    } catch (err) {
      setAdminError("Login failed");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleAdminLogout = () => {
    localStorage.removeItem('adminToken');
    setIsAdminLoggedIn(false);
    setPendingResumes([]);
  };

  const handleApprove = async (pending: PendingResume) => {
    const token = localStorage.getItem('adminToken');
    if (!token) return;

    setIsApproving(pending.id);
    try {
      // 1. Mark as approved in backend
      const res = await fetch('/api/admin/approve', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id: pending.id })
      });
      
      if (!res.ok) throw new Error("Approval failed");
      
      // The user's browser will poll and handle the formatting
    } catch (err: any) {
      alert("Error during approval: " + err.message);
    } finally {
      setIsApproving(null);
      fetchPendingResumes();
      fetchAdminStats();
    }
  };

  const handleReject = async (id: string) => {
    const token = localStorage.getItem('adminToken');
    if (!token) return;

    if (!confirm("Are you sure you want to reject this resume?")) return;
    try {
      await fetch('/api/admin/reject', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id })
      });
      fetchPendingResumes();
      fetchAdminStats();
    } catch (err) {
      console.error(err);
    }
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleReset = () => {
    if (pendingRequestId) {
      fetch(`/api/request/${pendingRequestId}/cancel`, { method: 'POST' }).catch(console.error);
    }
    setAppState(AppState.IDLE);
    setResumeData(null);
    setFileName('');
    setErrorMsg('');
    setPendingRequestId(null);
  };

  if (isAdminMode) {
    return (
      <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans p-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-12">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-indigo-500/20 rounded-xl flex items-center justify-center border border-indigo-500/30">
                <Settings className="w-6 h-6 text-indigo-400" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">Admin Portal</h1>
                <p className="text-slate-400 text-sm">Review and approve resume formatting requests</p>
              </div>
            </div>
            <button 
              onClick={() => setIsAdminMode(false)}
              className="px-6 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-bold transition-all"
            >
              Exit Admin
            </button>
          </div>

          {!isAdminLoggedIn ? (
            <div className="max-w-md mx-auto mt-20">
              {isValidatingAdmin ? (
                <div className="flex flex-col items-center justify-center p-12">
                  <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-4" />
                  <p className="text-slate-400">Verifying session...</p>
                </div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl"
                >
                <div className="flex flex-col items-center mb-8">
                  <div className="w-16 h-16 bg-indigo-500/10 rounded-2xl flex items-center justify-center mb-4 border border-indigo-500/20">
                    <Lock className="w-8 h-8 text-indigo-400" />
                  </div>
                  <h2 className="text-xl font-bold text-white">Admin Login</h2>
                </div>
                <form onSubmit={handleAdminLogin} className="space-y-6">
                  <div className="relative">
                    <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                    <input 
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="Enter Admin Password"
                      className="w-full bg-zinc-950/50 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                      autoFocus
                    />
                  </div>
                  {adminError && <p className="text-red-400 text-xs text-center">{adminError}</p>}
                  <button 
                    type="submit"
                    disabled={isLoggingIn}
                    className="w-full py-4 bg-indigo-500 hover:bg-indigo-400 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    {isLoggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : <><LogIn className="w-5 h-5" /> Login</>}
                  </button>
                </form>
              </motion.div>
              )}
            </div>
          ) : (
            <div className="grid gap-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="flex justify-between items-center bg-white/5 border border-white/10 rounded-2xl p-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-500/10 rounded-xl">
                      <Clock className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div>
                      <span className="text-2xl font-bold text-white">{pendingResumes.length}</span>
                      <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Pending</p>
                    </div>
                  </div>
                </div>
                
                <div className="flex justify-between items-center bg-white/5 border border-white/10 rounded-2xl p-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/10 rounded-xl">
                      <CheckCircle className="w-6 h-6 text-indigo-400" />
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-white">{adminStats.approvedToday}</span>
                        <span className="text-xs text-slate-500">today</span>
                      </div>
                      <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Approved ({adminStats.approvedMonth} this month)</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center bg-white/5 border border-white/10 rounded-2xl p-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-red-500/10 rounded-xl">
                      <X className="w-6 h-6 text-red-400" />
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-white">{adminStats.declinedToday}</span>
                        <span className="text-xs text-slate-500">today</span>
                      </div>
                      <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Declined ({adminStats.declinedMonth} this month)</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center mb-6">
                {adminConfig && (
                  <div className="text-xs text-slate-500 flex items-center gap-2">
                    <KeyRound className="w-3 h-3" />
                    API Key: <span className="font-mono text-slate-400">{adminConfig.apiKey}</span>
                  </div>
                )}
                <button 
                  onClick={handleAdminLogout}
                  className="flex items-center gap-2 text-slate-500 hover:text-red-400 transition-colors text-sm font-bold ml-auto"
                >
                  <LogOut className="w-4 h-4" /> Logout
                </button>
              </div>

              <div className="grid gap-4">
                {pendingResumes.length === 0 ? (
                  <div className="text-center py-20 bg-white/5 border border-white/10 rounded-3xl">
                    <CheckCircle className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                    <p className="text-slate-400">No pending resumes for approval.</p>
                  </div>
                ) : (
                  pendingResumes.map((pending) => (
                    <motion.div 
                      key={pending.id}
                      layoutId={pending.id}
                      className="bg-slate-900/50 border border-white/10 rounded-2xl p-6 flex items-center justify-between group hover:border-indigo-500/30 transition-all"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                          <FileText className="w-6 h-6 text-indigo-400" />
                        </div>
                        <div>
                          <h3 className="font-bold text-white">{pending.fileName}</h3>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full uppercase font-bold tracking-tighter">
                              {pending.format}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {new Date(pending.submittedAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => handleReject(pending.id)}
                          className="p-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-all"
                          title="Reject"
                        >
                          <X className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => handleApprove(pending)}
                          disabled={!!isApproving}
                          className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-emerald-500/10 active:scale-[0.98] disabled:opacity-50"
                        >
                          {isApproving === pending.id ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <>
                              <Check className="w-5 h-5" />
                              Approve & Format
                            </>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans selection:bg-indigo-500/30">
      {/* Ambient Background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-violet-600/20 blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center py-16 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="absolute top-6 right-6 z-50">
          <button 
              onClick={() => setIsAdminMode(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold text-slate-300 transition-all"
          >
              <Settings className="w-4 h-4 text-indigo-400" />
              Admin Portal
          </button>
        </div>

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

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => setUsePro(!usePro)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${usePro ? 'bg-amber-500/20 border-amber-500 text-amber-200 shadow-lg shadow-amber-500/20' : 'bg-white/5 border-white/10 text-slate-500 hover:bg-white/10'}`}
              >
                <Database className={`w-4 h-4 ${usePro ? 'text-amber-400' : 'text-slate-500'}`} />
                <span className="text-xs font-bold uppercase tracking-wider">
                  {usePro ? "Pro Mode Active (Gemini 3.1 Pro)" : "Standard Mode (Gemini 3 Flash)"}
                </span>
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
                    <div className="absolute inset-0 bg-indigo-500/30 blur-2xl -z-10" />
                  </div>
                  
                  <h3 className="text-2xl font-semibold text-white mb-3">
                    Drop your resume here
                  </h3>
                  <p className="text-slate-400 mb-8 max-w-md mx-auto font-light">
                    Supports Word (.docx, .doc), PDF, Text, or Images. We'll handle the rest with pixel-perfect precision.
                  </p>
                  
                  <button className="px-8 py-3 bg-white text-slate-900 font-semibold rounded-xl hover:bg-indigo-50 transition-colors flex items-center gap-2 group-hover:scale-105 duration-200">
                    Browse Files <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                {errorMsg && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 p-6 bg-red-500/10 border border-red-500/20 rounded-2xl flex flex-col gap-4 backdrop-blur-md"
                  >
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="flex flex-col gap-1">
                        <h4 className="font-bold text-red-200">Processing Issue</h4>
                        <p className="text-sm text-red-100/80 leading-relaxed">{errorMsg}</p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button 
                        onClick={handleReset}
                        className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs font-bold uppercase tracking-widest rounded-lg transition-colors border border-red-500/30"
                      >
                        Try Another File
                      </button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {appState === AppState.STAGING && (
              <motion.div 
                key="staging"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-12 flex flex-col items-center text-center"
              >
                <div className="w-20 h-20 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-6 border border-emerald-500/20">
                  <CheckCircle className="w-10 h-10 text-emerald-400" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">File Ready for Approval</h2>
                <p className="text-slate-400 mb-8 max-w-sm">
                  Document <span className="text-indigo-300 font-mono">"{fileName}"</span> has been prepared. 
                  Submit it to the Admin Portal for approval and formatting.
                </p>
                
                <div className="flex gap-4">
                  <button 
                    onClick={handleReset}
                    className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-semibold rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSubmitForApproval}
                    className="px-10 py-3 bg-indigo-500 hover:bg-indigo-400 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2 active:scale-[0.98]"
                  >
                    <ArrowRight className="w-5 h-5" />
                    Submit for Approval
                  </button>
                </div>
              </motion.div>
            )}

            {appState === AppState.WAITING_APPROVAL && (
              <motion.div 
                key="waiting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-20 flex flex-col items-center justify-center text-center min-h-[500px]"
              >
                 <div className="relative mb-8">
                    <div className="w-24 h-24 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Clock className="w-8 h-8 text-amber-400" />
                    </div>
                 </div>
                 <h2 className="text-3xl font-bold text-white mb-4">Waiting for Admin Approval</h2>
                 <p className="text-slate-400 max-w-md font-light mb-6">
                   Your resume has been submitted. Please wait while an administrator reviews your request. Formatting will begin automatically once approved.
                 </p>
                 
                 <div className="h-16 flex items-center justify-center">
                   <AnimatePresence mode="wait">
                     <motion.p
                       key={quoteIndex}
                       initial={{ opacity: 0, y: 10 }}
                       animate={{ opacity: 1, y: 0 }}
                       exit={{ opacity: 0, y: -10 }}
                       className="text-indigo-300 italic text-sm max-w-sm"
                     >
                       "{WAITING_QUOTES[quoteIndex]}"
                     </motion.p>
                   </AnimatePresence>
                 </div>

                 <button 
                   onClick={handleReset}
                   className="mt-8 px-6 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-bold text-slate-300 transition-all"
                 >
                   Cancel Request
                 </button>
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
                 <h2 className="text-3xl font-bold text-white mb-4">Submitting Request</h2>
                 <p className="text-slate-400 max-w-md animate-pulse font-light">
                   Your resume is being securely transferred to the Admin Portal for review...
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
                  onDownload={() => {}} 
                  onReset={handleReset} 
                  onUpdate={setResumeData}
                  selectedFormat={selectedFormat}
                  usePro={usePro}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default App;
