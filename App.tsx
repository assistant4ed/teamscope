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

  if (!process.env.GEMINI_API_KEY) {
    return (
      <div className="flex items-center justify-center h-screen bg-red-50 text-red-900">
        <div className="text-center p-8 border border-red-200 rounded-lg bg-white shadow-md">
          <h1 className="text-2xl font-bold mb-4">Configuration Error</h1>
          <p>The <code>GEMINI_API_KEY</code> environment variable is not set.</p>
          <p>Please set it in a <code>.env.local</code> file for local development or in your deployment settings.</p>
        </div>
      </div>
    );
  }

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