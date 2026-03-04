import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Home, Package, Receipt, Settings, Users, Wallet, FileText, Link2, Bell, Paperclip, BookOpen } from 'lucide-react';

const Sidebar = ({ isSidebarOpen, setSidebarOpen }) => {
  const location = useLocation();
  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const navItems = [
    { path: '/', label: 'Papan Pemuka', icon: <Home className="w-5 h-5" /> },
    {
      path: '/inventory',
      label: 'Inventori',
      icon: <Package className="w-5 h-5" />,
      children: [
        { path: '/inventory/catalogs', label: 'Katalog', icon: <Link2 className="w-4 h-4" /> },
      ],
    },
    { path: '/sales', label: 'Jualan', icon: <Receipt className="w-5 h-5" /> },
    { path: '/reminders', label: 'Reminder', icon: <Bell className="w-5 h-5" /> },
    { path: '/invoices', label: 'Invois', icon: <FileText className="w-5 h-5" /> },
    { path: '/clients', label: 'Pelanggan', icon: <Users className="w-5 h-5" /> },
    {
      path: '/wallet',
      label: 'Wallet',
      icon: <Wallet className="w-5 h-5" />,
      children: [
        { path: '/wallet/receipts', label: 'Resit', icon: <Paperclip className="w-4 h-4" /> },
      ],
    },
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
              <div key={item.path} className="space-y-1">
                <Button
                  asChild
                  variant="ghost"
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "h-12 w-full justify-start gap-3 rounded-lg border border-transparent text-base transition-colors",
                    isActive(item.path)
                      ? "border-primary/20 bg-primary/10 font-semibold text-primary hover:bg-primary/15 hover:text-cyan-700"
                      : "text-muted-foreground hover:border-primary/40 hover:bg-white hover:text-primary"
                  )}
                >
                  <Link to={item.path}>
                    {item.icon}
                    {item.label}
                  </Link>
                </Button>

                {Array.isArray(item.children) && item.children.length > 0 && (
                  <div className="space-y-1 pl-7">
                    {item.children.map((child) => (
                      <Button
                        asChild
                        key={child.path}
                        variant="ghost"
                        onClick={() => setSidebarOpen(false)}
                        className={cn(
                          "h-10 w-full justify-start gap-2 rounded-lg border border-transparent text-sm transition-colors",
                          isActive(child.path)
                            ? "border-primary/20 bg-primary/10 font-semibold text-primary hover:bg-primary/15 hover:text-cyan-700"
                            : "text-muted-foreground hover:border-primary/40 hover:bg-white hover:text-primary"
                        )}
                      >
                        <Link to={child.path}>
                          {child.icon}
                          {child.label}
                        </Link>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div className="mt-8 border-t border-border/70 pt-5">
              <Button
                asChild
                variant="ghost"
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "h-12 w-full justify-start gap-3 rounded-lg border border-dashed text-base transition-colors",
                  isActive('/knowledge-base')
                    ? "border-primary/30 bg-primary/10 font-semibold text-primary hover:bg-primary/15 hover:text-cyan-700"
                    : "border-border/80 text-muted-foreground hover:border-primary/40 hover:bg-white hover:text-primary"
                )}
              >
                <Link to="/knowledge-base">
                  <BookOpen className="w-5 h-5" />
                  Knowledge Base
                </Link>
              </Button>
            </div>
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
