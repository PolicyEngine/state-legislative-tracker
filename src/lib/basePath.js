// Resolved at runtime in the browser. Returns '' during SSR/build so the
// import does not throw on `window` access.
// Canonical mount is /us/bill-tracker; the old /us/state-legislative-tracker
// path 308-redirects there on policyengine.org but is kept here so any
// cached or in-flight page under the old prefix still routes correctly.
const MOUNT_PREFIXES = ['/us/bill-tracker', '/us/state-legislative-tracker'];

export const BASE_PATH =
  (typeof window !== 'undefined' &&
    MOUNT_PREFIXES.find((prefix) =>
      window.location.pathname.startsWith(prefix),
    )) ||
  '';
