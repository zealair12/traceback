// The Traceback mark: a conversation that forks.
//
// One filled root node branching into two open child nodes -- the same shape
// the conversation tree draws. Color comes from the surrounding text color
// (currentColor), so the same component works as the reply avatar, the sidebar
// mark, or anywhere else. The browser favicon is a standalone copy of this
// drawing (client/public/favicon.svg); keep the two in sync if it changes.

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
      <circle cx="12" cy="5.8" r="2.1" fill="currentColor" />
      <path
        d="M12 8.5v2 M12 10.5 L7.4 14.6 M12 10.5 L16.6 14.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="6.8" cy="16" r="2.1" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17.2" cy="16" r="2.1" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
