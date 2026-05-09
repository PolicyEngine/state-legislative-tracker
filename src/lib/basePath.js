// Resolved at runtime in the browser. Returns '' during SSR/build so the
// import does not throw on `window` access.
export const BASE_PATH =
  typeof window !== 'undefined' &&
  window.location.pathname.startsWith('/us/state-legislative-tracker')
    ? '/us/state-legislative-tracker'
    : '';
