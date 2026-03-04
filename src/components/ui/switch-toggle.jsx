import React from 'react';
import { cn } from '@/lib/utils';

const SwitchToggle = React.forwardRef(
  ({ className, checked = false, disabled = false, onCheckedChange, ...props }, ref) => {
    const handleToggle = () => {
      if (disabled) return;
      onCheckedChange?.(!checked);
    };

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={handleToggle}
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          checked
            ? 'border-primary bg-primary'
            : 'border-slate-300 bg-slate-200',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          className
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-6' : 'translate-x-1'
          )}
        />
      </button>
    );
  }
);

SwitchToggle.displayName = 'SwitchToggle';

export { SwitchToggle };
