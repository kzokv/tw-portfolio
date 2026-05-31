import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * Vakwen placeholder favicon. Monochrome "V" on solid slate background.
 * Final brand identity (logo, color tokens, full favicon set) is a separate
 * design ticket per the KZO-92 scope lock.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          background: "#0f172a",
          color: "#f8fafc",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          letterSpacing: "-0.05em",
        }}
      >
        V
      </div>
    ),
    size,
  );
}
