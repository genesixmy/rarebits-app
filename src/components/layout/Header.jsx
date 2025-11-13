import React from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Menu, Plus, LogOut } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

const Header = ({ user, profile, onToggleSidebar, onAddItem, onSignOut }) => {
  return (
    <header className="flex items-center p-4 sticky top-0 bg-background/80 backdrop-blur-sm z-30">
      <Button variant="ghost" size="icon" className="md:hidden mr-2" onClick={onToggleSidebar}>
        <Menu />
      </Button>
      <div className="flex-grow" />
      <div className="flex items-center gap-4">
        <ThemeToggle />
        <Button onClick={onAddItem} className="flex items-center gap-2 text-white brand-gradient brand-gradient-hover px-4 py-2 h-10">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline font-semibold">Tambah Item</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-10 w-10 p-0 rounded-2xl">
              <Avatar className="h-10 w-10">
                <AvatarImage src={profile?.avatar_url} alt={profile?.username || 'Avatar'} />
                <AvatarFallback>{profile?.username ? profile.username.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{profile?.username || 'Pengguna'}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut} className="text-red-500 focus:text-red-500 focus:bg-red-500/10 cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log Keluar</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

export default Header;