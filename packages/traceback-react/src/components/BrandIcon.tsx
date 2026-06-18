// The Traceback mark: a git-style branch inside a round chat bubble.
//
// Three open nodes -- a line connecting the left pair, and a curve from the
// right node merging into that line -- the universal "branch" glyph, sitting
// centered inside a circular speech bubble with a small tail. Lines stop at
// the circle edges rather than entering them. The glyph is OPTICALLY
// centered: its mass balance point (not its bounding box) sits at the
// bubble's center, because the branch shape is heavier on its left side. Color comes from the
// surrounding text color (currentColor); the app uses Traceback blue. The
// browser favicon is a standalone copy of this drawing
// (client/public/favicon.svg); keep the two in sync if it changes.

interface BrandIconProps {
  size?: number;
  className?: string;
}

export function BrandIcon({ size = 20, className }: BrandIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="11.2" r="9.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.4 18.9 L4.8 22.5 L9.4 20.7 Z" fill="currentColor" />
      <circle cx="10" cy="8.6" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10" cy="15.4" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="15.2" cy="8.6" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 10.4 v3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M15.2 10.4 v0.2 a2.6 2.6 0 0 1 -2.6 2.6 h-2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
