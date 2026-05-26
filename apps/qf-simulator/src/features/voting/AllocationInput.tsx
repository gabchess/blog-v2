import type { Project } from '../../api/client';

interface Props {
  project: Project;
  value: number;
  onChange: (amount: number) => void;
  maxBudget: number;
  totalAllocated: number;
}

export function AllocationInput({ project, value, onChange, maxBudget, totalAllocated }: Props) {
  const remaining = maxBudget - totalAllocated + value;

  return (
    <div className="allocation-input">
      <label>
        <span className="project-name">{project.name}</span>
        {project.description && <span className="project-desc">{project.description}</span>}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Math.min(Number(e.target.value), remaining))}
        min={0}
        max={remaining}
      />
    </div>
  );
}
