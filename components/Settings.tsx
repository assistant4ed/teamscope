import React, { useState } from 'react';
import { User, Bell, Lock, Save, Globe } from 'lucide-react';

export const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'security'>('profile');

  return (
    <div className="p-8 h-screen bg-slate-50 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Settings</h2>
        <p className="text-slate-500 mb-8">Manage your account preferences and security.</p>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Settings Sidebar */}
          <div className="w-full md:w-64 flex-shrink-0">
            <nav className="space-y-1">
              {[
                { id: 'profile', icon: User, label: 'My Profile' },
                { id: 'notifications', icon: Bell, label: 'Notifications' },
                { id: 'security', icon: Lock, label: 'Security' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                    activeTab === item.id 
                    ? 'bg-white shadow-sm text-nexus-primary border border-slate-200' 
                    : 'text-slate-500 hover:bg-white/50 hover:text-slate-900'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Settings Content */}
          <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm p-8">
            {activeTab === 'profile' && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-4">Profile Details</h3>
                
                <div className="flex items-center space-x-6">
                  <img src="https://picsum.photos/100/100" className="w-20 h-20 rounded-full border-4 border-slate-50" />
                  <button className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
                    Change Avatar
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                    <input type="text" defaultValue="Alex Chen" className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-nexus-primary focus:border-nexus-primary outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                    <input type="email" defaultValue="alex@acme.com" className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-nexus-primary focus:border-nexus-primary outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Job Title</label>
                    <input type="text" defaultValue="Engineering Lead" className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-nexus-primary focus:border-nexus-primary outline-none" />
                  </div>
                   <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Timezone</label>
                    <div className="flex items-center border border-slate-300 rounded-lg bg-slate-50 px-3 py-2.5 text-slate-500">
                      <Globe className="w-4 h-4 mr-2" /> UTC-08:00 (Pacific Time)
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <button className="flex items-center px-6 py-2 bg-nexus-primary text-white font-medium rounded-lg hover:bg-nexus-primaryHover shadow-sm transition">
                    <Save className="w-4 h-4 mr-2" /> Save Changes
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-6">
                 <h3 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-4">Notification Preferences</h3>
                 <div className="space-y-4">
                    {[
                      'Daily Pulse Reminders (Email)',
                      'Daily Pulse Reminders (Slack)',
                      'Mentioned in Brain Chat',
                      'Weekly Team Summary Report'
                    ].map((item, i) => (
                      <div key={i} className="flex items-center justify-between py-2">
                        <span className="text-slate-700 font-medium">{item}</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" defaultChecked={i % 2 === 0} className="sr-only peer" />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-nexus-primary"></div>
                        </label>
                      </div>
                    ))}
                 </div>
              </div>
            )}

             {activeTab === 'security' && (
              <div className="space-y-6">
                 <h3 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-4">Security</h3>
                 <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg bg-slate-50">
                    <div>
                      <h4 className="font-bold text-slate-900">Two-Factor Authentication</h4>
                      <p className="text-sm text-slate-500">Secure your account with 2FA.</p>
                    </div>
                    <button className="text-nexus-primary font-medium hover:underline">Enable</button>
                 </div>
                 <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg bg-slate-50">
                    <div>
                      <h4 className="font-bold text-slate-900">Password</h4>
                      <p className="text-sm text-slate-500">Last changed 3 months ago.</p>
                    </div>
                    <button className="text-nexus-primary font-medium hover:underline">Change Password</button>
                 </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
