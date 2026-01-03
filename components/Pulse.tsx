import React, { useState, useEffect, useRef } from 'react';
import { 
  LineChart, Line, Tooltip, ResponsiveContainer 
} from 'recharts';
import { 
  AlertTriangle, Plus, Sparkles, Calendar as CalendarIcon, 
  List, Clock, Sun, Moon, ChevronLeft, ChevronRight, Save, CheckCircle2, ChevronDown, ChevronUp, FileText, Send, MessageSquare, X, Loader2, User as UserIcon, Activity, BarChart3, MoreVertical
} from 'lucide-react';
import { DailyLog, LogEntry, ChatMessage } from '../types';
import { generateManagerSummary, generateWeeklyReport, queryTeamLogs } from '../services/geminiService';

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
};

const formatShortDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const generateMockLogs = (): DailyLog[] => {
  const logs: DailyLog[] = [];
  const users = ['Sarah', 'Mike', 'Jessica', 'David'];
  const today = new Date();
  
  for (let i = 0; i < 21; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    users.forEach((user, idx) => {
      if (Math.random() > 0.8 && i > 0) return; 

      logs.push({
        id: `${dateStr}-${idx}`,
        userId: `u${idx}`,
        userName: user,
        date: dateStr,
        checkIn: {
          tasks: 'Developing core alignment engine features and optimizing token consumption for the next sprint.',
          blockers: Math.random() > 0.9 ? 'Legacy API rate limits' : '',
          energyLevel: Math.floor(Math.random() * 5) + 5,
          timestamp: new Date(dateStr).setHours(9, 15, 0),
          status: 'submitted'
        },
        checkOut: i === 0 && Math.random() > 0.3 ? undefined : { 
          tasks: 'Finished implementation of the RAG pipeline and pushed to staging. Documentation updated.',
          blockers: '',
          workDurationMinutes: 480 - Math.floor(Math.random() * 60),
          timestamp: new Date(dateStr).setHours(17, 30, 0),
          status: 'submitted'
        }
      });
    });
  }
  return logs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

const MOCK_LOGS_INITIAL = generateMockLogs();

const SENTIMENT_DATA = [
  { day: 'Mon', score: 7.5, votes: 12 },
  { day: 'Tue', score: 6.8, votes: 15 },
  { day: 'Wed', score: 7.2, votes: 14 },
  { day: 'Thu', score: 5.4, votes: 13 },
  { day: 'Fri', score: 6.1, votes: 16 },
];

export const Pulse: React.FC = () => {
  const [logs, setLogs] = useState<DailyLog[]>(MOCK_LOGS_INITIAL);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [logType, setLogType] = useState<'check-in' | 'check-out' | null>(null);
  const [selectedLog, setSelectedLog] = useState<DailyLog | null>(null);
  const [showManagerChat, setShowManagerChat] = useState<boolean>(false);
  const [showUserReport, setShowUserReport] = useState<string | null>(null);
  const [showAskMenu, setShowAskMenu] = useState(false);
  
  const [formData, setFormData] = useState({ tasks: '', blockers: '', energy: 5, duration: 0 });
  const [summary, setSummary] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const todayStr = new Date().toISOString().split('T')[0];
  const todayLogs = logs.filter(l => l.date === todayStr);
  const checkedInCount = todayLogs.filter(l => l.checkIn).length;
  const checkedOutCount = todayLogs.filter(l => l.checkOut).length;

  const handleGenerateSummary = async () => {
    setIsGenerating(true);
    const result = await generateManagerSummary(logs.slice(0, 15)); 
    setSummary(result);
    setIsGenerating(false);
  };

  const handleLogSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert(`Update submitted successfully!`);
    setLogType(null);
    setFormData({ tasks: '', blockers: '', energy: 5, duration: 0 });
  };

  return (
    <div className="flex-1 h-screen overflow-y-auto bg-slate-50 p-4 md:p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight text-nexus-900">The Pulse</h2>
          <p className="text-slate-500 font-medium">Alignment Monitoring & Insights</p>
        </div>
        
        <div className="flex flex-wrap gap-2 relative">
           <div className="relative">
             <button 
               onClick={() => setShowAskMenu(!showAskMenu)}
               className="flex items-center px-4 py-2 bg-nexus-primary text-white hover:bg-nexus-primaryHover rounded-xl transition shadow-lg shadow-nexus-primary/20 font-bold text-sm"
             >
               <Sparkles className="w-4 h-4 mr-2" />
               Ask AI <ChevronDown className={`w-4 h-4 ml-1 transition ${showAskMenu ? 'rotate-180' : ''}`} />
             </button>
             {showAskMenu && (
               <div className="absolute top-full right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 p-2 animate-in slide-in-from-top-2">
                 <button onClick={() => { setShowManagerChat(true); setShowAskMenu(false); }} className="w-full text-left p-3 hover:bg-slate-50 rounded-lg flex items-center gap-3 transition">
                   <Activity className="w-4 h-4 text-nexus-primary" />
                   <div className="flex flex-col"><span className="text-sm font-bold">General Query</span><span className="text-[10px] text-slate-400">Ask about any team metrics</span></div>
                 </button>
                 <button onClick={() => { setShowManagerChat(true); setShowAskMenu(false); }} className="w-full text-left p-3 hover:bg-slate-50 rounded-lg flex items-center gap-3 transition">
                   <CalendarIcon className="w-4 h-4 text-purple-500" />
                   <div className="flex flex-col"><span className="text-sm font-bold">Weekly Review</span><span className="text-[10px] text-slate-400">Generate team week summary</span></div>
                 </button>
                 <button onClick={() => { setShowManagerChat(true); setShowAskMenu(false); }} className="w-full text-left p-3 hover:bg-slate-50 rounded-lg flex items-center gap-3 transition border-t border-slate-100 mt-1">
                   <Clock className="w-4 h-4 text-blue-500" />
                   <div className="flex flex-col"><span className="text-sm font-bold">Daily Review</span><span className="text-[10px] text-slate-400">Flash summary of today</span></div>
                 </button>
               </div>
             )}
           </div>

           <button 
             onClick={() => setLogType('check-in')}
             className="flex items-center px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:border-nexus-primary hover:text-nexus-primary rounded-xl transition shadow-sm font-bold text-sm"
           >
             <Sun className="w-4 h-4 mr-2 text-yellow-500" /> Start Day
           </button>
           <button 
             onClick={() => setLogType('check-out')}
             className="flex items-center px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:border-nexus-primary hover:text-nexus-primary rounded-xl transition shadow-sm font-bold text-sm"
           >
             <Moon className="w-4 h-4 mr-2 text-indigo-500" /> End Day
           </button>
        </div>
      </div>

      {/* Stats Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Check-ins</h3>
            <p className="text-3xl font-bold text-slate-900">{checkedInCount}</p>
            <p className="text-xs text-slate-500 mt-1">Total today</p>
        </div>
        <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Log-offs</h3>
            <p className="text-3xl font-bold text-slate-900">{checkedOutCount}</p>
            <p className="text-xs text-slate-500 mt-1">{checkedInCount - checkedOutCount} active now</p>
        </div>
        <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-sm col-span-2 md:col-span-1">
          <div className="flex justify-between items-center mb-1">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Energy</h3>
            <span className="text-[10px] font-bold text-nexus-primary bg-indigo-50 px-1.5 rounded-full">{SENTIMENT_DATA[SENTIMENT_DATA.length-1].votes} voted</span>
          </div>
          <div className="h-10 w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={SENTIMENT_DATA}>
                <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="p-6 bg-red-50 border border-red-100 rounded-3xl shadow-sm col-span-2 md:col-span-1">
           <h3 className="text-xs font-bold text-red-400 uppercase tracking-widest mb-1">Blockers</h3>
           <p className="text-3xl font-bold text-red-700">{logs.filter(l => l.date === todayStr && l.checkIn?.blockers).length}</p>
        </div>
      </div>

      {/* Daily Intelligence Brief */}
      <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-[1px] rounded-[32px] shadow-xl">
        <div className="bg-white rounded-[31px] p-6 md:p-8">
           <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <div className="flex items-center gap-4">
                 <div className="p-3 bg-indigo-50 rounded-2xl text-nexus-primary">
                    <Sparkles className="w-6 h-6" />
                 </div>
                 <div>
                    <h3 className="text-xl font-bold text-slate-900">Intelligence Briefing</h3>
                    <p className="text-sm text-slate-500 font-medium">Real-time team performance synthesis</p>
                 </div>
              </div>
              <button 
                onClick={handleGenerateSummary}
                disabled={isGenerating}
                className="px-6 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-nexus-primary font-bold rounded-xl transition flex items-center gap-2"
              >
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                Refresh Brief
              </button>
           </div>
           
           <div className="bg-slate-50/50 border border-slate-100 rounded-2xl p-6 min-h-[120px] flex items-center justify-center">
              {summary ? (
                <p className="text-slate-700 font-mono text-sm leading-relaxed whitespace-pre-line">{summary}</p>
              ) : (
                <div className="text-center text-slate-400 italic flex flex-col items-center gap-2">
                   <p>No brief generated for this view period.</p>
                   <p className="text-[10px] font-bold uppercase tracking-widest">Click refresh to sync data</p>
                </div>
              )}
           </div>
        </div>
      </div>

      {/* Log Feed */}
      <div className="space-y-4">
        <div className="flex justify-between items-center px-2">
          <h3 className="text-xl font-bold text-slate-900">Recent Alignment Logs</h3>
          <div className="flex bg-slate-200 p-1 rounded-xl">
             <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg transition ${viewMode === 'list' ? 'bg-white text-nexus-primary shadow-sm' : 'text-slate-500'}`}><List className="w-4 h-4" /></button>
             <button onClick={() => setViewMode('calendar')} className={`p-2 rounded-lg transition ${viewMode === 'calendar' ? 'bg-white text-nexus-primary shadow-sm' : 'text-slate-500'}`}><CalendarIcon className="w-4 h-4" /></button>
          </div>
        </div>
        
        {viewMode === 'list' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
             {logs.slice(0, 12).map(log => {
               // Show check-out tasks if available, otherwise check-in tasks
               const previewText = log.checkOut?.tasks || log.checkIn?.tasks || "Active alignment session...";
               return (
                 <div 
                    key={log.id} 
                    onClick={() => setSelectedLog(log)}
                    className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition cursor-pointer group flex flex-col h-full"
                 >
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-nexus-primary/10 text-nexus-primary flex items-center justify-center text-sm font-bold">
                          {log.userName.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">{log.userName}</h4>
                          <p className="text-[10px] text-slate-400 font-bold uppercase">{formatShortDate(log.date)}</p>
                        </div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setShowUserReport(log.userId); }} className="p-1.5 text-slate-300 hover:text-nexus-primary hover:bg-indigo-50 rounded-lg transition">
                        <BarChart3 className="w-4 h-4" />
                      </button>
                    </div>
                    
                    <div className="flex-1">
                      <p className="text-xs text-slate-600 line-clamp-4 leading-relaxed font-medium italic mb-4">
                        "{previewText}"
                      </p>
                    </div>
                    
                    <div className="mt-auto pt-3 border-t border-slate-50 flex items-center justify-between">
                       <div className="flex gap-2">
                         {log.checkIn && <div className="w-2 h-2 rounded-full bg-yellow-400" title="Morning Log Done" />}
                         {log.checkOut && <div className="w-2 h-2 rounded-full bg-nexus-primary" title="Evening Log Done" />}
                       </div>
                       <ChevronRight className="w-3 h-3 text-slate-300 group-hover:text-nexus-primary transition-transform group-hover:translate-x-1" />
                    </div>
                 </div>
               );
             })}
          </div>
        ) : (
          <div className="bg-white border rounded-3xl p-12 text-center text-slate-400 italic">Calendar View coming in next sprint.</div>
        )}
      </div>

      {/* Log Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-xl h-fit max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
             <div className="p-6 border-b flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-nexus-primary text-white flex items-center justify-center text-lg font-bold shadow-lg shadow-nexus-primary/20">
                    {selectedLog.userName.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">{selectedLog.userName}</h3>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">{formatDate(selectedLog.date)}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedLog(null)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-full transition"><X className="w-6 h-6" /></button>
             </div>
             
             <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {selectedLog.checkIn && (
                   <div className="space-y-3 relative pl-6 border-l-2 border-yellow-400/30">
                      <div className="absolute left-[-9px] top-0 w-4 h-4 rounded-full bg-yellow-400 ring-4 ring-white shadow-sm" />
                      <div className="flex justify-between items-center">
                        <h4 className="text-xs font-bold text-yellow-600 uppercase tracking-widest flex items-center gap-2"><Sun className="w-3.5 h-3.5" /> Start of Day</h4>
                        <span className="text-[10px] text-slate-400">{formatTime(selectedLog.checkIn.timestamp)}</span>
                      </div>
                      <div className="p-4 bg-yellow-50/50 border border-yellow-100 rounded-2xl text-sm text-slate-700 leading-relaxed font-mono">
                        {selectedLog.checkIn.tasks}
                      </div>
                      {selectedLog.checkIn.blockers && (
                        <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
                           <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                           <p className="text-xs text-red-700 font-medium">{selectedLog.checkIn.blockers}</p>
                        </div>
                      )}
                   </div>
                )}

                {selectedLog.checkOut && (
                   <div className="space-y-3 relative pl-6 border-l-2 border-nexus-primary/30">
                      <div className="absolute left-[-9px] top-0 w-4 h-4 rounded-full bg-nexus-primary ring-4 ring-white shadow-sm" />
                      <div className="flex justify-between items-center">
                        <h4 className="text-xs font-bold text-nexus-primary uppercase tracking-widest flex items-center gap-2"><Moon className="w-3.5 h-3.5" /> End of Day</h4>
                        <span className="text-[10px] text-slate-400">{formatTime(selectedLog.checkOut.timestamp)}</span>
                      </div>
                      <div className="p-4 bg-indigo-50/30 border border-indigo-100 rounded-2xl text-sm text-slate-700 leading-relaxed font-mono">
                        {selectedLog.checkOut.tasks}
                      </div>
                      <div className="flex justify-end items-center gap-4 pt-2">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1"><Clock className="w-3 h-3" /> {(selectedLog.checkOut.workDurationMinutes || 0) / 60}h Focused</div>
                      </div>
                   </div>
                )}
                
                {!selectedLog.checkOut && (
                  <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-2xl">
                     <Activity className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                     <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Active Member • Log-off Pending</p>
                  </div>
                )}
             </div>
             
             <div className="p-6 border-t bg-slate-50/50 flex justify-end gap-3">
                <button onClick={() => setSelectedLog(null)} className="px-10 py-3 bg-nexus-primary text-white font-bold rounded-2xl shadow-xl shadow-nexus-primary/20 transition active:scale-95">Dismiss</button>
             </div>
          </div>
        </div>
      )}

      {/* User Report Modal */}
      {showUserReport && (
        <UserReportModal userId={showUserReport} onClose={() => setShowUserReport(null)} />
      )}

      {/* Manager Chat Modal */}
      {showManagerChat && (
        <ManagerChatModal onClose={() => setShowManagerChat(false)} />
      )}

      {/* Shared Entry Modals (Start/End Day) */}
      {logType && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
           <form onSubmit={handleLogSubmit} className="bg-white rounded-[32px] shadow-2xl w-full max-w-lg p-8 animate-in zoom-in-95">
              <div className="flex justify-between items-center mb-8">
                 <h3 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                   {logType === 'check-in' ? <Sun className="text-yellow-500" /> : <Moon className="text-nexus-primary" />}
                   {logType === 'check-in' ? 'Morning Check-in' : 'Evening Log-off'}
                 </h3>
                 <button type="button" onClick={() => setLogType(null)}><X className="w-6 h-6 text-slate-400" /></button>
              </div>
              <div className="space-y-6">
                 <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Today's Focus & Deliverables</label>
                    <textarea required placeholder="What's the main priority?" rows={4} className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-nexus-primary outline-none transition" />
                 </div>
                 {logType === 'check-in' && (
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Daily Energy Level</label>
                      <input type="range" min="1" max="10" defaultValue="5" className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-nexus-primary" />
                    </div>
                 )}
                 <div className="flex justify-end gap-3 pt-4">
                    <button type="button" onClick={() => setLogType(null)} className="px-6 py-3 text-slate-500 font-bold">Cancel</button>
                    <button type="submit" className="px-10 py-3 bg-nexus-primary text-white font-bold rounded-2xl shadow-xl shadow-nexus-primary/20">Confirm Alignment</button>
                 </div>
              </div>
           </form>
        </div>
      )}
    </div>
  );
};

const UserReportModal: React.FC<{ userId: string, onClose: () => void }> = ({ userId, onClose }) => {
  const [reportText, setReportText] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReport = async () => {
      const userLogs = MOCK_LOGS_INITIAL.filter(l => l.userId === userId);
      const res = await generateWeeklyReport(userLogs, 'Contributor');
      setReportText(res);
      setLoading(false);
    };
    fetchReport();
  }, [userId]);

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95">
         <div className="p-6 border-b flex justify-between items-center bg-slate-50">
            <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3"><BarChart3 className="text-nexus-primary" /> Member Performance Audit</h3>
            <button onClick={onClose}><X className="w-6 h-6 text-slate-400" /></button>
         </div>
         <div className="flex-1 overflow-y-auto p-8 space-y-8">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
                <Loader2 className="w-10 h-10 animate-spin text-nexus-primary" />
                <p className="font-bold text-xs uppercase tracking-widest">Synthesizing log data...</p>
              </div>
            ) : (
              <div className="space-y-8">
                 <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-slate-50 rounded-2xl border text-center"><p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Avg Energy</p><p className="text-xl font-bold text-nexus-primary">7.8</p></div>
                    <div className="p-4 bg-slate-50 rounded-2xl border text-center"><p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Commitments</p><p className="text-xl font-bold text-nexus-primary">92%</p></div>
                    <div className="p-4 bg-slate-50 rounded-2xl border text-center"><p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Total Hours</p><p className="text-xl font-bold text-nexus-primary">124h</p></div>
                 </div>
                 <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                    <h4 className="font-bold text-slate-900 mb-4 flex items-center gap-2 text-sm"><Sparkles className="w-4 h-4 text-nexus-primary" /> AI Performance Summary</h4>
                    <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-line font-mono">{reportText}</p>
                 </div>
              </div>
            )}
         </div>
      </div>
    </div>
  );
};

const ManagerChatModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const msg: ChatMessage = { id: Date.now().toString(), role: 'user', text: input, timestamp: Date.now() };
    setMessages([...messages, msg]);
    setInput('');
    setLoading(true);
    const aiRes = await queryTeamLogs(input, MOCK_LOGS_INITIAL, messages.map(m => ({ role: m.role, text: m.text })));
    setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'model', text: aiRes, timestamp: Date.now() }]);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-2xl h-[600px] flex flex-col overflow-hidden animate-in zoom-in-95">
         <div className="p-5 border-b flex justify-between items-center bg-indigo-50">
            <h3 className="font-bold text-slate-900 flex items-center gap-2"><Sparkles className="w-5 h-5 text-nexus-primary" /> Intelligence Assistant</h3>
            <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
         </div>
         <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/30">
            {messages.map(m => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`max-w-[85%] p-4 rounded-2xl text-sm ${m.role === 'user' ? 'bg-nexus-primary text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none border border-slate-200'}`}>{m.text}</div>
              </div>
            ))}
            {loading && <div className="flex justify-start"><div className="bg-white border p-3 rounded-xl animate-pulse text-xs text-slate-400 font-bold uppercase tracking-widest">Analyzing logs...</div></div>}
         </div>
         <div className="p-4 border-t bg-white">
            <form onSubmit={handleSend} className="relative"><input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask about team health, blockers, or reports..." className="w-full bg-slate-50 border rounded-xl py-3 pl-4 pr-12 text-sm focus:ring-2 focus:ring-nexus-primary outline-none" /><button type="submit" className="absolute right-2 top-2 p-1.5 bg-nexus-primary text-white rounded-lg"><Send className="w-4 h-4" /></button></form>
         </div>
      </div>
    </div>
  );
};
