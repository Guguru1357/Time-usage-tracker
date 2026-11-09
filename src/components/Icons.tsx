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

export const IconHome = () => (
  <Svg>
    <path d="M4.5 10.5 12 4.5l7.5 6V19a.5.5 0 0 1-.5.5h-4.5v-5h-5v5H5a.5.5 0 0 1-.5-.5z" />
  </Svg>
);

export const IconWallet = () => (
  <Svg>
    <rect x="3.5" y="6.5" width="17" height="12" rx="2.5" />
    <path d="M3.5 10h17M15.5 14.5h2" />
  </Svg>
);

export const IconAsset = () => (
  <Svg>
    <path d="M4 19.5h16M6 16.5v-5M10 16.5v-8M14 16.5v-6M18 16.5v-10" />
  </Svg>
);

export const IconStock = () => (
  <Svg>
    <path d="M4 17l5-5 3.5 3.5L20 8" />
    <path d="M15 8h5v5" />
  </Svg>
);

export const IconToday = () => (
  <Svg>
    <rect x="4.5" y="4.5" width="15" height="15" rx="3" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Svg>
);

export const IconChart = () => (
  <Svg>
    <path d="M5 19V11M12 19V5M19 19v-6" />
  </Svg>
);
