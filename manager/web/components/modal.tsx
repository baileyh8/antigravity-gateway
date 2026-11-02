'use client';

import { useEffect } from 'react';

export function Modal({
  title,
  description,
  onClose,
  children,
  footer
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">×</button>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        {children}
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
