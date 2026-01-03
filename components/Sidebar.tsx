import React from 'react';
import { Activity, Brain, GraduationCap, Settings, Hexagon, ShieldCheck, Layout } from 'lucide-react';
import { AppModule } from '../types';

interface SidebarProps {
  activeModule: AppModule;
  setActiveModule: (module: AppModule) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeModule, setActiveModule }) => {
  const navItems = [
    { id: AppModule.PULSE, icon: Activity, label: 'The Pulse' },
    { id: AppModule.BRAIN, icon: Brain, label: 'The Brain' },
    { id: AppModule.ACADEMY, icon: GraduationCap, label: 'The Academy' },
    { id: AppModule.PROJECTS, icon: Layout, label: 'Projects' },
    { id: AppModule.ADMIN, icon: ShieldCheck, label: 'Admin Control' },
    { id: AppModule.SETTINGS, icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="w-64 h-screen bg-white border-r border-slate-200 flex flex-col hidden md:flex shadow-sm z-10">
      <div className="p-6 flex items-center space-x-3">
        <div className="bg-nexus-primary/10 p-2 rounded-lg">
          <Hexagon className="w-6 h-6 text-nexus-primary fill-nexus-primary/20" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 font-sans tracking-tight">
          TEAMSCOPE
        </h1>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = activeModule === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveModule(item.id)}
              className={`w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-all duration-200 group ${
                isActive
                  ? 'bg-nexus-primary/10 text-nexus-primary font-semibold'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? 'text-nexus-primary' : 'text-slate-400 group-hover:text-slate-600'}`} />
              <span className={isActive ? 'font-semibold' : 'font-medium'}>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200">
        <div className="flex items-center space-x-3 hover:bg-slate-50 p-2 rounded-lg cursor-pointer transition">
          <img
            src="https://i.pravatar.cc/150?u=u1"
            alt="User"
            className="w-9 h-9 rounded-full border border-slate-200"
          />
          <div>
            <p className="text-sm font-semibold text-slate-800">Alex Chen</p>
            <p className="text-xs text-slate-500">Super Admin</p>
          </div>
        </div>
      </div>
    </div>
  );
};