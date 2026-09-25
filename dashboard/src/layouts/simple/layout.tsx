import { cn } from '@/lib/utils';

export type SimpleLayoutProps = {
  children: React.ReactNode;
  className?: string;
  hideHeader?: boolean;
  content?: {
    compact?: boolean;
  };
};

/**
 * Simple layout component for pages without sidebar navigation.
 * Used for login page, error pages, and other standalone views.
 * Provides a centered content area with optional compact mode.
 */
export function SimpleLayout({ children, className, hideHeader, content }: SimpleLayoutProps) {
  return (
    <div className={cn('flex min-h-screen flex-col bg-background', className)}>
      {!hideHeader && (
        <header className="sticky top-0 z-50 flex h-14 items-center border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:h-16 md:px-6">
          <div className="container mx-auto flex max-w-7xl items-center justify-between">
            <a href="/" className="flex items-center" aria-label="Go to home">
              <img src="/logo/vector/default.svg" alt="Pioneer HQ Logo" className="h-8 w-auto" />
            </a>
          </div>
        </header>
      )}

      <main className="flex flex-1 flex-col">
        {content?.compact ? (
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-6 text-center md:px-0 md:py-10">
            {children}
          </div>
        ) : (
          <div className="flex-1 p-4 md:p-6">{children}</div>
        )}
      </main>
    </div>
  );
}
