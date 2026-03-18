import { useRef, useCallback } from "react";
import { toPng } from "html-to-image";
import { colors, typography, spacing } from "../../designTokens";

const PE_LOGO_URL = "/policyengine-logo.svg";

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

export default function ChartExportWrapper({ title, fileName, header, children }) {
  const chartRef = useRef(null);

  const handleDownload = useCallback(async () => {
    if (!chartRef.current) return;
    try {
      const dataUrl = await toPng(chartRef.current, {
        backgroundColor: colors.white,
        pixelRatio: 2,
      });
      const link = document.createElement("a");
      link.download = `${fileName || title || "chart"}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Failed to export chart:", err);
    }
  }, [fileName, title]);

  return (
    <div style={{ position: "relative" }}>
      {/* Download button */}
      <button
        onClick={handleDownload}
        title="Download as image"
        style={{
          position: "absolute",
          top: spacing.sm,
          right: spacing.sm,
          display: "flex",
          alignItems: "center",
          gap: spacing.xs,
          padding: `${spacing.xs} ${spacing.sm}`,
          backgroundColor: colors.white,
          border: `1px solid ${colors.border.light}`,
          borderRadius: spacing.radius.md,
          color: colors.text.tertiary,
          fontSize: typography.fontSize.xs,
          fontFamily: typography.fontFamily.body,
          cursor: "pointer",
          zIndex: 5,
          transition: "all 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = colors.primary[600];
          e.currentTarget.style.borderColor = colors.primary[300];
          e.currentTarget.style.backgroundColor = colors.primary[50];
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = colors.text.tertiary;
          e.currentTarget.style.borderColor = colors.border.light;
          e.currentTarget.style.backgroundColor = colors.white;
        }}
      >
        <DownloadIcon />
        Save
      </button>

      {/* Optional header content (outside export region) */}
      {header}

      {/* Exportable region */}
      <div ref={chartRef} style={{ padding: spacing.lg }}>
        {children}

        {/* Logo watermark */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          marginTop: spacing.md,
          opacity: 0.4,
        }}>
          <img
            src={PE_LOGO_URL}
            alt="PolicyEngine"
            style={{ display: "block", width: "80px", height: "auto" }}
          />
        </div>
      </div>
    </div>
  );
}
