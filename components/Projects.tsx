import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, MoreVertical, Clock, AlertCircle, ChevronRight, 
  ChevronLeft, Search, Filter, Trash2, Edit2, User as UserIcon, 
  Image as ImageIcon, X, CheckCircle2, GripVertical, Paperclip, Type, Maximize2,
  Layout, List as ListIcon, Kanban as KanbanIcon, Flag, Users, Layers, Sparkles, Check, Calendar, Shield, Share2, Eye, Building2, Lock, ShieldCheck,
  Globe, CheckSquare, Square, ChevronDown
} from 'lucide-react';
import { Project, Task, TaskPriority, TaskStatus, User, AccessControl } from '../types';
import { MOCK_PROJECTS, MOCK_TASKS, MOCK_USERS } from '../data';

const MOCK_ORGS = [
  { id: 'o1', name: 'Nexus Solutions' },
  { id: 'o2', name: 'Global Tech' },
  { id: 'o3', name: 'Stark Industries' }
];

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  'High': 3,
  'Medium': 2,
  'Low': 1
};

export const Projects: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS);
  const [tasks, setTasks] = useState<Task[]>(MOCK_TASKS);
  const [activeProjectId, setActiveProjectId] = useState<string>(MOCK_PROJECTS[0].id);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [filterPriority, setFilterPriority] = useState<TaskPriority | 'All'>('All');
  
  // Project State for Modal
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([]);
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);

  // Modals
  const [showTaskModal, setShowTaskModal] = useState<Task | 'new' | { status: TaskStatus } | null>(null);
  const [showProjectModal, setShowProjectModal] = useState<Project | 'new' | null>(null);
  const [showRestrictedConfig, setShowRestrictedConfig] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [showColumnMenu, setShowColumnMenu] = useState<TaskStatus | null>(null);

  const activeProject = projects.find(p => p.id === activeProjectId);

  useEffect(() => {
    if (showProjectModal && typeof showProjectModal === 'object') {
      setSelectedOrgIds(showProjectModal.access?.orgIds || ['o1']);
    } else {
      setSelectedOrgIds(['o1']);
    }
  }, [showProjectModal]);

  // --- Filtered Tasks ---
  const getTasksByStatus = (status: TaskStatus) => {
    return tasks
      .filter(t => t.projectId === activeProjectId && t.status === status)
      .filter(t => t.title.toLowerCase().includes(searchTerm.toLowerCase()))
      .filter(t => filterPriority === 'All' || t.priority === filterPriority)
      .sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]);
  };

  const getFilteredListTasks = () => {
    return tasks
      .filter(t => t.projectId === activeProjectId)
      .filter(t => t.title.toLowerCase().includes(searchTerm.toLowerCase()))
      .filter(t => filterPriority === 'All' || t.priority === filterPriority);
  };

  // --- Handlers ---
  const handleAddProject = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const name = formData.get('name') as string;
    const color = formData.get('color') as string;
    const deadline = formData.get('deadline') as string;
    
    const access: AccessControl = {
      orgIds: selectedOrgIds,
      teamIds: [],
      userIds: []
    };

    if (showProjectModal === 'new') {
        const newProject: Project = {
            id: `p-${Date.now()}`,
            name,
            color,
            deadline,
            teamId: 't1',
            access
        };
        setProjects([...projects, newProject]);
        setActiveProjectId(newProject.id);
    } else if (showProjectModal && typeof showProjectModal === 'object') {
        setProjects(projects.map(p => p.id === showProjectModal.id ? { ...p, name, color, deadline, access } : p));
    }
    setShowProjectModal(null);
  };

  const toggleOrgSelection = (id: string) => {
    setSelectedOrgIds(prev => 
      prev.includes(id) ? prev.filter(orgId => orgId !== id) : [...prev, id]
    );
  };

  const handleSaveTask = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const priority = formData.get('priority') as TaskPriority;
    const status = formData.get('status') as TaskStatus;
    const imageUrl = formData.get('imageUrl') as string;
    const assigneeIds = (typeof showTaskModal === 'object' && showTaskModal && 'assigneeIds' in showTaskModal) ? showTaskModal.assigneeIds : [];

    if (showTaskModal === 'new' || (typeof showTaskModal === 'object' && showTaskModal && 'status' in showTaskModal && !('id' in showTaskModal))) {
      const newTask: Task = {
        id: `tk-${Date.now()}`,
        projectId: activeProjectId,
        title,
        description,
        priority,
        status,
        assigneeIds,
        imageUrl: imageUrl || undefined
      };
      setTasks([...tasks, newTask]);
    } else if (typeof showTaskModal === 'object' && showTaskModal && 'id' in showTaskModal) {
      setTasks(tasks.map(t => t.id === showTaskModal.id ? { ...t, title, description, priority, status, assigneeIds, imageUrl: imageUrl || t.imageUrl } : t));
    }
    setShowTaskModal(null);
  };

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.setData('taskId', taskId);
  };

  const handleDrop = (e: React.DragEvent, newStatus: TaskStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('taskId');
    if (!taskId) return;
    setTasks(prev => prev.map(task => task.id === taskId ? { ...task, status: newStatus } : task));
    setDraggedTaskId(null);
  };

  const clearColumn = (status: TaskStatus) => {
    if (confirm(`Archive all tasks in ${status}?`)) {
        setTasks(tasks.filter(t => !(t.projectId === activeProjectId && t.status === status)));
    }
    setShowColumnMenu(null);
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* Sidebar: Projects List */}
      <div className="w-16 md:w-64 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-4 md:p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="font-bold text-slate-900 hidden md:block">Active Workspace</h2>
          <button onClick={() => setShowProjectModal('new')} className="p-2 hover:bg-slate-200 rounded-xl text-nexus-primary transition shadow-sm bg-white">
            <Plus className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 md:p-4 space-y-2">
          {projects.map(p => (
            <button
              key={p.id}
              onClick={() => setActiveProjectId(p.id)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-sm font-medium transition-all ${
                activeProjectId === p.id ? 'bg-nexus-primary text-white shadow-lg shadow-nexus-primary/20' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <div className="w-2.5 h-2.5 rounded-full border-2 border-white shrink-0" style={{ backgroundColor: p.color }} />
              <span className="truncate hidden md:block">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Workspace Header */}
        <div className="h-20 border-b border-slate-200 bg-white flex items-center justify-between px-4 md:px-8 shadow-sm">
          <div className="flex items-center gap-4 overflow-hidden">
             <div className="flex items-center gap-3 shrink-0 cursor-pointer group" onClick={() => setShowProjectModal(activeProject || null)}>
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-inner" style={{ backgroundColor: activeProject?.color }}>
                   <Shield className="w-5 h-5" />
                </div>
                <div className="flex flex-col">
                   <h2 className="text-xl font-bold text-slate-900 truncate max-w-[200px]">{activeProject?.name}</h2>
                   <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Workspace ID: {activeProject?.id}</span>
                      {activeProject?.deadline && (
                         <span className="flex items-center gap-1 text-[10px] text-red-500 font-bold bg-red-50 px-1.5 py-0.5 rounded-full border border-red-100">
                            <Clock className="w-3 h-3" /> Due {new Date(activeProject.deadline).toLocaleDateString()}
                         </span>
                      )}
                   </div>
                </div>
             </div>
             
             <div className="h-6 w-px bg-slate-200 mx-2 hidden md:block" />
             
             <div className="hidden md:flex bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-inner">
               <button onClick={() => setViewMode('board')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'board' ? 'bg-white text-nexus-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                 <KanbanIcon className="w-3.5 h-3.5" /> Board
               </button>
               <button onClick={() => setViewMode('list')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'list' ? 'bg-white text-nexus-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                 <ListIcon className="w-3.5 h-3.5" /> List
               </button>
             </div>
          </div>
          
          <div className="flex items-center gap-3">
             <div className="relative group hidden lg:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="text" placeholder="Search tasks..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-sm focus:ring-2 focus:ring-nexus-primary outline-none transition-all w-48 focus:w-64" />
             </div>
             <button onClick={() => setShowTaskModal('new')} className="bg-nexus-primary text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-xl shadow-nexus-primary/20 hover:bg-nexus-primaryHover transition active:scale-95">
               <Plus className="w-4 h-4 mr-2 inline" /> New Task
             </button>
          </div>
        </div>

        {/* Dynamic Board/List Content */}
        <div className="flex-1 overflow-x-auto p-4 md:p-8 bg-slate-50/50">
           {viewMode === 'board' ? (
             <div className="flex gap-6 md:gap-8 h-full min-w-max">
                {(['Todo', 'In Progress', 'Completed'] as TaskStatus[]).map(status => (
                  <div key={status} className="w-80 flex flex-col h-full" onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, status)}>
                    <div className="flex items-center justify-between mb-4 px-3">
                       <h3 className="font-bold text-slate-700 flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${status === 'Todo' ? 'bg-slate-300' : status === 'In Progress' ? 'bg-indigo-500' : 'bg-emerald-500'}`} />
                          {status} 
                          <span className="text-[10px] bg-white border border-slate-200 text-slate-400 px-2 py-0.5 rounded-full font-bold shadow-sm">{getTasksByStatus(status).length}</span>
                       </h3>
                       <div className="relative">
                          <button onClick={() => setShowColumnMenu(showColumnMenu === status ? null : status)} className="p-1.5 hover:bg-white rounded-lg transition border border-transparent hover:border-slate-200"><MoreVertical className="w-4 h-4 text-slate-400" /></button>
                          {showColumnMenu === status && (
                            <div className="absolute top-full right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl z-30 w-48 p-2 animate-in slide-in-from-top-1">
                               <button onClick={() => clearColumn(status)} className="w-full text-left px-4 py-3 text-xs font-bold text-red-600 hover:bg-red-50 rounded-xl flex items-center gap-3 transition"><Trash2 className="w-4 h-4" /> Archive Column</button>
                               <button className="w-full text-left px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50 rounded-xl flex items-center gap-3 transition border-t"><Edit2 className="w-4 h-4" /> Rename Stage</button>
                            </div>
                          )}
                       </div>
                    </div>
                    
                    <div className={`flex-1 overflow-y-auto space-y-4 pb-12 scrollbar-hide px-2 transition-all ${draggedTaskId ? 'bg-nexus-primary/5 rounded-[32px] ring-2 ring-nexus-primary ring-inset' : ''}`}>
                       {getTasksByStatus(status).map(task => (
                         <div key={task.id} draggable onDragStart={(e) => handleDragStart(e, task.id)} onClick={() => setShowTaskModal(task)} className="bg-white border border-slate-200 rounded-[24px] p-5 shadow-sm hover:shadow-xl hover:-translate-y-1 hover:border-nexus-primary/30 cursor-grab active:cursor-grabbing transition-all group relative overflow-hidden">
                            <div className="flex justify-between items-start mb-3">
                               <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${task.priority === 'High' ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-500'}`}>{task.priority}</span>
                               <GripVertical className="w-4 h-4 text-slate-200 opacity-0 group-hover:opacity-100 transition" />
                            </div>
                            <h4 className="font-bold text-sm text-slate-900 group-hover:text-nexus-primary transition-colors leading-relaxed">{task.title}</h4>
                            <p className="text-[11px] text-slate-500 mt-2 line-clamp-2 leading-normal">{task.description}</p>
                            
                            <div className="mt-5 pt-4 border-t border-slate-50 flex justify-between items-center">
                               <div className="flex -space-x-2">
                                 {task.assigneeIds.length > 0 ? task.assigneeIds.map(uid => <img key={uid} src={MOCK_USERS.find(u => u.id === uid)?.avatar} className="w-7 h-7 rounded-full border-2 border-white shadow-sm ring-1 ring-slate-100" />) : <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center border-2 border-white shadow-sm"><UserIcon className="w-3.5 h-3.5 text-slate-300" /></div>}
                               </div>
                               <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 group-hover:text-slate-500 transition">
                                  <Clock className="w-3.5 h-3.5" /> Scheduled
                               </div>
                            </div>
                         </div>
                       ))}
                       <button onClick={() => setShowTaskModal({ status })} className="w-full py-5 border-2 border-dashed border-slate-300 rounded-[28px] text-slate-400 hover:text-nexus-primary hover:border-nexus-primary hover:bg-white transition-all text-xs font-bold flex items-center justify-center bg-white/30 backdrop-blur-sm">
                          <Plus className="w-4 h-4 mr-2" /> Quick Add Task
                       </button>
                    </div>
                  </div>
                ))}
             </div>
           ) : (
             <div className="bg-white border border-slate-200 rounded-[32px] shadow-sm overflow-hidden animate-in fade-in max-w-5xl mx-auto">
                <table className="w-full text-left text-sm border-collapse">
                   <thead className="bg-slate-50/80 border-b border-slate-100">
                      <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]"><th className="p-6">Technical Designation</th><th className="p-6">Ownership Mapping</th><th className="p-6 text-center">Execution Phase</th><th className="p-6 text-right">Priority</th></tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                      {getFilteredListTasks().map(t => (
                        <tr key={t.id} onClick={() => setShowTaskModal(t)} className="hover:bg-slate-50 cursor-pointer transition-colors group">
                           <td className="p-6 font-bold text-slate-800 group-hover:text-nexus-primary transition-colors">{t.title}</td>
                           <td className="p-6 flex -space-x-1.5">
                              {t.assigneeIds.map(uid => <img key={uid} src={MOCK_USERS.find(u => u.id === uid)?.avatar} className="w-8 h-8 rounded-full border-2 border-white shadow-sm" />)}
                           </td>
                           <td className="p-6 text-center"><span className="bg-white border border-slate-100 shadow-sm px-3 py-1.5 rounded-xl text-[10px] font-bold text-slate-600 uppercase tracking-widest">{t.status}</span></td>
                           <td className="p-6 text-right"><span className={`text-[10px] font-bold uppercase tracking-[0.1em] ${t.priority === 'High' ? 'text-red-500 bg-red-50' : 'text-slate-400 bg-slate-50'} px-2 py-1 rounded-lg`}>{t.priority}</span></td>
                        </tr>
                      ))}
                   </tbody>
                </table>
             </div>
           )}
        </div>
      </div>

      {/* Task Window */}
      {showTaskModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-[60] flex items-center justify-center p-4 md:p-12 animate-in fade-in duration-300">
           <form onSubmit={handleSaveTask} className="bg-white rounded-[48px] shadow-2xl w-full max-w-6xl h-full flex flex-col overflow-hidden animate-in zoom-in-95">
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                 <div className="flex items-center gap-5">
                    <div className="p-4 bg-nexus-primary text-white rounded-3xl shadow-xl shadow-nexus-primary/20"><Layout className="w-8 h-8" /></div>
                    <div>
                       <h3 className="text-2xl font-bold text-slate-900">Task Intelligence</h3>
                       <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">{activeProject?.name}</span>
                          <span className="w-1 h-1 bg-slate-300 rounded-full" />
                          <span className="text-xs text-nexus-primary font-bold">In-Transit Logic Enabled</span>
                       </div>
                    </div>
                 </div>
                 <button type="button" onClick={() => setShowTaskModal(null)} className="p-3 text-slate-400 hover:bg-slate-200 rounded-full transition"><X className="w-8 h-8" /></button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 md:p-12 flex flex-col lg:flex-row gap-12">
                 <div className="flex-1 space-y-10">
                    <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-3 block ml-2">Identity Mapping</label>
                       <input name="title" required placeholder="Specify task objective..." defaultValue={typeof showTaskModal === 'object' && showTaskModal && 'title' in showTaskModal ? showTaskModal.title : ''} className="w-full text-4xl font-bold border-none outline-none focus:ring-0 placeholder:text-slate-200 bg-transparent" />
                    </div>
                    <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-3 block ml-2">Contextual Details</label>
                       <div className="relative group">
                          <textarea name="description" placeholder="Rich technical insights and alignment details..." defaultValue={typeof showTaskModal === 'object' && showTaskModal && 'description' in showTaskModal ? showTaskModal.description : ''} rows={14} className="w-full p-8 bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-[40px] focus:ring-4 focus:ring-nexus-primary/10 focus:border-nexus-primary outline-none transition-all font-mono text-sm leading-relaxed" />
                          <div className="absolute bottom-6 right-6 flex gap-2">
                             <button type="button" className="p-3 bg-white border shadow-sm rounded-2xl text-slate-400 hover:text-nexus-primary transition"><Sparkles className="w-5 h-5" /></button>
                             <button type="button" className="p-3 bg-white border shadow-sm rounded-2xl text-slate-400 hover:text-nexus-primary transition"><Paperclip className="w-5 h-5" /></button>
                          </div>
                       </div>
                    </div>
                 </div>
                 
                 <div className="w-full lg:w-96 space-y-8">
                    <div className="p-10 bg-slate-50/80 rounded-[48px] border border-slate-200 space-y-10 shadow-inner">
                       <h4 className="text-xs font-bold text-slate-900 uppercase tracking-[0.2em] border-b border-slate-200 pb-6">Phase Configuration</h4>
                       <div className="space-y-6">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-2 block mb-2">Execution Phase</label>
                            <select name="status" defaultValue={typeof showTaskModal === 'object' && showTaskModal && 'status' in showTaskModal ? showTaskModal.status : 'Todo'} className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-bold shadow-sm outline-none appearance-none cursor-pointer">
                               <option value="Todo">Ready for Dev (Backlog)</option><option value="In Progress">Active Sprint (Execution)</option><option value="Completed">Verified & Deployed</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-2 block mb-2">Strategic Priority</label>
                            <select name="priority" defaultValue={typeof showTaskModal === 'object' && showTaskModal && 'priority' in showTaskModal ? showTaskModal.priority : 'Medium'} className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-bold shadow-sm outline-none appearance-none cursor-pointer">
                               <option value="High">P0: Immediate Alignment</option><option value="Medium">P1: Standard Flow</option><option value="Low">P2: Maintenance Tier</option>
                            </select>
                          </div>
                       </div>
                       
                       <div className="pt-8 border-t border-slate-200">
                          <div className="flex items-center gap-3 mb-5 ml-2"><Users className="w-4 h-4 text-slate-400" /><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ownership Mapping</label></div>
                          <div className="flex flex-wrap gap-3">
                             {MOCK_USERS.slice(0,3).map(u => (
                                <div key={u.id} className="relative group/avatar">
                                   <img src={u.avatar} className="w-10 h-10 rounded-2xl ring-4 ring-white shadow-md hover:ring-nexus-primary transition-all cursor-pointer" />
                                   <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-900 text-white text-[10px] px-2 py-1 rounded-md opacity-0 group-hover/avatar:opacity-100 transition whitespace-nowrap">{u.name}</div>
                                </div>
                             ))}
                             <button type="button" className="w-10 h-10 rounded-2xl border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 hover:text-nexus-primary hover:border-nexus-primary transition bg-white shadow-sm hover:shadow-lg"><Plus className="w-5 h-5"/></button>
                          </div>
                       </div>
                    </div>
                 </div>
              </div>
              
              <div className="p-8 md:p-10 border-t bg-slate-50 flex justify-end gap-5">
                 <button type="button" onClick={() => setShowTaskModal(null)} className="px-10 py-4 text-slate-500 font-bold transition hover:text-slate-800">Discard Draft</button>
                 <button type="submit" className="px-16 py-4 bg-nexus-primary text-white font-bold rounded-[24px] shadow-2xl shadow-nexus-primary/30 transition hover:-translate-y-1 active:scale-95">Commit Alignment Update</button>
              </div>
           </form>
        </div>
      )}

      {/* Project Setup Modal (Workspace Governance) */}
      {showProjectModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[60] flex items-center justify-center p-4">
           <form onSubmit={handleAddProject} className="bg-white rounded-[40px] md:rounded-[56px] shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
              {/* Fixed Header */}
              <div className="flex justify-between items-center p-8 md:p-12 pb-6 border-b border-slate-100 bg-white z-10">
                 <div className="flex items-center gap-4">
                   <div className="w-12 h-12 md:w-14 md:h-14 rounded-3xl bg-indigo-50 flex items-center justify-center text-nexus-primary shadow-inner shadow-indigo-100/50"><Layers className="w-6 h-6 md:w-7 md:h-7" /></div>
                   <div>
                      <h3 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">{showProjectModal === 'new' ? 'Initiate Workspace' : 'Workspace Governance'}</h3>
                      <p className="text-xs md:text-sm text-slate-400 font-medium">Define strategic alignment parameters.</p>
                   </div>
                 </div>
                 <button type="button" onClick={() => setShowProjectModal(null)} className="p-2 hover:bg-slate-100 rounded-full transition"><X className="w-6 h-6 md:w-8 md:h-8 text-slate-300" /></button>
              </div>
              
              {/* Scrollable Content Area */}
              <div className="flex-1 overflow-y-auto p-8 md:p-12 pt-6 space-y-8 scrollbar-hide">
                 <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-3 block ml-2">Workspace Operational Name</label>
                    <input name="name" required defaultValue={typeof showProjectModal === 'object' ? showProjectModal.name : ''} className="w-full p-4 md:p-5 bg-slate-50 border border-slate-100 rounded-2xl md:rounded-3xl outline-none focus:ring-4 focus:ring-nexus-primary/10 focus:bg-white transition-all font-bold text-base md:text-lg" placeholder="e.g. Project Hyperdrive Q4" />
                 </div>
                 
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-3 block ml-2">Strategic Deadline</label>
                       <div className="relative">
                          <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                          <input name="deadline" type="date" defaultValue={typeof showProjectModal === 'object' ? showProjectModal.deadline : ''} className="w-full p-4 md:p-5 pl-12 bg-slate-50 border border-slate-100 rounded-2xl md:rounded-3xl outline-none focus:bg-white transition text-sm md:text-base" />
                       </div>
                    </div>
                    <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-3 block ml-2">Identity Signature (Color)</label>
                       <div className="flex items-center gap-4">
                          <input name="color" type="color" defaultValue={typeof showProjectModal === 'object' ? showProjectModal.color : '#6366f1'} className="w-12 h-12 md:w-16 md:h-16 p-1 bg-white border border-slate-200 rounded-2xl md:rounded-3xl shadow-sm cursor-pointer" />
                          <span className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-widest">Workspace Branding</span>
                       </div>
                    </div>
                 </div>
                 
                 <div>
                    <div className="flex items-center justify-between mb-4 px-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Security & Access Configuration</label>
                       <div className="flex items-center gap-1.5 text-nexus-primary bg-indigo-50 px-2 py-1 rounded-lg">
                         <ShieldCheck className="w-3 h-3" />
                         <span className="text-[9px] font-bold uppercase tracking-wider">Enterprise-Grade Auth</span>
                       </div>
                    </div>
                    
                    <div className="p-6 md:p-8 bg-slate-50/80 border border-slate-100 rounded-[32px] md:rounded-[40px] space-y-6 shadow-inner relative">
                       {/* Visibility Multi-Select Option */}
                       <div className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm relative z-20">
                          <div className="flex items-start justify-between">
                             <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-nexus-primary">
                                  <Globe className="w-5 h-5" />
                                </div>
                                <div className="min-w-0">
                                   <h5 className="text-sm font-bold text-slate-700 truncate">Institutional Scope</h5>
                                   <p className="text-[10px] text-slate-400">All institutions can query by default</p>
                                </div>
                             </div>
                             <div className="relative">
                               <button 
                                 type="button" 
                                 onClick={() => setShowOrgDropdown(!showOrgDropdown)}
                                 className="bg-slate-50 border border-slate-200 rounded-xl px-3 md:px-4 py-2 text-[10px] md:text-xs font-bold text-slate-600 outline-none flex items-center gap-2 hover:bg-slate-100 transition whitespace-nowrap"
                               >
                                 {selectedOrgIds.length === 0 ? "Global Scope" : selectedOrgIds.length === MOCK_ORGS.length ? "All Orgs" : `${selectedOrgIds.length} Orgs`}
                                 <ChevronDown className="w-3 h-3" />
                               </button>
                               {showOrgDropdown && (
                                 <div className="absolute top-full right-0 mt-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-2xl z-[70] p-2 animate-in slide-in-from-top-1 overflow-hidden">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 py-2 border-b">Select Institutions</div>
                                    <div className="max-h-48 overflow-y-auto mt-2 scrollbar-hide">
                                       {MOCK_ORGS.map(org => (
                                          <button 
                                            key={org.id} 
                                            type="button"
                                            onClick={() => toggleOrgSelection(org.id)}
                                            className="w-full text-left p-3 hover:bg-slate-50 rounded-xl flex items-center gap-3 transition group"
                                          >
                                             {selectedOrgIds.includes(org.id) ? (
                                               <CheckSquare className="w-4 h-4 text-nexus-primary" />
                                             ) : (
                                               <Square className="w-4 h-4 text-slate-300" />
                                             )}
                                             <span className={`text-xs font-bold ${selectedOrgIds.includes(org.id) ? 'text-nexus-primary' : 'text-slate-600'}`}>{org.name}</span>
                                          </button>
                                       ))}
                                    </div>
                                    <div className="p-2 border-t mt-2 flex gap-2 bg-slate-50/50">
                                       <button type="button" onClick={() => setSelectedOrgIds(MOCK_ORGS.map(o => o.id))} className="flex-1 py-1.5 bg-white border rounded-lg text-[9px] font-bold uppercase text-slate-500 shadow-sm transition active:scale-95">All</button>
                                       <button type="button" onClick={() => setSelectedOrgIds([])} className="flex-1 py-1.5 bg-white border rounded-lg text-[9px] font-bold uppercase text-slate-500 shadow-sm transition active:scale-95">None</button>
                                    </div>
                                 </div>
                               )}
                             </div>
                          </div>
                          {selectedOrgIds.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-4 ml-13">
                               {selectedOrgIds.map(id => (
                                  <span key={id} className="text-[9px] font-bold bg-indigo-50 text-nexus-primary px-2 py-1 rounded-lg border border-indigo-100 flex items-center gap-1 transition-all hover:bg-indigo-100">
                                    {MOCK_ORGS.find(o => o.id === id)?.name}
                                    <button onClick={() => toggleOrgSelection(id)} type="button" className="hover:text-red-500"><X className="w-2 h-2"/></button>
                                  </span>
                               ))}
                            </div>
                          )}
                       </div>

                       {/* Restricted Access Option */}
                       <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 shadow-sm relative z-10">
                          <div className="flex items-center gap-3">
                             <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600">
                               <Lock className="w-5 h-5" />
                             </div>
                             <div className="min-w-0">
                                <h5 className="text-sm font-bold text-slate-700 truncate">Privileged Access</h5>
                                <p className="text-[10px] text-slate-400">Restrict to Teams and Whitelisted members</p>
                             </div>
                          </div>
                          <button 
                            type="button" 
                            onClick={() => setShowRestrictedConfig(true)}
                            className="text-[10px] font-bold text-purple-600 uppercase border border-purple-200 px-4 py-2 rounded-xl hover:bg-purple-50 transition active:scale-95 shadow-sm whitespace-nowrap"
                          >
                            Configure
                          </button>
                       </div>

                       {/* Admin Note */}
                       <div className="flex items-start gap-3 p-4 bg-blue-50/50 rounded-2xl border border-blue-100">
                          <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                          <p className="text-[9px] md:text-[10px] text-blue-700 leading-relaxed font-medium">
                            <span className="font-bold">Admin Override:</span> Global System Admins and pertinent Managers have inherent read/write permissions for all jurisdictional workspaces.
                          </p>
                       </div>

                       {/* Restricted Access Sub-Modal */}
                       {showRestrictedConfig && (
                         <div className="absolute inset-0 bg-white/98 backdrop-blur-sm z-30 rounded-[32px] md:rounded-[40px] p-6 md:p-8 flex flex-col animate-in fade-in zoom-in-95 shadow-2xl">
                            <div className="flex justify-between items-center mb-6">
                               <h4 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Lock className="w-5 h-5 text-purple-600" /> Restriction Policy</h4>
                               <button type="button" onClick={() => setShowRestrictedConfig(false)} className="p-2 hover:bg-slate-100 rounded-full transition text-slate-400"><X className="w-5 h-5" /></button>
                            </div>
                            <div className="flex-1 space-y-6 overflow-y-auto pr-2 scrollbar-hide">
                               <div>
                                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3 ml-1">Permitted Teams</label>
                                  <div className="grid grid-cols-1 gap-2">
                                     {['Platform Engineering', 'Strategy Ops', 'Design Sync'].map(team => (
                                       <label key={team} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl cursor-pointer hover:border-nexus-primary transition active:scale-[0.98]">
                                          <input type="checkbox" defaultChecked className="w-4 h-4 rounded text-nexus-primary focus:ring-nexus-primary" />
                                          <span className="text-xs font-bold text-slate-700">{team}</span>
                                       </label>
                                     ))}
                                  </div>
                               </div>
                               <div>
                                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3 ml-1">Individual Whitelist</label>
                                  <div className="flex flex-wrap gap-2">
                                     {MOCK_USERS.map(u => (
                                       <button key={u.id} type="button" className="p-1 rounded-full border-2 border-transparent hover:border-nexus-primary transition-all group/usr active:scale-90">
                                          <img src={u.avatar} className="w-9 h-9 md:w-10 md:h-10 rounded-full grayscale hover:grayscale-0 transition-all border border-slate-100" title={u.name} />
                                       </button>
                                     ))}
                                     <button type="button" className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 transition-colors hover:border-nexus-primary hover:text-nexus-primary"><Plus className="w-4 h-4" /></button>
                                  </div>
                               </div>
                            </div>
                            <div className="pt-6 border-t mt-4">
                               <button type="button" onClick={() => setShowRestrictedConfig(false)} className="w-full bg-nexus-primary text-white font-bold py-3 rounded-2xl shadow-lg shadow-nexus-primary/20 hover:-translate-y-1 transition active:scale-95">Commit Restriction Mapping</button>
                            </div>
                         </div>
                       )}
                    </div>
                 </div>
              </div>

              {/* Fixed Footer */}
              <div className="p-8 md:p-12 pt-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-5">
                 <button type="button" onClick={() => setShowProjectModal(null)} className="px-6 md:px-10 py-3 md:py-4 text-slate-500 font-bold transition hover:text-slate-800 text-sm md:text-base">Discard Setup</button>
                 <button type="submit" className="px-10 md:px-16 py-3 md:py-4 bg-nexus-primary text-white font-bold rounded-[20px] md:rounded-[24px] shadow-2xl shadow-nexus-primary/30 transition hover:-translate-y-1 active:scale-95 text-sm md:text-base">Commit Governance</button>
              </div>
           </form>
        </div>
      )}
    </div>
  );
};
