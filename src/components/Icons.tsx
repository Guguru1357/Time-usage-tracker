import type { SVGProps } from 'react';

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export const IconClock = () => (
  <Svg>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const IconList = () => (
  <Svg>
    <path d="M9 7h10M9 12h10M9 17h10" />
    <circle cx="5" cy="7" r="0.6" fill="currentColor" />
    <circle cx="5" cy="12" r="0.6" fill="currentColor" />
    <circle cx="5" cy="17" r="0.6" fill="currentColor" />
  </Svg>
);

export const IconSettings = () => (
  <Svg>
    <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
    <circle cx="15" cy="8" r="2" />
    <circle cx="9" cy="16" r="2" />
  </Svg>
);

export const IconChevronLeft = () => (
  <Svg width="20" height="20">
    <path d="M14.5 6 8.5 12l6 6" />
  </Svg>
);

export const IconChevronRight = () => (
  <Svg width="20" height="20">
    <path d="m9.5 6 6 6-6 6" />
  </Svg>
);

export const IconPlus = ({ size = 22 }: { size?: number }) => (
  <Svg width={size} height={size} strokeWidth="2">
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
