import type { CLRResults } from '../../api/client';
import { ParticleStream } from '../visualization';
import { useAnimatedValue } from '../../hooks';

interface Props {
  preview: CLRResults | null;
  loading: boolean;
}

function AnimatedTotal({ value, label }: { value: number; label: string }) {
  const animated = useAnimatedValue(value, { duration: 600, decimals: 2 });
  return (
    <div className="preview-total">
      <span className="total-label">{label}</span>
      <span className="total-value">${animated.toFixed(2)}</span>
    </div>
  );
}

export function MatchingPreview({ preview, loading }: Props) {
  if (loading) {
    return (
      <div className="matching-preview matching-preview--loading">
        <div className="preview-pulse">Calculating...</div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="matching-preview matching-preview--empty">
        <p>Enter allocations to see matching preview</p>
      </div>
    );
  }

  const totalDirect = preview.projects.reduce((sum, p) => sum + p.directContributions, 0);
  const totalMatched = preview.projects.reduce((sum, p) => sum + p.scaledMatch, 0);

  return (
    <div className="matching-preview matching-preview--active">
      <h4>Live Matching Preview</h4>

      {preview.scalingFactor < 1 && (
        <p className="scaling-warning">
          Pool demand: {(preview.scalingFactor * 100).toFixed(0)}% scaling applied
        </p>
      )}

      <div className="preview-projects">
        {preview.projects.map((p) => (
          <div key={p.projectId} className="preview-project">
            <span className="project-label">{p.projectName}</span>
            <div className="project-streams">
              <ParticleStream
                amount={p.directContributions}
                type="direct"
                height={150}
              />
              <ParticleStream
                amount={p.scaledMatch}
                type="matched"
                height={150}
              />
            </div>
            <div className="project-total">
              Total: ${p.total.toFixed(2)}
            </div>
          </div>
        ))}
      </div>

      <div className="preview-summary">
        <AnimatedTotal value={totalDirect} label="Your Contribution" />
        <div className="summary-plus">+</div>
        <AnimatedTotal value={totalMatched} label="Matching Pool" />
        <div className="summary-equals">=</div>
        <AnimatedTotal value={totalDirect + totalMatched} label="Total Impact" />
      </div>
    </div>
  );
}
