'use client';

import { useEffect, useId, useRef, useState } from 'react';

interface InfoPopoverProps {
  trigger: React.ReactNode;
  content: React.ReactNode;
  triggerClassName?: string;
  align?: 'left' | 'right';
  ariaLabel?: string;
}

/**
 * Accessible popover triggered by click/tap, hover, or keyboard focus without triggering row clicks.
 */
export function InfoPopover({
  trigger,
  content,
  triggerClassName = '',
  align = 'left',
  ariaLabel,
}: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  return (
    <span
      ref={containerRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        onFocus={() => setOpen(true)}
        className={triggerClassName}
      >
        {trigger}
      </button>

      {open ? (
        <span
          id={popoverId}
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-full z-50 mt-1.5 w-64 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-left text-xs text-zinc-200 shadow-2xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
