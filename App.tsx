import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Pulse } from './components/Pulse';
import { Brain } from './components/Brain';
import { Academy } from './components/Academy';
import { Projects } from './components/Projects';
import { Admin } from './components/Admin';
import { Settings } from './components/Settings';
import { AppModule } from './types';
import { Menu } from 'lucide-react';

export default function App() {
  const [activeModule, setActiveModule] = useState<AppModule>(AppModule.PULSE);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const renderContent = () => {
    switch (activeModule) {
      case AppModule.PULSE:
        return <Pulse />;
      case AppModule.BRAIN:
        return <Brain />;
      case AppModule.ACADEMY:
        return <Academy />;
      case AppModule.PROJECTS:
        return <Projects />;
      case AppModule.ADMIN:
        return <Admin />;
      case AppModule.SETTINGS:
        return <Settings />;
      default:
        return <Pulse />;
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans selection:bg-nexus-primary/20">
      
      {/* Mobile Menu Toggle */}
      <div className="md:hidden fixed top-4 right-4 z-50">
        <button 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 bg-white border border-slate-200 rounded-lg shadow-md text-slate-600"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Desktop Sidebar */}
      <Sidebar activeModule={activeModule} setActiveModule={setActiveModule} />

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm md:hidden">
          <div className="p-4 h-full">
             <div className="bg-white h-full rounded-xl shadow-2xl overflow-hidden">
                <Sidebar activeModule={activeModule} setActiveModule={(m) => {
                  setActiveModule(m);
                  setMobileMenuOpen(false);
                }} />
             </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 relative overflow-hidden bg-slate-50">
        {renderContent()}
      </main>
    </div>
  );
}