import type { Diagnostic } from '../types';
import { useText } from '../preferences';

function shortName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export default function ProblemsPanel({
  diagnostics,
  onJump,
}: {
  diagnostics: Diagnostic[];
  onJump: (d: Diagnostic) => void;
}) {
  const t = useText();
  if (!diagnostics.length) {
    return <div className="problems problems-empty">{t('没有错误或警告 ✓', 'No errors or warnings ✓')}</div>;
  }
  return (
    <div className="problems">
      {diagnostics.map((d, i) => (
        <div
          key={i}
          className={'problem-row ' + d.severity}
          onClick={() => onJump(d)}
          title={d.raw || d.message}
        >
          <span className={'problem-sev ' + d.severity}>{d.severity === 'error' ? '✖' : '⚠'}</span>
          <span className="problem-msg">{d.message}</span>
          <span className="problem-loc">
            {shortName(d.file)}
            {d.line ? `:${d.line}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
