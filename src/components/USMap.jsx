import { useState, useRef, memo, useEffect } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
  Annotation,
} from "react-simple-maps";
import { stateData } from "../data/states";
import { colors, mapColors } from "../designTokens";

const geoUrl = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

// FIPS to state abbreviation mapping
const fipsToAbbr = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
  "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
  "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
  "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
  "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
  "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
  "56": "WY", "72": "PR",
};

// Month abbreviation to number mapping
const monthToNum = {
  "Jan": 0, "Feb": 1, "Mar": 2, "Apr": 3, "May": 4, "Jun": 5,
  "Jul": 6, "Aug": 7, "Sep": 8, "Oct": 9, "Nov": 10, "Dec": 11
};

// Parse session dates like "Jan 13 - Mar 27, 2026" or "Dec 1, 2025 - Feb 27, 2026"
const parseSessionDates = (dateStr) => {
  if (!dateStr || dateStr === "Odd years only") {
    return null;
  }

  // Match patterns like "Jan 13 - Mar 27, 2026" or "Jan 2, 2025 - Dec 31, 2026"
  const match = dateStr.match(/(\w+)\s+(\d+),?\s*(\d{4})?\s*-\s*(\w+)\s+(\d+),?\s*(\d{4})/);
  if (!match) return null;

  const [, startMonth, startDay, startYear, endMonth, endDay, endYear] = match;

  const start = new Date(
    parseInt(startYear || endYear),
    monthToNum[startMonth],
    parseInt(startDay)
  );

  const end = new Date(
    parseInt(endYear),
    monthToNum[endMonth],
    parseInt(endDay),
    23, 59, 59 // End of day
  );

  return { start, end };
};

// Get current date in EST
const getESTDate = () => {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
};

// Determine session status: "inSession", "upcoming", "ended", "noSession"
const getSessionStatus = (stateAbbr) => {
  const state = stateData[stateAbbr];
  if (!state) return "noSession";

  const dates = parseSessionDates(state.session.dates);
  if (!dates) return "noSession";

  const now = getESTDate();

  if (now < dates.start) return "upcoming";
  if (now > dates.end) return "ended";
  return "inSession";
};

// Get color based on session status
const getStateColor = (stateAbbr) => {
  const status = getSessionStatus(stateAbbr);
  return mapColors[status];
};

const USMap = memo(({ selectedState, onStateSelect }) => {
  const [position, setPosition] = useState({ coordinates: [-96, 38], zoom: 1 });
  const [, setRefresh] = useState(0); // Force re-render trigger
  const containerRef = useRef(null);

  // Auto-refresh at midnight EST to update session colors
  useEffect(() => {
    const scheduleNextMidnight = () => {
      const now = getESTDate();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const msUntilMidnight = tomorrow - now;

      return setTimeout(() => {
        setRefresh((r) => r + 1); // Trigger re-render
        scheduleNextMidnight(); // Schedule next midnight
      }, msUntilMidnight);
    };

    const timeoutId = scheduleNextMidnight();
    return () => clearTimeout(timeoutId);
  }, []);

  const handleMoveEnd = (position) => {
    setPosition(position);
  };

  const handleWheel = (evt) => {
    evt.preventDefault();
    const delta = evt.deltaY > 0 ? -0.2 : 0.2;
    const newZoom = Math.min(Math.max(position.zoom + delta, 1), 5);
    setPosition((pos) => ({ ...pos, zoom: newZoom }));
  };

  const handleClick = (geo) => {
    const fips = geo.id;
    const abbr = fipsToAbbr[fips];
    if (abbr && stateData[abbr]) {
      onStateSelect(abbr);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%" }}
      onWheel={handleWheel}
    >
      <ComposableMap
        projection="geoAlbersUsa"
        style={{ width: "100%", height: "auto", maxHeight: "500px" }}
      >
        <ZoomableGroup
          center={position.coordinates}
          zoom={position.zoom}
          onMoveEnd={handleMoveEnd}
          minZoom={1}
          maxZoom={5}
        >
          <Geographies geography={geoUrl}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const fips = geo.id;
                const abbr = fipsToAbbr[fips];
                const state = stateData[abbr];

                if (!state) return null;

                const isSelected = selectedState === abbr;

                // Get color based on session status
                const fillColor = getStateColor(abbr);

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    onClick={() => handleClick(geo)}
                    className="state-path"
                    style={{
                      default: {
                        fill: fillColor,
                        stroke: isSelected ? colors.primary[700] : colors.white,
                        strokeWidth: isSelected ? 2 : 0.5,
                        outline: "none",
                      },
                      hover: {
                        fill: fillColor,
                        stroke: colors.primary[600],
                        strokeWidth: 1.5,
                        outline: "none",
                        cursor: "pointer",
                      },
                      pressed: {
                        fill: fillColor,
                        stroke: colors.primary[700],
                        strokeWidth: 2,
                        outline: "none",
                      },
                    }}
                  />
                );
              })
            }
          </Geographies>

          {/* DC callout - too small to see/click on the map */}
          <Annotation
            subject={[-77.04, 38.9]}
            dx={50}
            dy={-30}
            connectorProps={{
              stroke: colors.gray[400],
              strokeWidth: 1,
            }}
          >
            <rect
              x={-2}
              y={-12}
              width={28}
              height={16}
              rx={3}
              fill={getStateColor("DC")}
              stroke={selectedState === "DC" ? colors.primary[700] : colors.white}
              strokeWidth={selectedState === "DC" ? 2 : 0.5}
              onClick={() => onStateSelect("DC")}
              style={{ cursor: "pointer" }}
              className="state-path"
            />
            <text
              x={12}
              y={0}
              textAnchor="middle"
              fontSize={8}
              fontWeight={600}
              fill={colors.white}
              style={{ pointerEvents: "none" }}
            >
              DC
            </text>
          </Annotation>
        </ZoomableGroup>
      </ComposableMap>
    </div>
  );
});

USMap.displayName = "USMap";

export default USMap;
