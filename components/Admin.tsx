import React, { useState, useMemo } from 'react';
import { 
  Building2, Users, Layers, Plus, Search, Edit2, Trash2, Shield, Filter, X, 
  ArrowRightLeft, Lock, Mail, User as UserIcon, CheckCircle2, AlertCircle, 
  ChevronRight, ArrowLeft, MoreVertical, Globe, HardDrive
} from 'lucide-react';
import { Organization, Department, Team, User, UserRole } from '../types';

// Mock Data
const MOCK_ORGS: Organization[] = [
  { id: 'o1', name: 'Nexus Solutions' },
  { id: 'o2', name: 'Global Tech' }
];

const MOCK_DEPTS: Department[] = [
  { id: 'd1', organizationId: 'o1', name: 'Engineering' },
  { id: 'd2', organizationId: 'o1', name: 'Strategic Ops' },
  { id: 'd3', organizationId: 'o2', name: 'R&D Labs' },
  { id: 'd4', organizationId: 'o2', name: 'Sales & Growth' }
];

const MOCK_TEAMS: Team[] = [
  { id: 't1', departmentId: 'd1', name: 'Core Infrastructure', managerId: 'u1' },
  { id: 't2', departmentId: 'd1', name: 'Frontend Excellence', managerId: 'u2' },
  { id: 't3', departmentId: 'd3', name: 'AI Research', managerId: 'u3' }
];

const MOCK_USERS: User[] = [
  { id: 'u1', name: 'Alex Chen', email: 'alex@nexus.com', role: 'SuperAdmin', avatar: 'https://i.pravatar.cc/150?u=u1', organizationId: 'o1', departmentId: 'd1', teamId: 't1' },
  { id: 'u2', name: 'Sarah Jones', email: 'sarah@nexus.com', role: 'TeamManager', avatar: 'https://i.pravatar.cc/150?u=u2', organizationId: 'o1', departmentId: 'd1', teamId: 't2' },
  { id: 'u3', name: 'Mike Ross', email: 'mike@tech.com', role: 'Contributor', avatar: 'https://i.pravatar.cc/150?u=u3', organizationId: 'o2', departmentId: 'd3', teamId: 't3' },
];

type AdminTab = 'orgs' | 'depts' | 'teams' | 'users';

export const Admin: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('orgs');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Hierarchy Filters
  const [filterOrgId, setFilterOrgId] = useState<string | null>(null);
  const [filterDeptId, setFilterDeptId] = useState<string | null>(null);
  const [filterTeamId, setFilterTeamId] = useState<string | null>(null);

  const resetFilters = () => {
    setFilterOrgId(null);
    setFilterDeptId(null);
    setFilterTeamId(null);
  };

  // --- Filtered Data Calculations ---
  const filteredOrgs = useMemo(() => 
    MOCK_ORGS.filter(o => o.name.toLowerCase().includes(searchTerm.toLowerCase())), 
    [searchTerm]
  );

  const filteredDepts = useMemo(() => 
    MOCK_DEPTS.filter(d => {
      const matchesSearch = d.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesOrg = filterOrgId ? d.organizationId === filterOrgId : true;
      return matchesSearch && matchesOrg;
    }), 
    [searchTerm, filterOrgId]
  );

  const filteredTeams = useMemo(() => 
    MOCK_TEAMS.filter(t => {
      const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase());
      const dept = MOCK_DEPTS.find(d => d.id === t.departmentId);
      const matchesDept = filterDeptId ? t.departmentId === filterDeptId : true;
      const matchesOrg = filterOrgId ? dept?.organizationId === filterOrgId : true;
      return matchesSearch && matchesDept && matchesOrg;
    }), 
    [searchTerm, filterDeptId, filterOrgId]
  );

  const filteredUsers = useMemo(() => 
    MOCK_USERS.filter(u => {
      const matchesSearch = u.name.toLowerCase().includes(searchTerm.toLowerCase()) || u.email.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesTeam = filterTeamId ? u.teamId === filterTeamId : true;
      const matchesDept = filterDeptId ? u.departmentId === filterDeptId : true;
      const matchesOrg = filterOrgId ? u.organizationId === filterOrgId : true;
      return matchesSearch && matchesTeam && matchesDept && matchesOrg;
    }), 
    [searchTerm, filterTeamId, filterDeptId, filterOrgId]
  );

  // --- Handlers ---
  const handleOrgClick = (orgId: string) => {
    setFilterOrgId(orgId);
    setFilterDeptId(null);
    setFilterTeamId(null);
    setActiveTab('depts');
  };

  const handleDeptClick = (deptId: string) => {
    const dept = MOCK_DEPTS.find(d => d.id === deptId);
    if (dept) setFilterOrgId(dept.organizationId);
    setFilterDeptId(deptId);
    setFilterTeamId(null);
    setActiveTab('teams');
  };

  const handleTeamClick = (teamId: string) => {
    const team = MOCK_TEAMS.find(t => t.id === teamId);
    if (team) {
      setFilterTeamId(teamId);
      const dept = MOCK_DEPTS.find(d => d.id === team.departmentId);
      if (dept) {
        setFilterDeptId(dept.id);
        setFilterOrgId(dept.organizationId);
      }
    }
    setActiveTab('users');
  };

  // Breadcrumb Helpers
  const currentOrg = MOCK_ORGS.find(o => o.id === filterOrgId);
  const currentDept = MOCK_DEPTS.find(d => d.id === filterDeptId);
  const currentTeam = MOCK_TEAMS.find(t => t.id === filterTeamId);

  return (
    <div className="p-4 md:p-8 h-screen bg-slate-50 overflow-y-auto font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h2 className="text-4xl font-bold text-slate-900 tracking-tight">System Control</h2>
            <p className="text-slate-500 font-medium mt-1">Global entity management and hierarchy governance.</p>
          </div>
          <div className="flex gap-3">
             <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  placeholder={`Search ${activeTab}...`} 
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="bg-white border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-nexus-primary outline-none transition-all w-64 shadow-sm"
                />
             </div>
             <button className="flex items-center gap-2 bg-nexus-primary text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-nexus-primary/20 hover:-translate-y-0.5 transition active:scale-95">
                <Plus className="w-4 h-4" /> Provision Entity
             </button>
          </div>
        </div>

        {/* Top-Level Tabs */}
        <div className="flex flex-wrap items-center gap-2 md:gap-8 border-b border-slate-200">
           {[
             { id: 'orgs', label: 'Organizations', icon: Building2 },
             { id: 'depts', label: 'Departments', icon: Layers },
             { id: 'teams', label: 'Teams', icon: Users },
             { id: 'users', label: 'Users', icon: UserIcon },
           ].map(tab => {
             const Icon = tab.icon;
             return (
               <button 
                key={tab.id} 
                onClick={() => setActiveTab(tab.id as AdminTab)}
                className={`pb-4 px-1 text-sm font-bold flex items-center gap-2 transition-all relative ${
                  activeTab === tab.id ? 'text-nexus-primary' : 'text-slate-400 hover:text-slate-600'
                }`}
               >
                 <Icon className="w-4 h-4" />
                 {tab.label}
                 {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-1 bg-nexus-primary rounded-t-full" />}
               </button>
             );
           })}
        </div>

        {/* Filter Breadcrumbs (Active only when drill-down is engaged) */}
        {(filterOrgId || filterDeptId || filterTeamId) && (
          <div className="flex flex-wrap items-center gap-2 bg-indigo-50/50 p-3 rounded-2xl border border-indigo-100 animate-in slide-in-from-top-2">
             <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-400 uppercase tracking-widest px-2">Active Context:</div>
             {filterOrgId && (
               <div className="flex items-center gap-1.5 bg-white border border-indigo-100 px-3 py-1.5 rounded-xl text-xs font-bold text-indigo-700 shadow-sm">
                 <Building2 className="w-3 h-3" /> {currentOrg?.name}
                 <button onClick={() => { setFilterOrgId(null); setFilterDeptId(null); setFilterTeamId(null); }} className="p-0.5 hover:bg-slate-100 rounded ml-1"><X className="w-3 h-3" /></button>
               </div>
             )}
             {filterDeptId && (
               <>
                 <ChevronRight className="w-3 h-3 text-indigo-200" />
                 <div className="flex items-center gap-1.5 bg-white border border-indigo-100 px-3 py-1.5 rounded-xl text-xs font-bold text-indigo-700 shadow-sm">
                   <Layers className="w-3 h-3" /> {currentDept?.name}
                   <button onClick={() => { setFilterDeptId(null); setFilterTeamId(null); }} className="p-0.5 hover:bg-slate-100 rounded ml-1"><X className="w-3 h-3" /></button>
                 </div>
               </>
             )}
             {filterTeamId && (
               <>
                 <ChevronRight className="w-3 h-3 text-indigo-200" />
                 <div className="flex items-center gap-1.5 bg-white border border-indigo-100 px-3 py-1.5 rounded-xl text-xs font-bold text-indigo-700 shadow-sm">
                   <Users className="w-3 h-3" /> {currentTeam?.name}
                   <button onClick={() => setFilterTeamId(null)} className="p-0.5 hover:bg-slate-100 rounded ml-1"><X className="w-3 h-3" /></button>
                 </div>
               </>
             )}
             <button onClick={resetFilters} className="ml-auto text-[10px] font-bold text-slate-400 hover:text-red-500 uppercase tracking-widest transition">Clear All Filters</button>
          </div>
        )}

        {/* Tab Content Area */}
        <div className="min-h-[500px]">
           {activeTab === 'orgs' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                 {filteredOrgs.map(o => (
                    <div 
                      key={o.id} 
                      onClick={() => handleOrgClick(o.id)}
                      className="bg-white border border-slate-200 p-8 rounded-[40px] shadow-sm hover:shadow-2xl hover:border-nexus-primary hover:-translate-y-2 transition-all cursor-pointer group relative overflow-hidden"
                    >
                       <div className="p-4 bg-indigo-50 rounded-[24px] w-fit mb-6 text-nexus-primary group-hover:scale-110 transition-transform duration-500"><Building2 className="w-8 h-8" /></div>
                       <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{o.name}</h3>
                       <p className="text-slate-400 text-sm mt-2 leading-relaxed">Enterprise management and partitioned identity mapping for this entity.</p>
                       <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-10 border-t pt-6 group-hover:text-nexus-primary transition-colors">
                         <span>Drill Down to Depts</span>
                         <ChevronRight className="w-4 h-4 group-hover:translate-x-2 transition-transform" />
                       </div>
                    </div>
                 ))}
              </div>
           )}

           {activeTab === 'depts' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                 {filteredDepts.map(d => (
                    <div 
                      key={d.id} 
                      onClick={() => handleDeptClick(d.id)}
                      className="bg-white border border-slate-200 p-8 rounded-[40px] shadow-sm hover:shadow-2xl hover:border-purple-500 hover:-translate-y-2 transition-all cursor-pointer group relative overflow-hidden"
                    >
                       <div className="p-4 bg-purple-50 rounded-[24px] w-fit mb-6 text-purple-600 group-hover:scale-110 transition-transform duration-500"><Layers className="w-8 h-8" /></div>
                       <div className="flex items-center gap-2">
                          <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{d.name}</h3>
                          {!filterOrgId && <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full font-bold uppercase">Org: {MOCK_ORGS.find(o => o.id === d.organizationId)?.name.split(' ')[0]}</span>}
                       </div>
                       <p className="text-slate-400 text-sm mt-2 leading-relaxed">Departmental oversight for core institutional pillars.</p>
                       <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-10 border-t pt-6 group-hover:text-purple-600 transition-colors">
                         <span>Drill Down to Teams</span>
                         <ChevronRight className="w-4 h-4 group-hover:translate-x-2 transition-transform" />
                       </div>
                    </div>
                 ))}
              </div>
           )}

           {activeTab === 'teams' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                 {filteredTeams.map(t => (
                    <div 
                      key={t.id} 
                      onClick={() => handleTeamClick(t.id)}
                      className="bg-white border border-slate-200 p-8 rounded-[40px] shadow-sm hover:shadow-2xl hover:border-blue-500 hover:-translate-y-2 transition-all cursor-pointer group relative overflow-hidden"
                    >
                       <div className="p-4 bg-blue-50 rounded-[24px] w-fit mb-6 text-blue-600 group-hover:scale-110 transition-transform duration-500"><Users className="w-8 h-8" /></div>
                       <div className="flex items-center gap-2">
                          <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{t.name}</h3>
                       </div>
                       <p className="text-slate-400 text-sm mt-2 leading-relaxed">Cross-functional team management and active member coordination.</p>
                       <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-10 border-t pt-6 group-hover:text-blue-600 transition-colors">
                         <span>Drill Down to Members</span>
                         <ChevronRight className="w-4 h-4 group-hover:translate-x-2 transition-transform" />
                       </div>
                    </div>
                 ))}
              </div>
           )}

           {activeTab === 'users' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {filteredUsers.map(u => (
                    <div 
                      key={u.id} 
                      className="bg-white border border-slate-200 p-6 rounded-[32px] shadow-sm hover:shadow-xl hover:border-nexus-primary transition-all group flex items-center gap-5 relative overflow-hidden"
                    >
                       <div className="relative">
                          <img src={u.avatar} className="w-16 h-16 rounded-2xl object-cover shadow-md ring-4 ring-white" alt={u.name} />
                          <div className="absolute -bottom-1 -right-1 p-1.5 bg-green-500 rounded-lg text-white shadow-lg"><Shield className="w-3 h-3" /></div>
                       </div>
                       <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-slate-900 truncate text-lg group-hover:text-nexus-primary transition-colors">{u.name}</h3>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{u.role}</p>
                          <div className="flex gap-1.5 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="p-2 bg-slate-50 hover:bg-nexus-primary hover:text-white rounded-xl text-slate-400 transition shadow-sm"><Edit2 className="w-3.5 h-3.5" /></button>
                            <button className="p-2 bg-slate-50 hover:bg-red-500 hover:text-white rounded-xl text-slate-400 transition shadow-sm"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                       </div>
                    </div>
                 ))}
              </div>
           )}

           {(activeTab === 'orgs' && filteredOrgs.length === 0) || 
            (activeTab === 'depts' && filteredDepts.length === 0) || 
            (activeTab === 'teams' && filteredTeams.length === 0) || 
            (activeTab === 'users' && filteredUsers.length === 0) ? (
              <div className="py-40 text-center flex flex-col items-center gap-6 animate-pulse">
                <Shield className="w-12 h-12 text-slate-200" />
                <p className="font-bold text-slate-300 uppercase tracking-[0.3em] text-xs italic">No matching entities found in this partition</p>
              </div>
            ) : null}
        </div>
      </div>
    </div>
  );
};
