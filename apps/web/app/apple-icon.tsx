import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Vakwen placeholder Apple touch icon. Same design as the favicon, scaled
 * to Apple's required 180x180. Replace with a designed asset once the
 * brand identity ticket lands.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 120,
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
