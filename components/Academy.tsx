import React, { useState, useRef, useEffect } from 'react';
import { BookOpen, CheckCircle, Lock, Play, HelpCircle, X, Brain as BrainIcon, Loader2, Plus, Edit3, ChevronRight, FileText, Send, Upload, Trash2, ArrowLeft, Link as LinkIcon, Search, Paperclip, Folder as FolderIcon, Shield, CheckSquare, Square, ChevronDown } from 'lucide-react';
import { LearningModule, UserRole, ChatMessage, ModuleResource, Document, Folder, AccessControl } from '../types';
import { chatWithDocument } from '../services/geminiService';
import { MOCK_FOLDERS, MOCK_DOCS } from '../data';

const MOCK_ORGS = [
  { id: 'o1', name: 'Nexus Solutions' },
  { id: 'o2', name: 'Global Tech' },
  { id: 'o3', name: 'Stark Industries' }
];

const CURRENT_USER_ROLE: UserRole = 'TeamManager'; 

const MOCK_PATH_INIT: LearningModule[] = [
  { 
    id: '1', 
    title: 'Culture Code', 
    status: 'completed', 
    description: 'Understand our core values and mission.',
    content: "Our Mission: To unify team alignment.\n\nValue 1: Radical Truth.\nValue 2: Ship Fast.\nValue 3: Users First.",
    resources: [
      { id: 'r1', title: 'Culture Handbook', type: 'brain_doc', brainId: '1' }
    ],
    access: { orgIds: ['o1'], teamIds: [], userIds: [] }
  },
  { 
    id: '2', 
    title: 'Setup Dev Environment', 
    status: 'active', 
    description: 'Configure VPN, GitHub SSH, and Docker.',
    content: "Step 1: Install Docker Desktop.\nStep 2: Generate SSH Key (ssh-keygen -t ed25519).\nStep 3: Clone the repo 'nexus-core'.",
    resources: [
      { id: 'r2', title: 'Internal Wiki: Setup', type: 'link', url: 'https://wiki.nexus.ai/setup' },
      { id: 'r3', title: 'Backend Docs Folder', type: 'brain_folder', brainId: 'f1-1' }
    ],
    access: { orgIds: ['o1'], teamIds: [], userIds: [] }
  },
];

export const Academy: React.FC = () => {
  const [modules, setModules] = useState<LearningModule[]>(MOCK_PATH_INIT);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [editingModule, setEditingModule] = useState<LearningModule | null>(null);
  const [showBrainSelector, setShowBrainSelector] = useState(false);
  const [brainSelectorTab, setBrainSelectorTab] = useState<'files'|'folders'>('files');
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);

  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
  const [previewFolder, setPreviewFolder] = useState<Folder | null>(null);

  const isManager = CURRENT_USER_ROLE === 'TeamManager' || CURRENT_USER_ROLE === 'OrgManager';
  const activeModule = modules.find(m => m.id === activeModuleId);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeModule) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: input, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    let context = activeModule.content;
    const inventoryList: string[] = [];
    if (activeModule.resources.length > 0) {
      context += "\n\n--- ATTACHED RESOURCES ---\n";
      activeModule.resources.forEach(r => {
        context += `- [${r.type.toUpperCase()}] ${r.title}`;
        if (r.type === 'brain_doc') {
          const doc = MOCK_DOCS.find(d => d.id === r.brainId);
          if (doc) { context += `: ${doc.contentSnippet}`; inventoryList.push(`Document: ${doc.name} (ID:${doc.id})`); }
        } else if (r.type === 'brain_folder') {
          const folder = MOCK_FOLDERS.find(f => f.id === r.brainId);
          if(folder) inventoryList.push(`Folder: ${folder.name} (ID:${folder.id})`);
        }
        context += "\n";
      });
    }

    const response = await chatWithDocument(userMsg.text, context, messages.map(m => ({ role: m.role, text: m.text })), 'general', inventoryList.join('\n'));
    setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'model', text: response, timestamp: Date.now() }]);
    setIsTyping(false);
  };

  const handleAddModule = () => {
    setModules([...modules, { id: Date.now().toString(), title: "New Module", description: "Enter summary...", status: 'locked', content: "", resources: [], access: { orgIds: [], teamIds: [], userIds: [] } }]);
  };

  const toggleOrgSelection = (orgId: string) => {
    if (!editingModule) return;
    const currentOrgs = editingModule.access?.orgIds || [];
    const nextOrgs = currentOrgs.includes(orgId) ? currentOrgs.filter(id => id !== orgId) : [...currentOrgs, orgId];
    setEditingModule({ ...editingModule, access: { ...editingModule.access!, orgIds: nextOrgs } });
  };

  const addResource = (type: ModuleResource['type'], data?: any) => {
    if (!editingModule) return;
    let newResource: ModuleResource;
    if (type === 'brain_doc') newResource = { id: `res-${Date.now()}`, title: data.name, type: 'brain_doc', brainId: data.id };
    else if (type === 'brain_folder') newResource = { id: `res-${Date.now()}`, title: data.name, type: 'brain_folder', brainId: data.id };
    else if (type === 'link') { const url = prompt("Enter URL:"); if (!url) return; newResource = { id: `res-${Date.now()}`, title: "Link", type: 'link', url: url }; }
    else newResource = { id: `res-${Date.now()}`, title: "File", type: 'file' };
    setEditingModule({ ...editingModule, resources: [...editingModule.resources, newResource] });
    setShowBrainSelector(false);
  };

  if (activeModuleId && activeModule) {
    return (
      <div className="h-screen flex flex-col bg-white">
        <div className="h-16 border-b flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <button onClick={() => setActiveModuleId(null)} className="p-2 hover:bg-slate-100 rounded-full"><ArrowLeft className="w-5 h-5" /></button>
            <h2 className="text-lg font-bold">{activeModule.title}</h2>
          </div>
        </div>
        <div className="flex-1 flex overflow-hidden">
           <div className="flex-1 overflow-y-auto p-8 bg-slate-50 border-r">
              <div className="max-w-3xl mx-auto bg-white p-10 rounded-xl shadow-sm border">
                 <h1 className="text-2xl font-bold mb-6 border-b pb-4">{activeModule.title}</h1>
                 <div className="prose prose-slate font-mono text-sm leading-relaxed whitespace-pre-wrap mb-8">{activeModule.content}</div>
                 {activeModule.resources.length > 0 && (
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                     {activeModule.resources.map(res => (
                       <div key={res.id} onClick={() => { if(res.type==='brain_doc') setPreviewDoc(MOCK_DOCS.find(d=>d.id===res.brainId)!); }} className="flex items-center p-3 border rounded-lg hover:bg-slate-50 cursor-pointer">
                          <FileText className="w-4 h-4 mr-3 text-indigo-500" />
                          <span className="text-sm font-medium">{res.title}</span>
                       </div>
                     ))}
                   </div>
                 )}
              </div>
           </div>
           <div className="w-[400px] flex flex-col bg-white">
              <div className="p-4 border-b bg-indigo-50/50"><h3 className="font-bold flex items-center gap-2"><BrainIcon className="w-5 h-5 text-nexus-primary" /> AI Tutor</h3></div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                 {messages.map(msg => (<div key={msg.id} className={`flex ${msg.role==='user'?'justify-end':'justify-start'}`}><div className={`max-w-[85%] p-3 rounded-xl text-sm ${msg.role==='user'?'bg-nexus-primary text-white':'bg-slate-100'}`}>{msg.text}</div></div>))}
                 {isTyping && <Loader2 className="w-5 h-5 animate-spin mx-auto text-nexus-primary" />}
                 <div ref={chatEndRef} />
              </div>
              <div className="p-4 border-t"><form onSubmit={handleSendMessage} className="relative"><input className="w-full bg-slate-50 border rounded-lg py-2.5 px-3 pr-10 text-sm" placeholder="Ask a question..." value={input} onChange={e=>setInput(e.target.value)} /><button type="submit" className="absolute right-2 top-2.5 text-nexus-primary"><Send className="w-4 h-4" /></button></form></div>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 h-screen bg-slate-50 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-end mb-8">
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Institutional Academy</h2>
          {isManager && <button onClick={() => setEditMode(!editMode)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm border font-medium ${editMode ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'}`}>{editMode ? 'Finish Path' : 'Edit Path'}</button>}
        </div>
        <div className="space-y-6">
          {modules.map(module => (
            <div key={module.id} className="relative pl-16 group">
              <div className={`absolute left-2.5 top-6 w-8 h-8 rounded-full border-4 border-slate-50 flex items-center justify-center text-white ${module.status === 'completed' ? 'bg-green-500' : module.status === 'active' ? 'bg-nexus-primary' : 'bg-slate-200 text-slate-400'}`}>{module.status === 'completed' ? <CheckCircle className="w-4 h-4" /> : module.status === 'active' ? <Play className="w-3 h-3 fill-current ml-0.5" /> : <Lock className="w-3 h-3" />}</div>
              <div onClick={() => !editMode && module.status !== 'locked' && setActiveModuleId(module.id)} className={`bg-white border p-6 rounded-xl shadow-sm ${!editMode && module.status !== 'locked' ? 'hover:border-nexus-primary cursor-pointer' : ''}`}>
                 {editingModule?.id === module.id ? (
                    <div className="space-y-4">
                       <div className="flex flex-col md:flex-row gap-4">
                          <input className="flex-1 border p-2 rounded text-sm font-bold" value={editingModule.title} onChange={e=>setEditingModule({...editingModule, title:e.target.value})} />
                          <div className="relative w-full md:w-64">
                             <button type="button" onClick={() => setShowOrgDropdown(!showOrgDropdown)} className="w-full flex items-center justify-between border p-2 rounded text-xs font-bold text-slate-600 bg-white">
                                {editingModule.access?.orgIds.length === 0 ? "Public" : `${editingModule.access?.orgIds.length} Orgs`} <ChevronDown className="w-3 h-3" />
                             </button>
                             {showOrgDropdown && (
                                <div className="absolute top-full left-0 right-0 mt-2 bg-white border shadow-2xl z-50 p-2 rounded-xl">
                                   {MOCK_ORGS.map(o => (
                                      <button key={o.id} onClick={() => toggleOrgSelection(o.id)} type="button" className="w-full flex items-center gap-3 p-2 hover:bg-slate-50 text-xs font-medium">
                                         {editingModule.access?.orgIds.includes(o.id) ? <CheckSquare className="w-4 h-4 text-nexus-primary" /> : <Square className="w-4 h-4 text-slate-300" />} {o.name}
                                      </button>
                                   ))}
                                </div>
                             )}
                          </div>
                       </div>
                       <textarea className="w-full border p-2 rounded text-sm h-32 font-mono" value={editingModule.content} onChange={e=>setEditingModule({...editingModule, content:e.target.value})} />
                       <div className="flex gap-2"><button onClick={() => setModules(modules.map(m=>m.id===editingModule.id?editingModule:m))} className="bg-green-600 text-white px-3 py-1.5 rounded text-xs">Save</button><button onClick={()=>setEditingModule(null)} className="bg-slate-200 px-3 py-1.5 rounded text-xs">Cancel</button></div>
                    </div>
                 ) : (
                    <div>
                       <div className="flex justify-between items-center"><h3 className="text-lg font-bold">{module.title}</h3>{module.access?.orgIds.length > 0 && <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded border border-purple-100 font-bold"><Shield className="inline w-3 h-3 mr-1" /> Restricted</span>}</div>
                       <p className="text-sm text-slate-500">{module.description}</p>
                       {editMode && <button onClick={()=>setEditingModule(module)} className="mt-4 p-2 bg-slate-100 rounded"><Edit3 className="w-4 h-4" /></button>}
                    </div>
                 )}
              </div>
            </div>
          ))}
          {editMode && <button onClick={handleAddModule} className="w-full ml-16 py-4 border-2 border-dashed rounded-xl text-slate-400 font-bold hover:text-nexus-primary transition bg-white/50"><Plus className="w-5 h-5 inline mr-2" /> Add Path Node</button>}
        </div>
      </div>
    </div>
  );
};
