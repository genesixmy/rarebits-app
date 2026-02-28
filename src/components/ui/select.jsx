import React from 'react';
import { cn } from '@/lib/utils';

const Select = React.forwardRef(({ className, children, ...props }, ref) => {
  return (
    <select
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-full border border-cyan-300 bg-white px-4 py-2 pr-9 text-sm font-medium text-cyan-700 ring-offset-background placeholder:text-slate-400 transition-colors hover:border-primary/40 hover:bg-white hover:text-primary focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    >
      {children}
    </select>
  );
});
Select.displayName = "Select";

export { Select };
