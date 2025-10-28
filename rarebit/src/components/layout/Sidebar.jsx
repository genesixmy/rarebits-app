import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Home, Package, Receipt, Settings, Users, Wallet } from 'lucide-react';

const Sidebar = ({ isSidebarOpen, setSidebarOpen }) => {
  const location = useLocation();
  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const navItems = [
    { path: '/', label: 'Papan Pemuka', icon: <Home className="w-5 h-5" /> },
    { path: '/inventory', label: 'Inventori', icon: <Package className="w-5 h-5" /> },
    { path: '/sales', label: 'Jualan', icon: <Receipt className="w-5 h-5" /> },
    { path: '/clients', label: 'Pelanggan', icon: <Users className="w-5 h-5" /> },
    { path: '/wallet', label: 'Wallet', icon: <Wallet className="w-5 h-5" /> },
    { path: '/settings', label: 'Tetapan', icon: <Settings className="w-5 h-5" /> },
  ];

  return (
    <>
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-card transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col h-full">
          <div className="p-6 flex flex-col items-center text-center">
            <h1 className="text-3xl font-bold gradient-text">RAREBITS</h1>
            <p className="text-sm text-muted-foreground mt-1">Sistem Pengurusan Jualan</p>
          </div>
          <nav className="flex-1 px-4 py-2 space-y-2">
            {navItems.map(item => (
              <Button 
                asChild 
                key={item.path} 
                variant="ghost" 
                onClick={() => setSidebarOpen(false)} 
                className={cn(
                  "w-full justify-start gap-3 text-base h-12 rounded-lg",
                  isActive(item.path) 
                    ? "bg-primary/10 text-primary hover:bg-primary/10 font-semibold" 
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <Link to={item.path}>
                  {item.icon}
                  {item.label}
                </Link>
              </Button>
            ))}
          </nav>
          <div className="p-4 text-center text-xs text-muted-foreground">
            <p className="font-semibold text-sm text-foreground">RareBits Bisness</p>
            <p>© 2025 Genesix MY</p>
            <p>Direka dengan ❤️ oleh Khalid Zainal</p>
          </div>
        </div>
      </aside>
      {isSidebarOpen && <div className="fixed inset-0 bg-black/60 z-40 md:hidden" onClick={() => setSidebarOpen(false)}></div>}
    </>
  );
};

export default Sidebar;