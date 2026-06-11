// The Traceback mark: a branching conversation inside a round chat bubble.
//
// A filled root node forking into two open child nodes -- the same shape the
// conversation tree draws -- wrapped in a circular speech bubble with a small
// tail. Color comes from the surrounding text color (currentColor), so the
// same component works as the reply avatar, the sidebar mark, or anywhere
// else. The browser favicon is a standalone copy of this drawing
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
      <circle cx="12" cy="11" r="8.3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.9 17.6 L4.1 21.4 L8.7 19.6 Z" fill="currentColor" />
      <circle cx="12" cy="7.4" r="1.7" fill="currentColor" />
      <path
        d="M12 9.4v1.8 M12 11.2 L8.6 14 M12 11.2 L15.4 14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8.1" cy="14.8" r="1.7" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15.9" cy="14.8" r="1.7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
