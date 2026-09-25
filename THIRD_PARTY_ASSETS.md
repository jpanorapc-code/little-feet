# Third-Party Assets

## Penguin Swimming motion reference

- **Asset:** Penguin Swimming
- **Creator:** Riley / rkuhlf
- **Source:** https://sketchfab.com/3d-models/penguin-swimming-855d54f1e67a4564aac7871b30ef687d
- **License:** Creative Commons Attribution (CC BY)
- **Little Feet use:** The user supplied the Blender asset. Little Feet currently extracts and maps the authored swim motion onto the Little Feet procedural mascot. A compact extracted rig/mesh package is retained on the cinematic test branch for possible future migration to a fully skinned model.
- **Modification:** Motion data is adapted to the Little Feet mascot rig and blended with Little Feet's scroll, steering, gaze, station, and dive behavior.

This attribution file must remain with any production build that uses the Riley-derived animation or extracted rig data.


## Cinematic 2D photo textures

The moving 2D sea-life layers use photographic sources from Wikimedia Commons. Fish schools are displayed as softly feathered photographic layers rather than cartoon SVG fish silhouettes. Jellyfish and manta still use lightweight local silhouette masks around photographic texture. These are image-only requests; the WebGL scene does not fetch or execute third-party code.

- Dense sardine school photograph: Stanislav Stelmakhovich, "Underwater view of the sardine run as a dolphin hunts within dense schools of sardines.jpg", CC0 1.0 / public-domain dedication via Wikimedia Commons.
  Source: https://commons.wikimedia.org/wiki/File:Underwater_view_of_the_sardine_run_as_a_dolphin_hunts_within_dense_schools_of_sardines.jpg
- Secondary fish school photograph: Milada Vigerova, "Fish school (Unsplash).jpg", CC0 1.0 / public-domain dedication via Wikimedia Commons.
  Source: https://commons.wikimedia.org/wiki/File:Fish_school_(Unsplash).jpg
- Jellyfish photograph: ErgoSum88, "Jellyfish01.jpg", released into the public domain via Wikimedia Commons.
  Source: https://commons.wikimedia.org/wiki/File:Jellyfish01.jpg
- Manta ray photograph: Richard Harvey, "P2140268 Manta Ray.jpg", released into the public domain via Wikimedia Commons.
  Source: https://commons.wikimedia.org/wiki/File:P2140268_Manta_Ray.jpg

The files are displayed as moving 2D photographic layers to avoid restoring the former expensive 3D animal simulation. Fish photos use only a soft edge-feather mask; they are not clipped into synthetic fish shapes.
