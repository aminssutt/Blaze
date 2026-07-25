// Ticket #38 — panel placement contract. Owner: @six-16.

/**
 * The props every control-room panel component accepts.
 *
 * LAYOUT SEAM (tickets #40–#51): `app/page.tsx` owns WHERE a panel sits and
 * how much vertical space it gets; the panel owns WHAT is inside it. A panel
 * must therefore forward `className` straight to its `<Panel>` and must never
 * hardcode its own placement, width, height or flex share — otherwise the
 * layout can no longer be tuned without editing eleven files.
 */
export interface PanelComponentProps {
  /** Placement / sizing classes supplied by the layout. Forward as-is. */
  className?: string;
}
