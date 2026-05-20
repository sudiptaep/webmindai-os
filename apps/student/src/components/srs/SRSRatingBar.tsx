'use client';

const RATINGS = [
  { quality: 0, label: 'Again', desc: 'Forgot completely', className: 'border-red-700/60 text-red-400 hover:bg-red-700/20 hover:border-red-600' },
  { quality: 3, label: 'Hard',  desc: 'Struggled',        className: 'border-orange-700/60 text-orange-400 hover:bg-orange-700/20 hover:border-orange-600' },
  { quality: 4, label: 'Good',  desc: 'Recalled well',    className: 'border-teal-700/60 text-teal-400 hover:bg-teal-700/20 hover:border-teal-600' },
  { quality: 5, label: 'Easy',  desc: 'Perfect recall',   className: 'border-green-700/60 text-green-400 hover:bg-green-700/20 hover:border-green-600' },
];

interface SRSRatingBarProps {
  onRate: (quality: number) => void;
  disabled?: boolean;
}

export function SRSRatingBar({ onRate, disabled }: SRSRatingBarProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 text-center">How well did you recall this?</p>
      <div className="grid grid-cols-4 gap-2">
        {RATINGS.map(r => (
          <button
            key={r.quality}
            onClick={() => onRate(r.quality)}
            disabled={disabled}
            className={`flex flex-col items-center gap-0.5 py-2.5 px-2 rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${r.className}`}
          >
            <span className="text-sm font-semibold">{r.label}</span>
            <span className="text-[10px] opacity-70 hidden sm:block">{r.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
