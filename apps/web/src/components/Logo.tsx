interface LogoProps {
  /** Rendered size in pixels; the image is 192 px, sharp up to 96 px on high-density screens. */
  readonly size: number;
  readonly className?: string;
}

/** The City College of Calapan seal. */
export function Logo({ size, className }: LogoProps) {
  return (
    <img
      src="/ccc-logo.png"
      alt="City College of Calapan seal"
      width={size}
      height={size}
      className={className}
      decoding="async"
    />
  );
}
