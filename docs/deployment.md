# Deployment

This guide covers practical ways to ship Heavy Water more safely and run it better on Replit and beyond.

## Goals

- Faster initial load
- Fewer runtime crashes
- Better observability after release
- Safer rollout of game changes

## Recommended deployment stack

### 1. Asset delivery

Use compressed static assets and cache them aggressively.

- Prefer optimized textures, models, and audio
- Keep large art in `client/public/` only when it must be served directly
- Compress images before checking them in
- Avoid shipping unused assets

### 2. Error monitoring

Add **Sentry** for frontend and backend error tracking.

Use it for:
- JS runtime errors
- unhandled promise rejections
- API failures
- performance traces on slow scenes or startup

Why it helps:
- Faster crash diagnosis
- Stack traces from real players
- Better visibility into device-specific issues

### 3. Product analytics

Add **PostHog** for lightweight game analytics.

Track:
- tutorial completion
- shop usage
- upgrade conversions
- session length
- drop-off points

Why it helps:
- See where players quit
- Measure balance changes
- Validate new content

### 4. Feature flags

Use **LaunchDarkly** or a simple database-backed flag system for risky features.

Good flag candidates:
- new enemy types
- balance changes
- UI experiments
- new progression rewards

Why it helps:
- Roll out safely
- Disable a broken feature without redeploying

### 5. CDN / edge caching

If you move off Replit for production hosting, put static content behind a CDN such as Cloudflare.

Use it for:
- textures
- sound files
- large bundles
- cache-control headers

### 6. Performance monitoring

Watch for:
- slow scene initialization
- expensive post-processing
- too many active meshes
- excessive HMR/dev-only code in production builds

Useful signals:
- frame time spikes
- memory growth
- long task warnings

## Replit-specific tips

- Keep production builds lean
- Remove debug logging before release
- Avoid loading unnecessary systems on startup
- Use persistent environment variables for secrets
- Verify `npm run check` before deployment

## Suggested third-party integrations

Best overall set for this game:

- **Sentry** — crashes and performance
- **PostHog** — analytics and funnels
- **Cloudflare** — CDN, caching, basic protection
- **LaunchDarkly** — feature flags, if you want controlled rollout

## Final release checklist

- `npm run check` passes
- no console errors in the browser
- no server errors in logs
- assets load correctly in production mode
- controller navigation works in all menus
- save/load still round-trips cleanly

## Notes

Keep this document updated as deployment practices change.
