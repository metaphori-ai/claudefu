import React, { useState, useRef } from 'react';
import {
  useFloating,
  offset,
  flip,
  shift,
  size,
  autoUpdate,
  FloatingPortal,
  useHover,
  useFocus,
  useInteractions,
  useDismiss,
  useRole,
  FloatingArrow,
  arrow
} from '@floating-ui/react';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 100
}: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const arrowRef = useRef(null);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    middleware: [
      offset(8),
      flip({ fallbackPlacements: ['bottom', 'left', 'right'] }),
      shift({ padding: 8 }),
      size({
        apply({ availableHeight, elements }) {
          // Constrain tooltip height to available viewport space
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(100, availableHeight - 16)}px`,
            overflowY: 'auto'
          });
        },
        padding: 8
      }),
      arrow({ element: arrowRef })
    ],
    whileElementsMounted: autoUpdate
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: delay, close: 0 } }),
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: 'tooltip' })
  ]);

  return (
    <>
      {React.cloneElement(children, {
        ref: refs.setReference,
        ...getReferenceProps()
      })}
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              zIndex: 10000,
              padding: '6px 10px',
              background: '#1a1a1a',
              color: '#ccc',
              fontSize: '0.8rem',
              borderRadius: '4px',
              border: '1px solid #333',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}
            {...getFloatingProps()}
          >
            {content}
            <FloatingArrow
              ref={arrowRef}
              context={context}
              fill="#1a1a1a"
              stroke="#333"
              strokeWidth={1}
            />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
