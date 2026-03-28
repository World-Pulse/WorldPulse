'use client'

import type React from 'react'

interface CIBStatus {
  detected: boolean;
  confidence: number;
  label: string;
}

interface Props {
  cibStatus?: CIBStatus;
}

export function CIBWarningBadge({ cibStatus }: Props): React.ReactElement | null {
  if (!cibStatus || cibStatus.label === 'CLEAN') return null;

  const pct = Math.round(cibStatus.confidence * 100);

  if (cibStatus.label === 'COORDINATED NARRATIVE DETECTED') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-300">
        <span aria-hidden="true">⚠</span>
        Coordinated Narrative Detected
        <span className="ml-1 text-red-600 dark:text-red-400">{pct}% confidence</span>
      </span>
    );
  }

  // SUSPICIOUS
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
      <span aria-hidden="true">?</span>
      Suspicious Coordination
      <span className="ml-1 text-amber-600 dark:text-amber-400">{pct}% confidence</span>
    </span>
  );
}

export default CIBWarningBadge;
