import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const ChartIcon = (props: IconProps) => (
  <Icon {...props}><path d="M3 3v18h18" /><path d="M7 15v3M12 10v8M17 6v12" /></Icon>
);

export const UsersIcon = (props: IconProps) => (
  <Icon {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></Icon>
);

export const KeyIcon = (props: IconProps) => (
  <Icon {...props}><circle cx="7.5" cy="15.5" r="5.5" /><path d="M21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" /></Icon>
);

export const BoxesIcon = (props: IconProps) => (
  <Icon {...props}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></Icon>
);

export const TrendIcon = (props: IconProps) => (
  <Icon {...props}><path d="M3 17l6-6 4 4 7-7" /><path d="M14 8h6v6" /></Icon>
);

export const ScrollIcon = (props: IconProps) => (
  <Icon {...props}><path d="M8 3h9a2 2 0 0 1 2 2v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2V7" /><path d="M8 3v4H4M10 11h6M10 15h6" /></Icon>
);

export const GearIcon = (props: IconProps) => (
  <Icon {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Icon>
);

export const UserIcon = (props: IconProps) => (
  <Icon {...props}><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></Icon>
);

export const RefreshIcon = (props: IconProps) => (
  <Icon {...props}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Icon>
);

export const LogOutIcon = (props: IconProps) => (
  <Icon {...props}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>
);

export const AlertIcon = (props: IconProps) => (
  <Icon {...props}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></Icon>
);

export const TokenIcon = (props: IconProps) => (
  <Icon {...props}><path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" /><path d="M8 8h8M12 8v8" /></Icon>
);

export const RequestIcon = (props: IconProps) => (
  <Icon {...props}><path d="M4 7h15l-4-4M20 17H5l4 4" /></Icon>
);

export const GaugeIcon = (props: IconProps) => (
  <Icon {...props}><path d="M4.9 19a9 9 0 1 1 14.2 0" /><path d="M12 5v2M5 12h2M17 12h2M12 13l4-4" /><circle cx="12" cy="13" r="1" /><path d="M8 19h8" /></Icon>
);

export const ServerIcon = (props: IconProps) => (
  <Icon {...props}><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" /></Icon>
);
