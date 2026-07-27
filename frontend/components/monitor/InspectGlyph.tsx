// Page /workflow — the "inspect" affordance glyph.
//
// Four corner brackets (the universal "open / enlarge" mark), drawn as SVG on
// purpose: a font glyph like ⤢ or ⌕ is not reliably available on every OS and
// a missing-glyph box would break the ONE thing this mark has to do — say
// "this card opens". Inherits currentColor so callers own the state colours.

export default function InspectGlyph({
  size = 10,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M1 4.2V1h3.2" />
      <path d="M7.8 1H11v3.2" />
      <path d="M11 7.8V11H7.8" />
      <path d="M4.2 11H1V7.8" />
    </svg>
  );
}
