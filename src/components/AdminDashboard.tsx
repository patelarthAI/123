import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, XCircle, Clock, FileText, AlertTriangle, LogOut } from 'lucide-react';
import Login from './Login';

interface PendingResume {
  id: string;
  user_id: string;
  content: any;
  status: string;
  created_at: string;
}

const AdminDashboard: React.FC = () => {
  const [adminPassword, setAdminPassword] = useState<string | null>(() => {
    return localStorage.getItem('adminPassword');
  });
  const [resumes, setResumes] = useState<PendingResume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (adminPassword) {
      fetchPendingResumes();
    } else {
      setLoading(false);
    }
  }, [adminPassword]);

  const handleLoginSuccess = (password: string) => {
    localStorage.setItem('adminPassword', password);
    setAdminPassword(password);
  };

  const handleLogout = () => {
    localStorage.removeItem('adminPassword');
    setAdminPassword(null);
  };

  const fetchPendingResumes = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/resumes/pending', {
        headers: {
          'x-admin-password': adminPassword || ''
        }
      });
      if (!response.ok) {
        if (response.status === 401) {
          handleLogout();
          throw new Error('Unauthorized. Please log in again.');
        }
        let errorMessage = 'Failed to fetch pending resumes';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          errorMessage = `Server error (${response.status}). Please try again later.`;
        }
        throw new Error(errorMessage);
      }
      const data = await response.json();
      setResumes(data.resumes || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (resumeId: string, content: any) => {
    if (!adminPassword) return;
    
    try {
      // 1. Approve in DB
      const response = await fetch('/api/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify({ resumeId }),
      });

      if (!response.ok) {
        if (response.status === 401) handleLogout();
        let errorMessage = 'Failed to approve resume';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          errorMessage = `Server error (${response.status}). Please try again later.`;
        }
        throw new Error(errorMessage);
      }

      // Remove the approved resume from the list
      setResumes(resumes.filter(r => r.id !== resumeId));
      
      alert('Resume approved! Formatting will now begin in the background (check console).');

      // 2. Trigger Formatting (Client-side for now, using Gemini)
      // We dynamically import to avoid circular dependencies or loading it if not needed
      const { extractResumeData } = await import('@/services/geminiService');
      const { ResumeFormat } = await import('@/types');
      
      console.log('Starting formatting for resume:', resumeId);
      const formattedData = await extractResumeData({
        text: content.text,
        base64: content.base64,
        mimeType: content.mimeType,
        format: ResumeFormat.CLASSIC_PROFESSIONAL // Defaulting to classic
      }, false);

      console.log('Successfully formatted resume:', formattedData);
      
      // 3. Save formatted data back to DB (optional, assuming a route exists or just logging for now)
      // await fetch('/api/resumes/save-formatted', ...)

    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!adminPassword) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (error) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5" />
        <div>
          <h3 className="text-red-200 font-semibold">Error loading dashboard</h3>
          <p className="text-red-200/70 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">Manage pending resume submissions</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-medium text-slate-200">{resumes.length} Pending</span>
          </div>
          <button 
            onClick={handleLogout}
            className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-slate-300 transition-colors"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {resumes.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-white mb-2">All caught up!</h3>
          <p className="text-slate-400">There are no pending resumes to review.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {resumes.map((resume) => (
            <motion.div
              key={resume.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 border border-white/10 rounded-xl p-6 flex items-center justify-between group hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h4 className="text-white font-medium">Resume Submission</h4>
                  <div className="flex items-center gap-3 text-sm text-slate-400 mt-1">
                    <span>ID: {resume.id.substring(0, 8)}...</span>
                    <span>•</span>
                    <span>{new Date(resume.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleApprove(resume.id, resume.content)}
                  className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-sm font-medium rounded-lg transition-colors border border-emerald-500/30 flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  Approve & Format
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
