# Third-Party Assets

## Penguin Swimming motion reference

- **Asset:** Penguin Swimming
- **Creator:** Riley / rkuhlf
- **Source:** https://sketchfab.com/3d-models/penguin-swimming-855d54f1e67a4564aac7871b30ef687d
- **License:** Creative Commons Attribution (CC BY)
- **Little Feet use:** The user supplied the Blender asset. Little Feet currently extracts and maps the authored swim motion onto the Little Feet procedural mascot. A compact extracted rig/mesh package is retained on the cinematic test branch for possible future migration to a fully skinned model.
- **Modification:** Motion data is adapted to the Little Feet mascot rig and blended with Little Feet's scroll, steering, gaze, station, and dive behavior.

This attribution file must remain with any production build that uses the Riley-derived animation or extracted rig data.


## Cinematic 2D sea-life assets

The moving background sea life remains lightweight 2D. Fish schools are now built from individual transparent fish sprites so every fish has a real silhouette and empty water remains genuinely transparent between animals.

- Fish sprite: Ellicrum derivative based on an original image by OptimusPrimeBot, "Alosa alosa.png" (Allis shad on transparent background).
  Source: https://commons.wikimedia.org/wiki/File:Alosa_alosa.png
  License: Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0).
  Little Feet use: the transparent fish is displayed repeatedly at different sizes, positions and slight rotations inside the cinematic school layers. The source pixels are not painted into a rectangular water photograph.
- Jellyfish photograph: ErgoSum88, "Jellyfish01.jpg", released into the public domain via Wikimedia Commons.
  Source: https://commons.wikimedia.org/wiki/File:Jellyfish01.jpg
- Manta ray photograph: Richard Harvey, "P2140268 Manta Ray.jpg", released into the public domain via Wikimedia Commons.
  Source: https://commons.wikimedia.org/wiki/File:P2140268_Manta_Ray.jpg

This keeps the fish visually individual while avoiding a 3D fish simulation or per-frame WebGL geometry work.
