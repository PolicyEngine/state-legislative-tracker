import posthog from 'posthog-js'

export const track = (event, properties) => posthog.capture(event, properties)
