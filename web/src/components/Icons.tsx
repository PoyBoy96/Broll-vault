import type { SVGProps } from 'react'

/* Stroke icons on a 16px grid. One weight, one style, recolor via currentColor. */

type P = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Svg>
)
export const IconBell = (p: P) => (
  <Svg {...p}><path d="M3 11h10l-1.4-2V6a3.6 3.6 0 0 0-7.2 0v3L3 11Z" /><path d="M6.5 13a1.6 1.6 0 0 0 3 0M8 1v1" /></Svg>
)
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="m4 6 4 4 4-4" />
  </Svg>
)
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Svg>
)
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 8h9" />
  </Svg>
)
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
)
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Svg>
)
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />
  </Svg>
)
export const IconNoFrame = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="3.5" width="12" height="9" rx="2" />
    <path d="m3 13 10-10" />
  </Svg>
)
export const IconBin = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 5.5h11l-1 8h-9z" />
    <path d="M2 3.5h12M6 3.5V2h4v1.5" />
  </Svg>
)
export const IconPremiere = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="2" width="12" height="12" rx="3" />
    <path d="M6 11V5h2.2a1.8 1.8 0 0 1 0 3.6H6" />
  </Svg>
)
export const IconStar = (p: P & { filled?: boolean }) => {
  const { filled, ...rest } = p
  return (
    <Svg {...rest}>
      <path
        d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
        fill={filled ? 'currentColor' : 'none'}
      />
    </Svg>
  )
}
export const IconUndo = (p: P) => (
  <Svg {...p}>
    <path d="M6 4 3 7l3 3" />
    <path d="M3 7h6a3.5 3.5 0 0 1 0 7H7" />
  </Svg>
)
export const IconRows = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </Svg>
)
export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
  </Svg>
)
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
  </Svg>
)
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />
  </Svg>
)
export const IconWarn = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.5 14 13H2z" />
    <path d="M8 6.5v3M8 11.2v.3" />
  </Svg>
)
export const IconGrid = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="2" width="5" height="5" rx="1.2" />
    <rect x="9" y="2" width="5" height="5" rx="1.2" />
    <rect x="2" y="9" width="5" height="5" rx="1.2" />
    <rect x="9" y="9" width="5" height="5" rx="1.2" />
  </Svg>
)
export const IconFilmstrip = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="4" rx="1" />
    <rect x="2" y="9" width="12" height="4" rx="1" />
    <path d="M5 3v4M11 3v4M5 9v4M11 9v4" />
  </Svg>
)
export const IconExpand = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
  </Svg>
)
