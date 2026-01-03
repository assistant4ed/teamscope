
import React, { useState, useRef, useEffect } from 'react';
import { FileText, Upload, X, Search, MessageSquare, Code, Loader2, Send, Folder as FolderIcon, ChevronRight, Home, ArrowLeft, Plus, Eye, Edit2, Check, Headphones, MessageCircle, Shield, Brain as BrainIcon, Lock, CheckSquare, Square, ChevronDown, Users, Globe } from 'lucide-react';
import { Document, ChatMessage, Folder, UserRole, AccessControl } from '../types';
import { chatWithDocument } from '../services/geminiService';
import { MOCK_FOLDERS, MOCK_DOCS } from '../data';

const MOCK_ORGS = [
  { id: 'o1', name: 'Nexus Solutions' },
  { id: 'o2', name: 'Global Tech' },
  { id: 'o3', name: 'Stark Industries' }
];

const MOCK_TEAMS = [
  { id: 't1', name: 'Platform Engineering' },
  { id: 't2', name: 'Strategy Ops' },
  { id: 't3', name: 'Design Sync' },
  { id: 't4', name: 'Product Growth' }
];

export const Brain: React.FC = () => {
  const [folders, setFolders] = useState<Folder[]>(MOCK_FOLDERS);
  const [docs, setDocs] = useState<Document[]>(MOCK_DOCS);
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined); 
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [chatMode, setChatMode] = useState<'general' | 'customer_service'>('general');

  const [showAccessModal, setShowAccessModal] = useState<Folder | 'new' | null>(null);
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const [showTeamDropdown, setShowTeamDropdown] = useState(false);

  const [draggedItem, setDraggedItem] = useState<{ id: string, type: 'file' | 'folder' } | null>(null);

  useEffect(() => {
    if (showAccessModal && typeof showAccessModal === 'object') {
      setSelectedOrgIds(showAccessModal.access?.orgIds || []);
      setSelectedTeamIds(showAccessModal.access?.teamIds || []);
    } else {
      setSelectedOrgIds([]);
      setSelectedTeamIds([]);
    }
  }, [showAccessModal]);

  const toggleOrgSelection = (id: string) => {
    setSelectedOrgIds(prev => 
      prev.includes(id) ? prev.filter(orgId => orgId !== id) : [...prev, id]
    );
  };

  const toggleTeamSelection = (id: string) => {
    setSelectedTeamIds(prev => 
      prev.includes(id) ? prev.filter(teamId => teamId !== id) : [...prev, id]
    );
  };

  const handleDragStart = (e: React.DragEvent, id: string, type: 'file' | 'folder') => {
    setDraggedItem({ id, type });
    e.dataTransfer.setData('itemId', id);
    e.dataTransfer.setData('itemType', type);
  };

  const handleDrop = (e: React.DragEvent, targetFolderId: string | undefined) => {
    e.preventDefault();
    const itemId = e.dataTransfer.getData('itemId');
    const itemType = e.dataTransfer.getData('itemType');
    
    if (itemType === 'file') {
        setDocs(docs.map(d => d.id === itemId ? { ...d, folderId: targetFolderId } : d));
    } else {
        if (itemId === targetFolderId) return; 
        setFolders(folders.map(f => f.id === itemId ? { ...f, parentId: targetFolderId } : f));
    }
    setDraggedItem(null);
  };

  const handleSaveAccess = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const name = formData.get('name') as string;

    const access: AccessControl = {
      orgIds: selectedOrgIds,
      teamIds: selectedTeamIds,
      userIds: [],
      isPublic: selectedOrgIds.length === 0 && selectedTeamIds.length === 0
    };

    if (showAccessModal === 'new') {
      const newFolder: Folder = {
        id: `f-${Date.now()}`,
        name,
        parentId: currentFolderId,
        sharedWithTeamIds: [],
        access
      };
      setFolders([...folders, newFolder]);
    } else if (showAccessModal && typeof showAccessModal === 'object') {
      setFolders(folders.map(f => f.id === showAccessModal.id ? { 
        ...f, 
        name, 
        access
      } : f));
    }
    setShowAccessModal(null);
  };

  const visibleFolders = folders.filter(f => f.parentId === currentFolderId);
  const visibleDocs = docs.filter(d => d.folderId === currentFolderId);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* File Explorer */}
      <div className="w-full md:w-1/3 border-r border-slate-200 flex flex-col bg-white">
        <div className="p-6 border-b flex justify-between items-center bg-slate-50/30">
           <div className="flex items-center gap-3">
              <div className="p-2 bg-nexus-primary/10 rounded-xl text-nexus-primary"><Search className="w-5 h-5" /></div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">The Vault</h2>
           </div>
           <button onClick={() => setShowAccessModal('new')} className="p-2 hover:bg-slate-100 rounded-xl text-nexus-primary transition"><Plus className="w-5 h-5" /></button>
        </div>

        <div className="px-4 py-2 bg-slate-50 border-b flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest overflow-hidden shadow-inner">
           <button onClick={() => setCurrentFolderId(undefined)} onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, undefined)} className="hover:text-nexus-primary transition-colors whitespace-nowrap">Root</button>
           {currentFolderId && <ChevronRight className="w-3 h-3 flex-shrink-0" />}
           <span className="truncate">{folders.find(f => f.id === currentFolderId)?.name}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-1.5 scrollbar-hide">
           {visibleFolders.map(f => (
             <div key={f.id} draggable onDragStart={e => handleDragStart(e, f.id, 'folder')} onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, f.id)} className="flex items-center gap-3 p-3 rounded-2xl hover:bg-slate-50 border border-transparent hover:border-slate-100 cursor-pointer transition group">
                <div onClick={() => setCurrentFolderId(f.id)} className="flex items-center gap-3 flex-1 overflow-hidden">
                  <FolderIcon className="w-4 h-4 text-indigo-500 fill-indigo-500/10" />
                  <span className="text-sm font-bold text-slate-700 flex-1 truncate">{f.name}</span>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); setShowAccessModal(f); }} 
                  className="p-1.5 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-nexus-primary transition"
                >
                  <Lock className="w-3.5 h-3.5" />
                </button>
                <ChevronRight className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition" />
             </div>
           ))}
           {visibleDocs.map(d => (
             <div key={d.id} draggable onDragStart={e => handleDragStart(e, d.id, 'file')} onClick={() => setSelectedDoc(d)} className={`flex items-center gap-3 p-3 rounded-2xl border transition cursor-pointer group ${selectedDoc?.id === d.id ? 'bg-indigo-50 border-nexus-primary shadow-sm' : 'bg-white border-slate-100 hover:border-nexus-primary/30'}`}>
                <div className={`p-2 rounded-xl ${d.type === 'CSV' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}><FileText className="w-4 h-4" /></div>
                <div className="flex-1 min-w-0"><h3 className="text-sm font-bold text-slate-900 truncate">{d.name}</h3><p className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter">{d.type}</p></div>
             </div>
           ))}
           {visibleFolders.length === 0 && visibleDocs.length === 0 && (
             <div className="py-20 text-center text-slate-300 font-bold text-xs uppercase tracking-widest opacity-50 italic">Folder is empty</div>
           )}
        </div>

        <div className="p-4 border-t bg-slate-50/30">
           <div 
             onDragOver={e => e.preventDefault()} 
             onDrop={e => alert("System Sync: Files uploaded via Drag & Drop Interface.")}
             className="border-2 border-dashed border-slate-200 rounded-3xl p-8 flex flex-col items-center justify-center text-slate-400 hover:border-nexus-primary hover:bg-white hover:text-nexus-primary transition cursor-pointer group"
            >
              <Upload className="w-8 h-8 mb-3 group-hover:-translate-y-1 transition-transform" />
              <p className="text-[10px] font-bold uppercase tracking-widest">Global Upload Zone</p>
              <p className="text-[9px] mt-1">Files, Folders, Repos</p>
           </div>
        </div>
      </div>

      {/* Main Analysis Hub */}
      <div className="hidden md:flex flex-1 flex-col bg-white">
         <div className="h-16 border-b flex items-center justify-between px-8 bg-slate-50/50">
            <div className="flex items-center gap-3">
               <MessageSquare className="w-5 h-5 text-nexus-primary" />
               <h2 className="font-bold text-slate-900">{selectedDoc ? `Analysis: ${selectedDoc.name}` : 'Multi-Doc Reasoning Engine'}</h2>
            </div>
            <div className="flex bg-slate-100 p-1 rounded-xl border">
               <button onClick={() => setChatMode('general')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${chatMode === 'general' ? 'bg-white shadow text-nexus-primary' : 'text-slate-500 hover:text-slate-700'}`}>General Query</button>
               <button onClick={() => setChatMode('customer_service')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${chatMode === 'customer_service' ? 'bg-white shadow text-nexus-primary' : 'text-slate-500 hover:text-slate-700'}`}>Policy Audit</button>
            </div>
         </div>
         <div className="flex-1 p-8 overflow-y-auto space-y-6 scrollbar-hide">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4 opacity-50">
                 <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center border border-slate-100 shadow-inner"><BrainIcon className="w-10 h-10" /></div>
                 <div className="text-center"><p className="font-bold uppercase text-[10px] tracking-widest">Context initialized</p><p className="text-xs italic mt-1">Knowledge sync complete. Ask me anything about your documents.</p></div>
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`max-w-[75%] p-5 rounded-[28px] text-sm leading-relaxed shadow-sm ${m.role === 'user' ? 'bg-nexus-primary text-white rounded-tr-none shadow-lg shadow-nexus-primary/20' : 'bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200'}`}>{m.text}</div>
              </div>
            ))}
         </div>
         <div className="p-6 border-t bg-slate-50/30">
            <div className="relative max-w-3xl mx-auto"><input value={input} onChange={e => setInput(e.target.value)} placeholder="Query the vault..." className="w-full bg-white border border-slate-200 rounded-[20px] py-4 pl-6 pr-16 text-slate-900 shadow-xl shadow-slate-200/50 outline-none focus:ring-2 focus:ring-nexus-primary transition-all" /><button className="absolute right-3 top-2.5 p-2.5 bg-nexus-primary text-white rounded-xl shadow-lg hover:bg-nexus-primaryHover active:scale-95 transition"><Send className="w-5 h-5" /></button></div>
         </div>
      </div>

      {/* Access Control Folder Modal */}
      {showAccessModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
           <form onSubmit={handleSaveAccess} className="bg-white rounded-[40px] shadow-2xl w-full max-w-md p-8 md:p-10 animate-in zoom-in-95 duration-300 overflow-visible">
              <div className="flex items-center justify-between mb-8">
                 <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-50 rounded-2xl text-nexus-primary shadow-inner shadow-indigo-100/50"><Shield className="w-6 h-6" /></div>
                    <div>
                      <h3 className="text-xl md:text-2xl font-bold text-slate-900 leading-tight">{typeof showAccessModal === 'object' ? 'Edit Partition' : 'Secure Partition'}</h3>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Knowledge Governance</p>
                    </div>
                 </div>
                 <button type="button" onClick={() => setShowAccessModal(null)} className="text-slate-400 hover:text-slate-600 transition"><X className="w-6 h-6" /></button>
              </div>
              
              <div className="space-y-6">
                 <div>
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1">Volume Designation</label>
                   <input name="name" required autoFocus defaultValue={typeof showAccessModal === 'object' ? showAccessModal.name : ''} placeholder="Infrastructure Docs..." className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-nexus-primary transition font-bold text-sm" />
                 </div>
                 
                 {/* Multi-Select Organizations */}
                 <div className="relative">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1">Organizational Scope</label>
                    <button 
                      type="button" 
                      onClick={() => { setShowOrgDropdown(!showOrgDropdown); setShowTeamDropdown(false); }}
                      className="w-full flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100"
                    >
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-nexus-primary" />
                        <span className="truncate">{selectedOrgIds.length === 0 ? "Global Access" : `${selectedOrgIds.length} Institutions`}</span>
                      </div>
                      <ChevronDown className={`w-4 h-4 transition-transform ${showOrgDropdown ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {showOrgDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 p-2 animate-in slide-in-from-top-1 overflow-hidden">
                        <div className="max-h-40 overflow-y-auto scrollbar-hide">
                          {MOCK_ORGS.map(org => (
                            <button 
                              key={org.id} 
                              type="button"
                              onClick={() => toggleOrgSelection(org.id)}
                              className="w-full text-left p-3 hover:bg-slate-50 rounded-xl flex items-center gap-3 transition"
                            >
                               {selectedOrgIds.includes(org.id) ? <CheckSquare className="w-4 h-4 text-nexus-primary" /> : <Square className="w-4 h-4 text-slate-300" />}
                               <span className={`text-xs font-bold ${selectedOrgIds.includes(org.id) ? 'text-nexus-primary' : 'text-slate-600'}`}>{org.name}</span>
                            </button>
                          ))}
                        </div>
                        <div className="p-2 border-t mt-2 flex gap-2 bg-slate-50/50">
                           <button type="button" onClick={() => setSelectedOrgIds(MOCK_ORGS.map(o=>o.id))} className="flex-1 py-1.5 bg-white border rounded-lg text-[9px] font-bold uppercase text-slate-500 shadow-sm active:scale-95 transition">Select All</button>
                           <button type="button" onClick={() => setSelectedOrgIds([])} className="flex-1 py-1.5 bg-white border rounded-lg text-[9px] font-bold uppercase text-slate-500 shadow-sm active:scale-95 transition">Clear</button>
                        </div>
                      </div>
                    )}
                 </div>

                 {/* Multi-Select Teams */}
                 <div className="relative">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1">Team-Level Whitelist</label>
                    <button 
                      type="button" 
                      onClick={() => { setShowTeamDropdown(!showTeamDropdown); setShowOrgDropdown(false); }}
                      className="w-full flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100"
                    >
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-500" />
                        <span className="truncate">{selectedTeamIds.length === 0 ? "No Team Restrictions" : `${selectedTeamIds.length} Teams Permitted`}</span>
                      </div>
                      <ChevronDown className={`w-4 h-4 transition-transform ${showTeamDropdown ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {showTeamDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 p-2 animate-in slide-in-from-top-1 overflow-hidden">
                        <div className="max-h-40 overflow-y-auto scrollbar-hide">
                          {MOCK_TEAMS.map(team => (
                            <button 
                              key={team.id} 
                              type="button"
                              onClick={() => toggleTeamSelection(team.id)}
                              className="w-full text-left p-3 hover:bg-slate-50 rounded-xl flex items-center gap-3 transition"
                            >
                               {selectedTeamIds.includes(team.id) ? <CheckSquare className="w-4 h-4 text-indigo-500" /> : <Square className="w-4 h-4 text-slate-300" />}
                               <span className={`text-xs font-bold ${selectedTeamIds.includes(team.id) ? 'text-indigo-500' : 'text-slate-600'}`}>{team.name}</span>
                            </button>
                          ))}
                        </div>
                        <div className="p-2 border-t mt-2 flex gap-2 bg-slate-50/50">
                           <button type="button" onClick={() => setSelectedTeamIds(MOCK_TEAMS.map(t=>t.id))} className="flex-1 py-1.5 bg-white border rounded-lg text-[9px] font-bold uppercase text-slate-500 shadow-sm active:scale-95 transition">All Teams</button>
                           <button type="button" onClick={() => setSelectedTeamIds([])} className="flex-1 py-1.5 bg-white border rounded-lg text-[9px] font-bold uppercase text-slate-500 shadow-sm active:scale-95 transition">Public</button>
                        </div>
                      </div>
                    )}
                 </div>

                 <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
                    <button type="button" onClick={() => setShowAccessModal(null)} className="px-6 py-3 text-slate-500 font-bold transition hover:text-slate-800 text-sm">Discard</button>
                    <button type="submit" className="px-10 py-3 bg-nexus-primary text-white font-bold rounded-2xl shadow-xl shadow-nexus-primary/20 transition hover:-translate-y-0.5 active:scale-95 text-sm">Save Governance</button>
                 </div>
              </div>
           </form>
        </div>
      )}
    </div>
  );
};
