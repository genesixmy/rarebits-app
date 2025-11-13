import React, { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

const Layout = ({ user, profile, onSignOut, onAddItem, children }) => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background text-foreground transition-colors duration-300">
      <Sidebar 
        user={user} 
        profile={profile} 
        isSidebarOpen={isSidebarOpen} 
        setSidebarOpen={setSidebarOpen} 
      />
      <main className="flex-1 flex flex-col min-w-0">
        <Header 
          user={user}
          profile={profile}
          onToggleSidebar={() => setSidebarOpen(true)}
          onAddItem={onAddItem}
          onSignOut={onSignOut}
        />
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;