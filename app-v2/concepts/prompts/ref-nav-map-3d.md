# ref-nav-map-3d  (widget/overlay)
Reference: refs/ref-nav-map-3d.png

## Purpose
Visual target for the INTERACTIVE 3D navigation map (Waze / Google-Maps style): a follow-camera 3D view of the track
that auto-centers on the car, rotates with heading, supports live zoom + manual pan/zoom/rotate. Built with
Three.js / @react-three/fiber (both already in package.json), with the existing 2D SVG track map as the SSR/test fallback.

## American-English prompt (validated)
A clean INTERACTIVE 3D navigation map for sim racing, Waze / Google-Maps navigation aesthetic, three-quarter chase
camera looking down the track ahead: a smooth dark asphalt racing-circuit ribbon winding into the distance with soft
emissive cyan edge lines, upcoming corners curving away, subtle grid ground plane fading to a dark horizon. The
player's car is a single bright cyan chevron / arrow marker at the lower-center, heading up the track. A few rival cars
appear as small colored dots on the ribbon ahead and behind. Minimal, uncluttered: no big panels, no titles; only a
tiny upcoming-corner marker. Dark navy-black background, emissive neon-on-dark motorsport nav look, crisp, high
contrast, depth fog. Front-lit 3D, realistic perspective. US English only.

## Checklist notes
- Subject: 3D follow-cam nav map (track ribbon receding to horizon) with ego chevron + rival dots.
- Data/values: player heading marker centered, upcoming corner, nearby cars as dots.
- Layout/sizing: single perspective 3D scene, car at lower-center, track receding upward.
- Theme: Waze/Google-Maps-style navigation, motorsport neon-on-dark.
- Color rules: cyan = ego + track edges; rival dots colored; red = closest.
- AVOID (app output): no titles/panels, minimal chrome, dark (near-transparent) bg, no clutter/clipping.
- Tech: interactive (auto-follow + rotate-with-heading + zoom/pan) Three.js; SVG map = SSR/test fallback.

## QA outcome
- Image QA: pass — perspective track ribbon receding to horizon, cyan ego chevron at lower-center, rival dots
  (red = closest), minimal turn/corner marker, neon-on-dark minimal chrome. Strong visual target for the 3D build.
- Build QA vs ref: pending (v4-map3d-nav agent).
