import { useState, type ReactNode } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

export function AppShell({ children }: { children: ReactNode }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface lg:flex">
      <Sidebar open={isMenuOpen} onClose={() => setIsMenuOpen(false)} />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Header onOpenMenu={() => setIsMenuOpen(true)} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
