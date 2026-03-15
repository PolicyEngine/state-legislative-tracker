import { useState, useEffect } from "react";
import { colors, typography, spacing } from "../designTokens";

/**
 * Displays a live prediction market probability badge from Manifold Markets.
 * Fetches the current probability on mount and links to the market.
 */
export default function ManifoldBadge({ marketUrl }) {
  const [prob, setProb] = useState(null);

  useEffect(() => {
    if (!marketUrl) return;

    // Extract slug from URL: https://manifold.markets/User/slug -> slug
    const slug = marketUrl.split("/").pop();
    if (!slug) return;

    fetch(`https://api.manifold.markets/v0/slug/${slug}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.probability != null) {
          setProb(data.probability);
        }
      })
      .catch(() => {});
  }, [marketUrl]);

  if (prob == null) return null;

  const pct = Math.round(prob * 100);

  return (
    <a
      href={marketUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Prediction market probability (Manifold Markets)"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing.xs,
        padding: `2px ${spacing.sm}`,
        borderRadius: spacing.radius.md,
        backgroundColor: `${colors.primary[600]}12`,
        border: `1px solid ${colors.primary[600]}30`,
        color: colors.primary[700],
        fontSize: typography.fontSize.xs,
        fontWeight: typography.fontWeight.semibold,
        fontFamily: typography.fontFamily.body,
        textDecoration: "none",
        flexShrink: 0,
        transition: "background-color 0.15s ease",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.backgroundColor = `${colors.primary[600]}25`)
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.backgroundColor = `${colors.primary[600]}12`)
      }
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
        />
      </svg>
      {pct}%
    </a>
  );
}
