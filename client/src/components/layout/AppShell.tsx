import { useState, useEffect, type ReactNode } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { CommandPalette } from '../ui/CommandPalette';

export function AppShell({ children }: { children: ReactNode }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-surface lg:flex">
      <Sidebar open={isMenuOpen} onClose={() => setIsMenuOpen(false)} />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Header
          onOpenMenu={() => setIsMenuOpen(true)}
          onOpenCommand={() => setIsCommandOpen(true)}
        />
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">{children}</main>
      </div>

      <CommandPalette open={isCommandOpen} onClose={() => setIsCommandOpen(false)} />
    </div>
  );
}
