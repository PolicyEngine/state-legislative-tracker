import { useState, useEffect, useMemo } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
  Annotation,
  Marker,
} from "react-simple-maps";
import { geoCentroid } from "d3-geo";
import { colors, typography, spacing } from "../../designTokens";
import { useData } from "../../context/DataContext";

// ArcGIS REST API for 118th Congressional Districts
const getCongressionalDistrictsUrl = (stateAbbr) =>
  `https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_118th_Congressional_Districts/FeatureServer/0/query?where=${encodeURIComponent(`STATE_ABBR='${stateAbbr}'`)}&outFields=*&f=geojson`;

// State FIPS codes for filtering
const STATE_FIPS = {
  "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06",
  "CO": "08", "CT": "09", "DE": "10", "FL": "12", "GA": "13",
  "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19",
  "KS": "20", "KY": "21", "LA": "22", "ME": "23", "MD": "24",
  "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29",
  "MT": "30", "NE": "31", "NV": "32", "NH": "33", "NJ": "34",
  "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
  "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45",
  "SD": "46", "TN": "47", "TX": "48", "UT": "49", "VT": "50",
  "VA": "51", "WA": "53", "WV": "54", "WI": "55", "WY": "56",
};

// Real geographic SVG paths for Utah congressional districts (118th Congress)
// Generated from Census Bureau TIGER/Line shapefiles
const UTAH_DISTRICT_PATHS = {
  "1": {
    path: "M20.7,102.1 L20.9,81.9 L20.9,73.1 L20.9,72.4 L20.8,56.1 L21.0,53.7 L24.2,45.9 L36.6,46.2 L40.7,46.2 L59.7,45.9 L64.6,45.9 L67.2,45.8 L71.2,45.8 L77.7,45.7 L95.6,45.5 L102.1,45.5 L104.2,45.5 L107.6,45.5 L116.5,45.4 L135.1,45.3 L139.7,45.3 L150.3,45.3 L155.0,45.7 L155.7,45.6 L159.6,45.6 L172.2,45.5 L173.5,45.5 L176.3,45.5 L186.2,45.5 L202.8,45.4 L205.4,45.4 L209.1,45.4 L217.7,45.3 L236.0,75.6 L236.0,79.8 L235.9,91.3 L235.9,99.2 L235.9,117.4 L248.5,117.4 L248.4,123.2 L244.9,127.2 L241.3,129.0 L238.9,128.4 L234.7,128.4 L227.7,129.9 L225.1,130.7 L219.4,131.0 L217.7,131.6 L210.5,130.7 L212.3,135.0 L208.1,136.0 L207.9,140.2 L206.1,140.0 L205.3,140.0 L202.6,140.0 L201.2,140.3 L200.7,140.0 L199.2,140.4 L197.1,139.5 L196.7,138.9 L184.8,138.0 L183.5,139.5 L182.0,139.7 L179.6,139.7 L179.4,138.3 L179.4,137.6 L179.4,137.0 L179.6,136.4 L179.7,135.5 L178.8,135.2 L177.4,135.2 L176.7,135.2 L176.1,135.2 L175.3,135.2 L175.2,133.3 L174.4,132.0 L173.3,130.8 L174.6,130.2 L176.6,129.6 L178.2,128.6 L179.4,127.6 L180.7,125.5 L178.7,124.8 L177.6,124.2 L177.3,123.4 L176.9,122.1 L176.1,120.7 L176.6,119.7 L176.0,117.4 L174.9,116.1 L174.2,116.1 L174.1,116.2 L173.8,116.3 L173.3,116.3 L172.4,116.8 L172.8,117.1 L172.7,117.3 L172.0,117.5 L167.6,117.9 L164.1,117.9 L160.5,114.7 L158.4,110.8 L132.0,111.7 L110.0,117.2 L20.8,117.2 L20.8,102.3 Z",
    center: { x: 162, y: 82 },
    name: "District 1",
    region: "Northern Utah",
  },
  "2": {
    path: "M20.0,362.0 L20.1,351.0 L20.1,350.9 L20.2,349.6 L20.2,345.4 L20.2,341.2 L20.2,322.1 L20.2,314.8 L20.2,303.7 L20.2,296.8 L20.2,293.4 L20.2,291.6 L20.2,280.3 L20.3,269.9 L20.4,269.6 L20.4,225.0 L20.4,206.3 L20.4,201.9 L20.4,195.8 L20.4,186.9 L20.4,181.6 L20.5,172.4 L20.5,158.6 L20.5,153.6 L20.6,152.7 L20.7,134.6 L20.7,133.6 L81.1,117.2 L119.8,114.8 L135.0,111.0 L158.9,112.6 L162.7,115.7 L166.9,118.3 L169.6,118.2 L172.4,117.5 L172.8,117.3 L172.8,117.1 L173.3,116.3 L173.7,116.4 L173.9,116.3 L174.2,116.1 L174.4,116.1 L175.6,117.3 L176.6,119.1 L176.1,119.8 L176.8,122.2 L177.0,122.8 L177.3,124.0 L178.1,124.2 L178.7,125.7 L179.3,126.5 L178.0,127.6 L176.6,129.1 L175.3,130.0 L173.5,130.0 L173.4,131.2 L174.7,132.6 L175.3,133.8 L175.5,135.2 L176.6,135.2 L176.7,135.2 L178.0,135.2 L178.9,135.2 L179.6,135.8 L179.4,137.0 L179.4,137.4 L179.4,137.9 L179.4,138.8 L179.0,139.7 L177.9,139.7 L176.7,139.7 L175.5,139.7 L173.1,139.8 L171.9,140.1 L170.5,140.1 L169.1,140.1 L167.1,140.1 L165.7,140.1 L165.7,141.1 L165.6,141.6 L165.5,141.9 L165.5,142.0 L165.7,142.1 L165.7,143.2 L164.9,143.7 L163.6,143.7 L153.8,144.0 L154.9,145.7 L154.3,148.7 L154.0,152.1 L155.1,155.2 L153.8,155.4 L152.4,158.0 L153.2,161.6 L153.5,163.2 L153.4,165.7 L154.0,168.1 L154.6,171.2 L155.3,173.3 L156.0,174.9 L156.4,176.0 L155.0,177.9 L154.8,179.6 L156.2,182.0 L155.1,186.2 L156.0,188.6 L159.6,191.0 L160.0,194.2 L161.6,195.3 L163.2,197.7 L162.1,200.6 L162.0,203.4 L159.2,206.5 L153.1,209.3 L149.1,212.2 L143.8,218.3 L152.2,221.1 L153.6,223.1 L152.9,225.7 L153.9,234.1 L157.6,237.2 L162.3,238.3 L166.5,257.6 L178.0,258.5 L217.8,258.6 L217.8,276.0 L217.2,284.4 L217.3,296.8 L309.3,296.8 L310.2,300.6 L307.9,300.1 L310.6,302.3 L308.7,304.7 L312.0,305.0 L313.0,305.8 L313.7,308.3 L315.4,307.4 L313.6,309.0 L315.0,310.6 L316.3,312.8 L316.2,314.1 L318.2,314.3 L318.2,315.3 L317.1,316.4 L318.4,317.9 L318.1,318.7 L316.0,321.4 L316.3,321.9 L316.2,322.4 L315.8,323.0 L315.2,323.0 L314.5,323.3 L314.0,323.7 L313.9,324.0 L313.7,324.3 L313.4,324.6 L312.9,324.7 L312.4,325.0 L312.2,325.4 L311.7,325.5 L311.2,325.3 L310.5,324.8 L309.9,325.2 L309.5,325.6 L309.0,326.2 L308.6,326.7 L308.1,327.1 L307.8,327.6 L308.0,328.2 L308.0,328.7 L307.8,329.2 L307.2,329.2 L306.6,329.6 L306.2,330.1 L305.9,330.7 L305.6,331.2 L305.8,331.8 L305.7,332.5 L305.2,333.0 L304.4,333.1 L303.8,332.7 L303.4,332.3 L302.7,332.1 L302.0,332.2 L301.1,332.6 L300.7,333.4 L299.9,333.8 L299.4,334.4 L298.9,335.4 L298.1,335.8 L297.1,336.3 L296.3,337.1 L296.7,338.2 L296.7,339.0 L296.4,339.8 L295.7,340.4 L294.1,340.2 L292.7,340.0 L291.4,340.4 L291.1,341.5 L291.2,342.1 L290.5,342.3 L290.1,341.8 L289.9,340.8 L288.8,340.6 L287.3,340.6 L285.6,340.4 L284.0,340.6 L282.6,341.0 L282.0,341.8 L282.2,342.6 L282.0,343.5 L280.6,344.0 L279.9,345.1 L279.8,346.1 L279.4,346.7 L278.4,346.4 L277.2,346.5 L276.8,347.3 L277.2,348.0 L277.6,348.8 L278.6,349.1 L279.8,348.8 L280.5,348.7 L280.2,349.3 L279.2,349.9 L279.0,350.9 L278.3,352.1 L277.4,353.1 L276.5,353.9 L276.3,354.4 L276.3,355.6 L275.6,356.6 L275.4,357.6 L274.8,357.7 L273.9,357.6 L273.2,358.4 L272.2,359.0 L271.3,358.4 L270.6,358.8 L270.5,360.1 L269.3,360.9 L268.0,361.1 L267.8,361.9 L268.1,363.3 L266.7,364.1 L265.3,364.9 L264.7,365.7 L263.1,368.9 L263.4,370.2 L258.7,371.6 L258.9,373.2 L260.2,375.2 L257.6,375.3 L259.2,377.9 L258.2,379.7 L256.8,380.4 L253.3,381.5 L248.4,379.7 L250.1,381.3 L250.7,383.3 L249.3,385.6 L247.4,387.0 L246.9,388.8 L246.3,391.4 L244.7,391.8 L243.8,393.9 L242.8,394.9 L240.8,395.4 L238.4,396.2 L235.8,397.4 L232.0,397.2 L229.6,398.1 L227.4,397.0 L225.8,398.2 L222.3,399.5 L222.8,401.8 L220.0,400.7 L217.7,401.4 L217.2,402.9 L215.6,403.1 L210.2,404.4 L209.7,404.4 L141.8,404.5 L140.3,404.5 L128.6,404.5 L127.3,404.5 L107.9,404.5 L102.9,404.5 L98.0,404.5 L89.9,404.5 L73.6,404.5 L62.8,404.5 L26.3,404.6 L20.2,404.5 L20.1,398.0 L20.1,394.9 L20.1,392.2 L20.1,384.2 L20.1,383.5 L20.1,377.9 L20.1,374.5 L20.0,370.6 L20.0,368.5 L20.0,367.4 L20.0,366.4 Z",
    center: { x: 120, y: 280 },
    name: "District 2",
    region: "Western & Rural Utah",
  },
  "3": {
    path: "M173.6,155.9 L174.9,154.1 L175.3,152.8 L175.2,150.8 L174.7,148.1 L174.5,146.5 L174.4,144.5 L176.6,144.5 L177.1,143.8 L177.1,142.4 L177.2,141.2 L177.1,139.7 L178.6,139.7 L179.6,139.7 L182.0,139.7 L183.5,139.5 L184.8,138.0 L196.7,138.9 L197.1,139.5 L199.2,140.4 L200.7,140.0 L201.2,140.3 L202.6,140.0 L205.3,140.0 L206.1,140.0 L207.9,140.2 L208.1,136.0 L212.3,135.0 L210.5,130.7 L217.7,131.6 L219.4,131.0 L225.1,130.7 L227.7,129.9 L234.7,128.4 L238.9,128.4 L241.3,129.0 L244.9,127.2 L248.4,123.2 L248.5,117.4 L259.8,117.5 L272.3,117.5 L284.1,117.6 L294.0,117.6 L302.4,117.4 L310.7,117.4 L311.1,117.4 L321.5,117.4 L331.6,117.4 L334.4,117.4 L344.5,117.4 L364.9,117.2 L370.5,117.2 L379.5,129.7 L379.5,141.5 L379.5,144.6 L379.4,150.3 L379.3,153.5 L379.3,173.1 L379.3,176.1 L379.3,184.8 L379.3,198.0 L379.3,225.1 L379.3,234.6 L379.2,252.5 L379.1,265.0 L379.1,267.7 L379.1,269.9 L378.7,281.0 L378.6,296.8 L378.6,312.9 L379.9,320.9 L379.9,332.8 L379.9,334.6 L380.0,341.3 L380.0,344.1 L380.0,347.1 L380.0,351.4 L380.0,353.5 L379.9,359.7 L379.9,361.2 L379.9,366.4 L379.8,369.7 L379.7,378.7 L379.7,386.6 L379.7,389.4 L379.6,391.8 L379.7,396.5 L379.7,397.6 L379.7,399.2 L379.7,404.6 L366.2,404.6 L364.0,404.6 L363.5,404.6 L355.6,404.6 L338.0,404.7 L332.0,404.7 L311.1,404.7 L311.1,404.7 L277.6,404.7 L275.9,404.3 L268.1,404.3 L266.2,404.3 L234.5,404.4 L221.0,404.5 L214.8,404.5 L217.3,403.6 L219.1,401.6 L217.6,399.8 L221.7,403.0 L221.5,400.8 L223.6,400.5 L226.4,397.3 L228.3,397.9 L230.5,396.8 L234.3,396.9 L236.2,396.8 L240.0,396.5 L242.0,395.7 L242.5,393.8 L244.4,393.4 L246.4,392.0 L247.2,390.7 L248.2,388.2 L247.8,386.3 L248.4,383.9 L250.9,382.1 L248.8,381.0 L249.6,379.5 L255.3,381.4 L256.9,379.4 L258.3,378.8 L257.0,375.9 L259.5,375.8 L260.9,373.5 L257.6,372.0 L259.4,370.0 L265.2,369.5 L263.7,366.8 L264.8,365.6 L266.1,364.4 L267.7,363.9 L268.0,362.6 L267.7,361.5 L268.4,361.1 L270.1,360.6 L270.6,359.4 L270.8,358.5 L271.6,358.6 L272.9,358.9 L273.6,357.8 L274.5,357.4 L275.0,357.8 L275.4,357.2 L276.2,356.1 L276.3,354.9 L276.1,354.2 L276.9,353.7 L277.5,352.5 L278.9,351.6 L279.0,350.3 L279.8,349.5 L280.5,348.9 L280.2,348.6 L279.3,349.0 L278.1,349.2 L277.3,348.5 L277.1,347.5 L277.0,346.9 L277.7,346.5 L279.1,346.5 L279.8,346.4 L279.8,345.6 L280.1,344.4 L281.2,343.8 L282.2,343.0 L282.1,342.2 L282.0,341.5 L283.2,340.8 L284.8,340.5 L286.6,340.6 L288.0,340.6 L289.3,340.6 L290.0,341.4 L290.3,342.2 L290.9,342.3 L291.2,341.8 L291.1,341.0 L292.0,340.0 L293.2,340.1 L294.9,340.3 L296.2,340.2 L296.5,339.4 L296.9,338.6 L296.4,337.7 L296.6,336.6 L297.6,336.2 L298.5,335.6 L299.3,334.9 L299.6,333.9 L300.3,333.6 L300.9,333.0 L301.4,332.3 L302.4,332.1 L303.1,332.2 L303.6,332.5 L304.1,332.9 L304.7,333.1 L305.6,332.8 L305.8,332.2 L305.6,331.5 L305.8,331.0 L306.0,330.5 L306.3,329.8 L306.9,329.4 L307.5,329.2 L307.9,328.9 L308.0,328.5 L307.8,327.9 L308.0,327.3 L308.3,326.9 L308.8,326.5 L309.1,325.9 L309.6,325.4 L310.1,325.0 L311.1,325.1 L311.5,325.5 L312.0,325.5 L312.3,325.2 L312.7,324.8 L313.2,324.7 L313.7,324.5 L313.8,324.1 L314.0,323.8 L314.2,323.4 L314.9,323.1 L315.5,323.0 L316.1,322.7 L316.3,322.2 L316.3,321.8 L319.3,319.1 L319.2,317.8 L317.0,317.2 L319.1,316.2 L317.0,315.0 L317.7,313.3 L315.7,313.7 L314.7,311.6 L313.9,309.9 L314.8,308.5 L314.5,307.3 L312.0,307.0 L313.0,305.0 L311.0,306.1 L310.8,303.1 L309.2,300.6 L308.5,299.7 L310.9,298.1 L249.3,296.8 L217.3,296.1 L217.8,284.4 L217.9,259.6 L217.8,245.7 L217.7,227.3 L221.5,227.3 L221.5,210.3 L233.6,202.4 L249.5,196.3 L233.3,196.2 L230.8,193.1 L230.7,191.4 L229.0,190.0 L226.6,187.9 L224.6,185.5 L221.6,185.7 L222.3,184.1 L223.4,180.1 L223.1,177.0 L220.7,174.8 L220.3,171.7 L213.4,168.3 L207.4,168.2 L205.4,168.1 L200.3,170.3 L201.5,171.3 L203.2,173.7 L203.8,175.1 L200.1,178.1 L198.4,177.9 L197.3,177.1 L196.3,177.1 L195.4,177.5 L194.9,177.5 L186.8,177.6 L186.6,175.9 L187.4,175.6 L186.2,172.2 L186.2,172.1 L186.1,171.9 L186.2,171.8 L186.4,171.9 L186.5,171.6 L186.4,170.4 L184.8,169.0 L183.8,165.1 L181.7,164.4 L180.5,162.0 L179.6,161.4 L178.9,160.6 L176.5,159.1 L173.8,156.8 L173.6,155.9 Z",
    center: { x: 300, y: 260 },
    name: "District 3",
    region: "Central & Eastern Utah",
  },
  "4": {
    path: "M143.8,218.3 L149.1,212.2 L153.1,209.3 L159.2,206.5 L162.0,203.4 L162.1,200.6 L163.2,197.7 L161.6,195.3 L160.0,194.2 L159.6,191.0 L156.0,188.6 L155.1,186.2 L156.2,182.0 L154.8,179.6 L155.0,177.9 L156.4,176.0 L156.0,174.9 L155.3,173.3 L154.6,171.2 L154.0,168.1 L153.4,165.7 L153.5,163.2 L153.2,161.6 L152.4,158.0 L153.8,155.4 L155.1,155.2 L154.0,152.1 L154.3,148.7 L154.9,145.7 L153.8,144.0 L163.6,143.7 L164.9,143.7 L165.7,143.2 L165.7,142.1 L165.5,142.0 L165.5,141.9 L165.6,141.6 L165.7,141.1 L165.7,140.1 L167.1,140.1 L169.1,140.1 L170.5,140.1 L171.9,140.1 L173.1,139.8 L175.5,139.7 L176.7,139.7 L177.1,140.6 L177.2,141.5 L177.1,142.9 L177.1,144.4 L175.3,144.5 L174.2,145.2 L174.6,146.8 L174.6,148.1 L175.3,151.2 L175.3,153.2 L174.7,154.3 L173.7,156.6 L175.3,158.1 L176.9,159.3 L179.3,160.9 L180.5,162.0 L181.7,162.4 L182.7,164.8 L183.8,168.9 L185.2,169.6 L186.6,171.4 L186.5,171.7 L186.3,171.8 L186.2,171.8 L186.3,172.1 L186.3,172.2 L187.1,175.5 L187.7,176.2 L185.5,177.1 L192.8,177.5 L194.9,177.5 L196.2,177.1 L196.6,176.8 L198.0,177.3 L200.1,178.1 L203.9,177.1 L203.2,175.0 L202.6,172.3 L200.3,171.3 L202.7,168.6 L206.4,167.5 L212.4,167.7 L216.9,168.5 L219.7,173.1 L221.5,175.2 L222.7,178.5 L221.9,182.9 L221.4,185.1 L223.0,186.5 L225.1,186.8 L227.4,189.8 L230.0,191.2 L229.9,192.8 L233.3,193.1 L247.1,196.3 L249.5,202.5 L221.5,202.5 L221.5,219.1 L219.0,227.3 L217.7,232.9 L217.8,258.6 L178.0,258.5 L166.5,257.6 L162.3,238.3 L157.6,237.2 L153.9,234.1 L152.9,225.7 L153.6,223.1 L152.2,221.1 L143.8,218.3 Z",
    center: { x: 190, y: 195 },
    name: "District 4",
    region: "Salt Lake Suburbs",
  },
};

// Generic district visualization for other states (card-based grid)
const STATE_DISTRICTS = {
  AL: [
    { id: "1", name: "District 1", region: "Mobile & Southwest" },
    { id: "2", name: "District 2", region: "Dothan & Southeast" },
    { id: "3", name: "District 3", region: "East Alabama" },
    { id: "4", name: "District 4", region: "North Central" },
    { id: "5", name: "District 5", region: "Huntsville & North" },
    { id: "6", name: "District 6", region: "Birmingham Suburbs" },
    { id: "7", name: "District 7", region: "Birmingham & Black Belt" },
  ],
  AK: [{ id: "AL", name: "At-Large", region: "Statewide" }],
  AZ: [
    { id: "1", name: "District 1", region: "Northeast & Rural" },
    { id: "2", name: "District 2", region: "Southern Arizona" },
    { id: "3", name: "District 3", region: "West Phoenix" },
    { id: "4", name: "District 4", region: "North & West Phoenix" },
    { id: "5", name: "District 5", region: "East Valley" },
    { id: "6", name: "District 6", region: "Scottsdale & East" },
    { id: "7", name: "District 7", region: "South Phoenix" },
    { id: "8", name: "District 8", region: "Northwest Phoenix" },
    { id: "9", name: "District 9", region: "Central Phoenix" },
  ],
  UT: [
    { id: "1", name: "District 1", region: "Northern Utah" },
    { id: "2", name: "District 2", region: "Western & Rural Utah" },
    { id: "3", name: "District 3", region: "Central & Eastern Utah" },
    { id: "4", name: "District 4", region: "Salt Lake Suburbs" },
  ],
  SC: [
    { id: "1", name: "District 1", region: "Charleston & Coast" },
    { id: "2", name: "District 2", region: "Columbia & Midlands" },
    { id: "3", name: "District 3", region: "Upstate West" },
    { id: "4", name: "District 4", region: "Greenville-Spartanburg" },
    { id: "5", name: "District 5", region: "Rock Hill & North Central" },
    { id: "6", name: "District 6", region: "Pee Dee & Rural East" },
    { id: "7", name: "District 7", region: "Myrtle Beach & Northeast" },
  ],
  OK: [
    { id: "1", name: "District 1", region: "Tulsa Area" },
    { id: "2", name: "District 2", region: "Eastern Oklahoma" },
    { id: "3", name: "District 3", region: "Western Oklahoma" },
    { id: "4", name: "District 4", region: "South Central Oklahoma" },
    { id: "5", name: "District 5", region: "Oklahoma City Area" },
  ],
  // Add more states as needed...
};

const ArrowUpIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 17l9.2-9.2M17 17V7H7" />
  </svg>
);

const ArrowDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 7l-9.2 9.2M7 7v10h10" />
  </svg>
);

function getImpactColor(avgBenefit, maxBenefit) {
  if (avgBenefit === 0) return colors.gray[200];
  const intensity = Math.min(Math.abs(avgBenefit) / maxBenefit, 1);
  if (avgBenefit > 0) {
    // Teal scale for positive benefits
    if (intensity > 0.7) return colors.primary[500];
    if (intensity > 0.4) return colors.primary[400];
    return colors.primary[300];
  } else {
    // Red scale for negative benefits
    if (intensity > 0.7) return colors.red[500];
    if (intensity > 0.4) return colors.red[400];
    return colors.red[300];
  }
}

function getImpactHoverColor(avgBenefit, maxBenefit) {
  if (avgBenefit === 0) return colors.gray[300];
  const intensity = Math.min(Math.abs(avgBenefit) / maxBenefit, 1);
  if (avgBenefit > 0) {
    if (intensity > 0.7) return colors.primary[600];
    if (intensity > 0.4) return colors.primary[500];
    return colors.primary[400];
  } else {
    if (intensity > 0.7) return colors.red[600];
    if (intensity > 0.4) return colors.red[500];
    return colors.red[400];
  }
}

function UtahDistrictMap({ reformId }) {
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const { getImpact } = useData();
  const reformImpacts = getImpact(reformId);
  const hasDistrictData = reformImpacts?.districtImpacts;

  // Calculate max benefit for color scaling
  const maxBenefit = hasDistrictData
    ? Math.max(...Object.values(UTAH_DISTRICT_PATHS).map((_, idx) =>
        Math.abs(reformImpacts.districtImpacts[`UT-${idx + 1}`]?.avgBenefit || 0)
      ))
    : 150;

  const activeDistrict = selectedDistrict;
  const activeImpact = activeDistrict && hasDistrictData
    ? reformImpacts.districtImpacts[`UT-${activeDistrict}`]
    : null;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: spacing["2xl"],
      height: "100%",
    }}>
      {/* Map Container */}
      <div style={{
        backgroundColor: colors.background.secondary,
        borderRadius: spacing.radius.xl,
        border: `1px solid ${colors.border.light}`,
        padding: spacing.xl,
        display: "flex",
        flexDirection: "column",
      }}>
        <h4 style={{
          margin: `0 0 ${spacing.md}`,
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.body,
          color: colors.text.secondary,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          Utah Congressional Districts
        </h4>

        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "300px",
        }}>
          <svg
            viewBox="0 0 400 450"
            style={{
              width: "100%",
              maxWidth: "300px",
              height: "auto",
            }}
          >
            {/* District shapes - real geographic boundaries */}
            {Object.entries(UTAH_DISTRICT_PATHS).map(([districtId, data]) => {
              const impact = hasDistrictData
                ? reformImpacts.districtImpacts[`UT-${districtId}`]
                : null;
              const avgBenefit = impact?.avgBenefit || 0;
              const isSelected = selectedDistrict === districtId;

              const fillColor = isSelected
                ? getImpactHoverColor(avgBenefit, maxBenefit)
                : getImpactColor(avgBenefit, maxBenefit);

              return (
                <g key={districtId}>
                  <path
                    d={data.path}
                    fill={fillColor}
                    stroke={isSelected ? colors.primary[700] : colors.white}
                    strokeWidth={isSelected ? "4" : "2"}
                    style={{
                      cursor: "pointer",
                      transition: "fill 0.2s ease, stroke-width 0.2s ease",
                    }}
                    onClick={() => setSelectedDistrict(selectedDistrict === districtId ? null : districtId)}
                  />
                  {/* District label */}
                  <text
                    x={data.center.x}
                    y={data.center.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={colors.white}
                    fontSize="28"
                    fontWeight="700"
                    fontFamily={typography.fontFamily.primary}
                    style={{ pointerEvents: "none", textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
                  >
                    {districtId}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Legend */}
        <div style={{
          display: "flex",
          justifyContent: "center",
          gap: spacing.lg,
          marginTop: spacing.lg,
          paddingTop: spacing.md,
          borderTop: `1px solid ${colors.border.light}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: spacing.xs }}>
            <div style={{
              width: "12px",
              height: "12px",
              borderRadius: "2px",
              backgroundColor: colors.primary[400],
            }} />
            <span style={{
              fontSize: typography.fontSize.xs,
              fontFamily: typography.fontFamily.body,
              color: colors.text.secondary,
            }}>Gains</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: spacing.xs }}>
            <div style={{
              width: "12px",
              height: "12px",
              borderRadius: "2px",
              backgroundColor: colors.red[400],
            }} />
            <span style={{
              fontSize: typography.fontSize.xs,
              fontFamily: typography.fontFamily.body,
              color: colors.text.secondary,
            }}>Loses</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: spacing.xs }}>
            <div style={{
              width: "12px",
              height: "12px",
              borderRadius: "2px",
              backgroundColor: colors.gray[200],
            }} />
            <span style={{
              fontSize: typography.fontSize.xs,
              fontFamily: typography.fontFamily.body,
              color: colors.text.secondary,
            }}>No Change</span>
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing.lg,
      }}>
        {activeDistrict && activeImpact ? (
          <DistrictDetailCard
            districtId={activeDistrict}
            districtInfo={UTAH_DISTRICT_PATHS[activeDistrict]}
            impact={activeImpact}
            maxBenefit={maxBenefit}
          />
        ) : (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: spacing["2xl"],
            backgroundColor: colors.background.secondary,
            borderRadius: spacing.radius.xl,
            border: `1px dashed ${colors.border.medium}`,
          }}>
            <div style={{
              width: "48px",
              height: "48px",
              borderRadius: spacing.radius.full,
              backgroundColor: colors.primary[50],
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: spacing.md,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.primary[400]} strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
              </svg>
            </div>
            <p style={{
              margin: 0,
              color: colors.text.tertiary,
              fontSize: typography.fontSize.sm,
              fontFamily: typography.fontFamily.body,
              textAlign: "center",
            }}>
              Click on a district<br />to see detailed impact data
            </p>
          </div>
        )}

        {/* District Summary Cards */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: spacing.md,
        }}>
          {Object.entries(UTAH_DISTRICT_PATHS).map(([districtId, data]) => {
            const impact = hasDistrictData
              ? reformImpacts.districtImpacts[`UT-${districtId}`]
              : null;
            const avgBenefit = impact?.avgBenefit || 0;
            const isActive = activeDistrict === districtId;

            return (
              <button
                key={districtId}
                onClick={() => setSelectedDistrict(selectedDistrict === districtId ? null : districtId)}
                style={{
                  padding: spacing.md,
                  backgroundColor: isActive ? colors.primary[50] : colors.white,
                  borderRadius: spacing.radius.lg,
                  border: `1px solid ${isActive ? colors.primary[300] : colors.border.light}`,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: spacing.sm,
                  }}>
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "24px",
                      height: "24px",
                      borderRadius: spacing.radius.md,
                      backgroundColor: getImpactColor(avgBenefit, maxBenefit),
                      color: colors.white,
                      fontSize: typography.fontSize.xs,
                      fontWeight: typography.fontWeight.bold,
                      fontFamily: typography.fontFamily.primary,
                    }}>
                      {districtId}
                    </span>
                    <span style={{
                      fontSize: typography.fontSize.sm,
                      fontWeight: typography.fontWeight.medium,
                      fontFamily: typography.fontFamily.body,
                      color: colors.secondary[800],
                    }}>
                      {data.region}
                    </span>
                  </div>
                  <span style={{
                    fontSize: typography.fontSize.sm,
                    fontWeight: typography.fontWeight.bold,
                    fontFamily: typography.fontFamily.primary,
                    color: avgBenefit > 0 ? colors.primary[600] : (avgBenefit < 0 ? colors.red[600] : colors.gray[500]),
                  }}>
                    {avgBenefit > 0 ? "+" : ""}{avgBenefit === 0 ? "$0" : `$${Math.abs(avgBenefit)}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DistrictDetailCard({ districtId, districtInfo, impact, maxBenefit }) {
  const avgBenefit = impact?.avgBenefit || 0;
  const isPositive = avgBenefit > 0;
  const isNeutral = avgBenefit === 0;

  return (
    <div style={{
      padding: spacing.xl,
      backgroundColor: colors.white,
      borderRadius: spacing.radius.xl,
      border: `1px solid ${colors.border.light}`,
      boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.md,
        marginBottom: spacing.lg,
        paddingBottom: spacing.lg,
        borderBottom: `1px solid ${colors.border.light}`,
      }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "40px",
          height: "40px",
          borderRadius: spacing.radius.lg,
          backgroundColor: getImpactColor(avgBenefit, maxBenefit),
          color: colors.white,
          fontSize: typography.fontSize.lg,
          fontWeight: typography.fontWeight.bold,
          fontFamily: typography.fontFamily.primary,
        }}>
          {districtId}
        </span>
        <div>
          <h4 style={{
            margin: 0,
            fontSize: typography.fontSize.lg,
            fontWeight: typography.fontWeight.semibold,
            fontFamily: typography.fontFamily.primary,
            color: colors.secondary[900],
          }}>
            {districtInfo.name}
          </h4>
          <p style={{
            margin: `${spacing.xs} 0 0`,
            fontSize: typography.fontSize.sm,
            fontFamily: typography.fontFamily.body,
            color: colors.text.secondary,
          }}>
            {districtInfo.region}
          </p>
        </div>
      </div>

      {/* Impact Value */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.sm,
        marginBottom: spacing.lg,
      }}>
        <span style={{
          color: isNeutral ? colors.gray[500] : (isPositive ? colors.primary[600] : colors.red[600]),
        }}>
          {isNeutral ? null : (isPositive ? <ArrowUpIcon /> : <ArrowDownIcon />)}
        </span>
        <span style={{
          fontSize: typography.fontSize["3xl"],
          fontWeight: typography.fontWeight.bold,
          fontFamily: typography.fontFamily.primary,
          color: isNeutral ? colors.gray[600] : (isPositive ? colors.primary[700] : colors.red[700]),
        }}>
          {isPositive ? "+" : ""}{avgBenefit === 0 ? "$0" : `$${Math.abs(avgBenefit).toLocaleString()}`}
        </span>
        <span style={{
          fontSize: typography.fontSize.base,
          fontFamily: typography.fontFamily.body,
          color: colors.text.tertiary,
        }}>
          /household avg
        </span>
      </div>

      {/* Stats Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: spacing.sm,
      }}>
        {/* Winners / Losers unified */}
        <div style={{
          padding: spacing.sm,
          backgroundColor: colors.background.secondary,
          borderRadius: spacing.radius.lg,
          textAlign: "center",
        }}>
          <p style={{
            margin: 0,
            fontSize: "10px",
            fontFamily: typography.fontFamily.body,
            color: colors.text.tertiary,
            textTransform: "uppercase",
            letterSpacing: "0.3px",
          }}>
            Winners / Losers
          </p>
          <p style={{
            margin: `${spacing.xs} 0 0`,
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.bold,
            fontFamily: typography.fontFamily.primary,
          }}>
            <span style={{ color: colors.primary[600] }}>{impact.winnersShare ? `${(impact.winnersShare * 100).toFixed(0)}%` : "0%"}</span>
            <span style={{ color: colors.text.tertiary }}>{" / "}</span>
            <span style={{ color: colors.red[600] }}>{impact.losersShare ? `${(impact.losersShare * 100).toFixed(0)}%` : "0%"}</span>
          </p>
        </div>
        <StatBox
          label="Poverty"
          value={impact.povertyPctChange == null || impact.povertyPctChange === 0
            ? "No change"
            : `${impact.povertyPctChange > 0 ? "+" : ""}${impact.povertyPctChange.toFixed(1)}%`}
          color={impact.povertyPctChange < 0 ? colors.primary[600] : (impact.povertyPctChange > 0 ? colors.red[600] : colors.gray[500])}
        />
        <StatBox
          label="Child Poverty"
          value={impact.childPovertyPctChange == null || impact.childPovertyPctChange === 0
            ? "No change"
            : `${impact.childPovertyPctChange > 0 ? "+" : ""}${impact.childPovertyPctChange.toFixed(1)}%`}
          color={impact.childPovertyPctChange < 0 ? colors.primary[600] : (impact.childPovertyPctChange > 0 ? colors.red[600] : colors.gray[500])}
        />
      </div>
    </div>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div style={{
      padding: spacing.md,
      backgroundColor: colors.background.secondary,
      borderRadius: spacing.radius.lg,
      textAlign: "center",
    }}>
      <p style={{
        margin: 0,
        fontSize: typography.fontSize.xs,
        fontFamily: typography.fontFamily.body,
        color: colors.text.tertiary,
        textTransform: "uppercase",
        letterSpacing: "0.3px",
      }}>
        {label}
      </p>
      <p style={{
        margin: `${spacing.sm} 0 0`,
        fontSize: typography.fontSize.base,
        fontWeight: typography.fontWeight.bold,
        fontFamily: typography.fontFamily.primary,
        color: color || colors.secondary[800],
      }}>
        {value}
      </p>
    </div>
  );
}

// Fallback card-based view for states without SVG maps
function CardBasedDistrictView({ stateAbbr, reformId }) {
  const districts = STATE_DISTRICTS[stateAbbr];
  const { getImpact } = useData();
  const reformImpacts = getImpact(reformId);
  const hasDistrictData = reformImpacts?.districtImpacts;

  if (!districts) {
    return (
      <div style={{
        padding: spacing["2xl"],
        textAlign: "center",
        backgroundColor: colors.background.secondary,
        borderRadius: spacing.radius.xl,
        border: `1px dashed ${colors.border.medium}`,
      }}>
        <p style={{
          margin: 0,
          color: colors.text.tertiary,
          fontSize: typography.fontSize.sm,
          fontFamily: typography.fontFamily.body,
        }}>
          District data not available for this state
        </p>
      </div>
    );
  }

  const maxBenefit = hasDistrictData
    ? Math.max(...districts.map(d => Math.abs(reformImpacts.districtImpacts[`${stateAbbr}-${d.id}`]?.avgBenefit || 0)))
    : 100;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: spacing.lg,
    }}>
      {districts.map((district) => {
        const impact = hasDistrictData
          ? reformImpacts.districtImpacts[`${stateAbbr}-${district.id}`]
          : null;
        const avgBenefit = impact?.avgBenefit || 0;
        const isPositive = avgBenefit > 0;
        const barWidth = maxBenefit > 0 ? (Math.abs(avgBenefit) / maxBenefit) * 100 : 0;

        return (
          <div
            key={district.id}
            style={{
              padding: spacing.lg,
              backgroundColor: colors.white,
              borderRadius: spacing.radius.xl,
              border: `1px solid ${colors.border.light}`,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: spacing.sm,
              marginBottom: spacing.md,
            }}>
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "28px",
                height: "28px",
                borderRadius: spacing.radius.lg,
                backgroundColor: getImpactColor(avgBenefit, maxBenefit),
                color: colors.secondary[900],
                fontSize: typography.fontSize.sm,
                fontWeight: typography.fontWeight.bold,
                fontFamily: typography.fontFamily.primary,
              }}>
                {district.id}
              </span>
              <div>
                <span style={{
                  fontSize: typography.fontSize.base,
                  fontWeight: typography.fontWeight.semibold,
                  fontFamily: typography.fontFamily.primary,
                  color: colors.secondary[900],
                }}>
                  {district.name}
                </span>
                <p style={{
                  margin: 0,
                  fontSize: typography.fontSize.xs,
                  fontFamily: typography.fontFamily.body,
                  color: colors.text.tertiary,
                }}>
                  {district.region}
                </p>
              </div>
            </div>

            {impact ? (
              <>
                <div style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: spacing.xs,
                  marginBottom: spacing.sm,
                }}>
                  <span style={{
                    fontSize: typography.fontSize["2xl"],
                    fontWeight: typography.fontWeight.bold,
                    fontFamily: typography.fontFamily.primary,
                    color: avgBenefit === 0 ? colors.gray[600] : (isPositive ? colors.primary[700] : colors.red[700]),
                  }}>
                    {isPositive ? "+" : ""}{avgBenefit === 0 ? "$0" : `$${Math.abs(avgBenefit)}`}
                  </span>
                  <span style={{
                    fontSize: typography.fontSize.sm,
                    fontFamily: typography.fontFamily.body,
                    color: colors.text.tertiary,
                  }}>
                    /household
                  </span>
                </div>

                <div style={{
                  height: "6px",
                  backgroundColor: colors.gray[100],
                  borderRadius: "3px",
                  overflow: "hidden",
                }}>
                  <div style={{
                    width: `${barWidth}%`,
                    height: "100%",
                    backgroundColor: avgBenefit === 0 ? colors.gray[400] : (isPositive ? colors.primary[500] : colors.red[500]),
                    borderRadius: "3px",
                  }} />
                </div>
              </>
            ) : (
              <p style={{
                margin: 0,
                color: colors.text.tertiary,
                fontSize: typography.fontSize.sm,
                fontFamily: typography.fontFamily.body,
              }}>
                Data not yet computed
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// State center coordinates for map projection
const STATE_CENTERS = {
  "AL": [-86.9, 32.8], "AK": [-153.0, 64.0], "AZ": [-111.9, 34.2], "AR": [-92.4, 34.9],
  "CA": [-119.4, 37.2], "CO": [-105.5, 39.0], "CT": [-72.7, 41.6], "DE": [-75.5, 39.0],
  "FL": [-82.5, 28.5], "GA": [-83.5, 32.7], "HI": [-157.5, 20.5], "ID": [-114.7, 44.4],
  "IL": [-89.2, 40.0], "IN": [-86.3, 39.9], "IA": [-93.5, 42.0], "KS": [-98.4, 38.5],
  "KY": [-85.7, 37.8], "LA": [-91.9, 31.0], "ME": [-69.2, 45.3], "MD": [-76.8, 39.0],
  "MA": [-71.8, 42.3], "MI": [-85.6, 44.3], "MN": [-94.3, 46.3], "MS": [-89.7, 32.7],
  "MO": [-92.5, 38.4], "MT": [-109.6, 47.0], "NE": [-99.8, 41.5], "NV": [-116.6, 39.3],
  "NH": [-71.5, 43.7], "NJ": [-74.7, 40.1], "NM": [-106.0, 34.5], "NY": [-75.5, 43.0],
  "NC": [-79.4, 35.5], "ND": [-100.5, 47.4], "OH": [-82.8, 40.3], "OK": [-97.5, 35.5],
  "OR": [-120.5, 44.0], "PA": [-77.6, 40.9], "RI": [-71.5, 41.7], "SC": [-80.9, 33.9],
  "SD": [-100.2, 44.4], "TN": [-86.3, 35.8], "TX": [-99.3, 31.5], "UT": [-111.7, 39.3],
  "VT": [-72.7, 44.0], "VA": [-78.8, 37.5], "WA": [-120.5, 47.4], "WV": [-80.6, 38.9],
  "WI": [-89.8, 44.6], "WY": [-107.5, 43.0],
};

// State zoom levels
const STATE_ZOOMS = {
  "AK": 0.5, "TX": 2, "CA": 2, "MT": 2.5, "AZ": 3, "NM": 3, "NV": 3, "CO": 3,
  "OR": 3, "WY": 3, "KS": 3, "NE": 3, "SD": 3, "ND": 3, "OK": 3, "MN": 2.5,
  "IA": 3, "MO": 3, "AR": 3.5, "LA": 3.5, "WI": 3, "IL": 3, "MI": 2.5, "IN": 3.5,
  "OH": 3.5, "KY": 3.5, "TN": 3, "MS": 3.5, "AL": 3.5, "GA": 3, "FL": 2.5,
  "SC": 4, "NC": 3, "VA": 3, "WV": 4, "PA": 3.5, "NY": 2.5, "ME": 3, "VT": 5,
  "NH": 5, "MA": 5, "RI": 8, "CT": 6, "NJ": 5, "DE": 7, "MD": 5, "UT": 3.5,
  "ID": 3, "WA": 3, "HI": 3,
};

// District detail card for generic map - matches Utah style
function GenericDistrictDetailCard({ districtNum, impact, maxBenefit, stateName }) {
  const avgBenefit = impact?.avgBenefit || 0;
  const isPositive = avgBenefit > 0;
  const isNeutral = avgBenefit === 0;

  return (
    <div style={{
      padding: spacing.xl,
      backgroundColor: colors.white,
      borderRadius: spacing.radius.xl,
      border: `1px solid ${colors.border.light}`,
      boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.md,
        marginBottom: spacing.lg,
        paddingBottom: spacing.lg,
        borderBottom: `1px solid ${colors.border.light}`,
      }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "40px",
          height: "40px",
          borderRadius: spacing.radius.lg,
          backgroundColor: getImpactColor(avgBenefit, maxBenefit),
          color: colors.white,
          fontSize: typography.fontSize.lg,
          fontWeight: typography.fontWeight.bold,
          fontFamily: typography.fontFamily.primary,
        }}>
          {districtNum}
        </span>
        <div>
          <h4 style={{
            margin: 0,
            fontSize: typography.fontSize.lg,
            fontWeight: typography.fontWeight.semibold,
            fontFamily: typography.fontFamily.primary,
            color: colors.secondary[900],
          }}>
            Congressional District {districtNum}
          </h4>
          <p style={{
            margin: `${spacing.xs} 0 0`,
            fontSize: typography.fontSize.sm,
            fontFamily: typography.fontFamily.body,
            color: colors.text.secondary,
          }}>
            {stateName}
          </p>
        </div>
      </div>

      {/* Impact Value */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.sm,
        marginBottom: spacing.lg,
      }}>
        <span style={{
          color: isNeutral ? colors.gray[500] : (isPositive ? colors.primary[600] : colors.red[600]),
        }}>
          {isNeutral ? null : (isPositive ? <ArrowUpIcon /> : <ArrowDownIcon />)}
        </span>
        <span style={{
          fontSize: typography.fontSize["3xl"],
          fontWeight: typography.fontWeight.bold,
          fontFamily: typography.fontFamily.primary,
          color: isNeutral ? colors.gray[600] : (isPositive ? colors.primary[700] : colors.red[700]),
        }}>
          {isPositive ? "+" : ""}{avgBenefit === 0 ? "$0" : `$${Math.abs(avgBenefit).toLocaleString()}`}
        </span>
        <span style={{
          fontSize: typography.fontSize.base,
          fontFamily: typography.fontFamily.body,
          color: colors.text.tertiary,
        }}>
          /household avg
        </span>
      </div>

      {/* Stats Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: spacing.sm,
      }}>
        {/* Winners / Losers unified */}
        <div style={{
          padding: spacing.sm,
          backgroundColor: colors.background.secondary,
          borderRadius: spacing.radius.lg,
          textAlign: "center",
        }}>
          <p style={{
            margin: 0,
            fontSize: "10px",
            fontFamily: typography.fontFamily.body,
            color: colors.text.tertiary,
            textTransform: "uppercase",
            letterSpacing: "0.3px",
          }}>
            Winners / Losers
          </p>
          <p style={{
            margin: `${spacing.xs} 0 0`,
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.bold,
            fontFamily: typography.fontFamily.primary,
          }}>
            <span style={{ color: colors.primary[600] }}>{impact.winnersShare ? `${(impact.winnersShare * 100).toFixed(0)}%` : "0%"}</span>
            <span style={{ color: colors.text.tertiary }}>{" / "}</span>
            <span style={{ color: colors.red[600] }}>{impact.losersShare ? `${(impact.losersShare * 100).toFixed(0)}%` : "0%"}</span>
          </p>
        </div>
        <StatBox
          label="Poverty"
          value={impact.povertyPctChange == null || impact.povertyPctChange === 0
            ? "No change"
            : `${impact.povertyPctChange > 0 ? "+" : ""}${impact.povertyPctChange.toFixed(1)}%`}
          color={impact.povertyPctChange < 0 ? colors.primary[600] : (impact.povertyPctChange > 0 ? colors.red[600] : colors.gray[500])}
        />
        <StatBox
          label="Child Poverty"
          value={impact.childPovertyPctChange == null || impact.childPovertyPctChange === 0
            ? "No change"
            : `${impact.childPovertyPctChange > 0 ? "+" : ""}${impact.childPovertyPctChange.toFixed(1)}%`}
          color={impact.childPovertyPctChange < 0 ? colors.primary[600] : (impact.childPovertyPctChange > 0 ? colors.red[600] : colors.gray[500])}
        />
      </div>
    </div>
  );
}

// Generic state district map using react-simple-maps with ArcGIS GeoJSON
// Matches Utah map styling with district labels and same color scheme
function GenericStateDistrictMap({ stateAbbr, reformId, prefetchedGeoData }) {
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [geoData, setGeoData] = useState(prefetchedGeoData || null);
  const [loading, setLoading] = useState(!prefetchedGeoData);
  const [error, setError] = useState(null);
  const { getImpact } = useData();
  const reformImpacts = getImpact(reformId);
  const hasDistrictData = reformImpacts?.districtImpacts;

  // Use prefetched data if it arrives after mount
  useEffect(() => {
    if (prefetchedGeoData && !geoData) {
      setGeoData(prefetchedGeoData);
      setLoading(false);
    }
  }, [prefetchedGeoData]);

  // Only fetch if no prefetched data available
  useEffect(() => {
    if (prefetchedGeoData) return;
    let cancelled = false;

    const fetchDistricts = async () => {
      try {
        const res = await fetch(getCongressionalDistrictsUrl(stateAbbr));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (cancelled) return;

        if (data.features && data.features.length > 0) {
          setGeoData(data);
          setError(null);
        } else {
          setGeoData(null);
          setError("No districts found");
        }
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load congressional districts:", err);
        setGeoData(null);
        setError(err.message);
        setLoading(false);
      }
    };

    fetchDistricts();

    return () => { cancelled = true; };
  }, [stateAbbr, prefetchedGeoData]);

  // Calculate centroids for district labels
  const districtCentroids = useMemo(() => {
    if (!geoData) return {};
    const centroids = {};
    geoData.features.forEach(feature => {
      const props = feature.properties;
      // ArcGIS uses CDFIPS for district number (e.g., "01", "02")
      const districtFp = props.CDFIPS || props.CD118FP || props.CDFP;
      const districtNum = parseInt(districtFp, 10);
      const districtId = `${stateAbbr}-${districtNum || 1}`;
      const centroid = geoCentroid(feature);
      centroids[districtId] = {
        coords: centroid,
        num: districtNum === 0 ? "AL" : districtNum,
      };
    });
    return centroids;
  }, [geoData, stateAbbr]);

  // Calculate max benefit for color scaling
  const maxBenefit = useMemo(() => {
    if (!hasDistrictData) return 100;
    return Math.max(...Object.values(reformImpacts.districtImpacts).map(d => Math.abs(d?.avgBenefit || 0)), 1);
  }, [hasDistrictData, reformImpacts]);

  if (loading) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "300px",
        color: colors.text.secondary,
      }}>
        Loading map...
      </div>
    );
  }

  if (error || !geoData) {
    return <CardBasedDistrictView stateAbbr={stateAbbr} reformId={reformId} />;
  }

  // Parse district number from ArcGIS GeoJSON properties
  const getDistrictInfo = (geo) => {
    const props = geo.properties;
    if (!props) return null;
    // ArcGIS uses CDFIPS for district number (e.g., "01", "02")
    const districtFp = props.CDFIPS || props.CD118FP || props.CDFP;
    const districtNum = parseInt(districtFp, 10);
    return {
      districtId: `${stateAbbr}-${districtNum || 1}`,
      districtNum: districtNum === 0 ? "AL" : districtNum,
      name: props.NAMELSAD || props.NAME || `District ${districtNum}`,
    };
  };

  const getAvgBenefit = (districtId) => {
    if (!hasDistrictData) return 0;
    return reformImpacts.districtImpacts[districtId]?.avgBenefit || 0;
  };

  const activeDistrict = selectedDistrict;
  const activeImpact = activeDistrict && hasDistrictData
    ? reformImpacts.districtImpacts[activeDistrict]
    : null;

  const center = STATE_CENTERS[stateAbbr] || [-97, 38];
  const zoom = STATE_ZOOMS[stateAbbr] || 3;

  const stateName = {
    "OK": "Oklahoma", "UT": "Utah", "CA": "California", "NY": "New York",
    "TX": "Texas", "FL": "Florida", "GA": "Georgia", "NC": "North Carolina",
    "PA": "Pennsylvania", "OH": "Ohio", "MI": "Michigan", "IL": "Illinois",
  }[stateAbbr] || stateAbbr;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: spacing["2xl"],
      height: "100%",
    }}>
      {/* Map Container */}
      <div style={{
        backgroundColor: colors.background.secondary,
        borderRadius: spacing.radius.xl,
        border: `1px solid ${colors.border.light}`,
        padding: spacing.xl,
        display: "flex",
        flexDirection: "column",
      }}>
        <h4 style={{
          margin: `0 0 ${spacing.md}`,
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.body,
          color: colors.text.secondary,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          {stateName} Congressional Districts
        </h4>

        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "300px",
        }}>
          <ComposableMap
            projection="geoMercator"
            projectionConfig={{ scale: 800 }}
            style={{ width: "100%", height: "100%", maxHeight: "350px" }}
          >
            <ZoomableGroup center={center} zoom={zoom}>
              <Geographies geography={geoData}>
                {({ geographies }) =>
                  geographies.map(geo => {
                    const info = getDistrictInfo(geo);
                    if (!info) return null;

                    const avgBenefit = getAvgBenefit(info.districtId);
                    const isSelected = selectedDistrict === info.districtId;
                    const fillColor = isSelected
                      ? getImpactHoverColor(avgBenefit, maxBenefit)
                      : getImpactColor(avgBenefit, maxBenefit);

                    return (
                      <Geography
                        key={geo.rsmKey || info.districtId}
                        geography={geo}
                        onClick={() => setSelectedDistrict(
                          selectedDistrict === info.districtId ? null : info.districtId
                        )}
                        style={{
                          default: {
                            fill: fillColor,
                            stroke: isSelected ? colors.primary[700] : colors.white,
                            strokeWidth: isSelected ? 1 : 0.5,
                            outline: "none",
                            cursor: "pointer",
                            transition: "fill 0.2s ease",
                          },
                          hover: {
                            fill: getImpactHoverColor(avgBenefit, maxBenefit),
                            stroke: colors.primary[600],
                            strokeWidth: 0.8,
                            outline: "none",
                            cursor: "pointer",
                          },
                          pressed: {
                            fill: getImpactHoverColor(avgBenefit, maxBenefit),
                            stroke: colors.primary[700],
                            strokeWidth: 1,
                            outline: "none",
                          },
                        }}
                      />
                    );
                  })
                }
              </Geographies>
              {/* District Labels */}
              {Object.entries(districtCentroids).map(([districtId, data]) => (
                <Marker key={districtId} coordinates={data.coords}>
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{
                      fill: colors.white,
                      fontSize: "10px",
                      fontWeight: "700",
                      fontFamily: typography.fontFamily.primary,
                      pointerEvents: "none",
                      textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                    }}
                  >
                    {data.num}
                  </text>
                </Marker>
              ))}
            </ZoomableGroup>
          </ComposableMap>
        </div>

        {/* Legend */}
        <div style={{
          display: "flex",
          justifyContent: "center",
          gap: spacing.lg,
          marginTop: spacing.lg,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: spacing.xs }}>
            <div style={{
              width: "12px",
              height: "12px",
              borderRadius: "2px",
              backgroundColor: colors.primary[400],
            }} />
            <span style={{
              fontSize: typography.fontSize.xs,
              fontFamily: typography.fontFamily.body,
              color: colors.text.secondary,
            }}>
              Benefit
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: spacing.xs }}>
            <div style={{
              width: "12px",
              height: "12px",
              borderRadius: "2px",
              backgroundColor: colors.gray[200],
            }} />
            <span style={{
              fontSize: typography.fontSize.xs,
              fontFamily: typography.fontFamily.body,
              color: colors.text.secondary,
            }}>
              No change
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: spacing.xs }}>
            <div style={{
              width: "12px",
              height: "12px",
              borderRadius: "2px",
              backgroundColor: colors.red[400],
            }} />
            <span style={{
              fontSize: typography.fontSize.xs,
              fontFamily: typography.fontFamily.body,
              color: colors.text.secondary,
            }}>
              Cost
            </span>
          </div>
        </div>
      </div>

      {/* Detail Panel - matches Utah style */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing.lg,
      }}>
        {activeDistrict && activeImpact ? (
          <GenericDistrictDetailCard
            districtNum={activeDistrict.split("-")[1]}
            impact={activeImpact}
            maxBenefit={maxBenefit}
            stateName={stateName}
          />
        ) : (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: spacing["2xl"],
            backgroundColor: colors.background.secondary,
            borderRadius: spacing.radius.xl,
            border: `1px dashed ${colors.border.medium}`,
          }}>
            <div style={{
              width: "48px",
              height: "48px",
              borderRadius: spacing.radius.full,
              backgroundColor: colors.primary[50],
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: spacing.md,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={colors.primary[400]} strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
              </svg>
            </div>
            <p style={{
              margin: 0,
              color: colors.text.tertiary,
              fontSize: typography.fontSize.sm,
              fontFamily: typography.fontFamily.body,
              textAlign: "center",
            }}>
              Click on a district<br />to see detailed impact data
            </p>
          </div>
        )}

        {/* District Summary Cards */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: spacing.md,
        }}>
          {geoData?.features?.map((feature) => {
            const info = getDistrictInfo(feature);
            if (!info) return null;

            const impact = hasDistrictData
              ? reformImpacts.districtImpacts[info.districtId]
              : null;
            const avgBenefit = impact?.avgBenefit || 0;
            const isActive = activeDistrict === info.districtId;

            return (
              <button
                key={info.districtId}
                onClick={() => setSelectedDistrict(selectedDistrict === info.districtId ? null : info.districtId)}
                style={{
                  padding: spacing.md,
                  backgroundColor: isActive ? colors.primary[50] : colors.white,
                  borderRadius: spacing.radius.lg,
                  border: `1px solid ${isActive ? colors.primary[300] : colors.border.light}`,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: spacing.sm,
                  }}>
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "24px",
                      height: "24px",
                      borderRadius: spacing.radius.md,
                      backgroundColor: getImpactColor(avgBenefit, maxBenefit),
                      color: colors.white,
                      fontSize: typography.fontSize.xs,
                      fontWeight: typography.fontWeight.bold,
                      fontFamily: typography.fontFamily.primary,
                    }}>
                      {info.districtNum}
                    </span>
                    <span style={{
                      fontSize: typography.fontSize.sm,
                      fontWeight: typography.fontWeight.medium,
                      fontFamily: typography.fontFamily.body,
                      color: colors.secondary[800],
                    }}>
                      District {info.districtNum}
                    </span>
                  </div>
                  <span style={{
                    fontSize: typography.fontSize.sm,
                    fontWeight: typography.fontWeight.bold,
                    fontFamily: typography.fontFamily.primary,
                    color: avgBenefit > 0 ? colors.primary[600] : (avgBenefit < 0 ? colors.red[600] : colors.gray[500]),
                  }}>
                    {avgBenefit > 0 ? "+" : ""}{avgBenefit === 0 ? "$0" : `$${Math.abs(avgBenefit)}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function DistrictMap({ stateAbbr, reformId, prefetchedGeoData }) {
  // Use generic map for all states
  return (
    <div style={{ height: "100%" }}>
      <div style={{
        marginBottom: spacing.lg,
      }}>
        <h3 style={{
          margin: 0,
          fontSize: typography.fontSize.lg,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.primary,
          color: colors.secondary[900],
        }}>
          Impact by Congressional District
        </h3>
        <p style={{
          margin: `${spacing.xs} 0 0`,
          fontSize: typography.fontSize.sm,
          fontFamily: typography.fontFamily.body,
          color: colors.text.secondary,
        }}>
          Click on a district to see detailed impact analysis
        </p>
      </div>
      <GenericStateDistrictMap stateAbbr={stateAbbr} reformId={reformId} prefetchedGeoData={prefetchedGeoData} />
    </div>
  );
}
