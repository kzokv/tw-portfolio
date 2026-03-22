/** Stub for next/link — renders a plain <a> tag. */
export default function Link({ children, href, ...props }: { children: React.ReactNode; href: string; [k: string]: unknown }) {
  return <a href={href} {...props}>{children}</a>;
}
