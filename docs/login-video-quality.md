# Login presentation update

Based on main c853f79. The user recording is 1920x1080 H.264 in a WebM container; it is not native 4K. Existing HQ restoration also produces 1920x1080. Compression artefacts already in the supplied recording cannot be recovered by upscaling.

The new video is encoded directly from the supplied recording at 24 fps, H.264 CRF 18, yuv420p, fast-start, without audio. The lettering area (650,335; 700x160 at 1080p) is restored from the original clean Wallpaper Engine landscape with a 22-pixel feather. This small region is static; surrounding original motion is retained. No CSS cover-up depends on the card or screen dimensions.

A matching clean poster is used for reduced motion. Removed login card backdrop blur and removed full-video service-worker precaching to avoid the second mismatched-version download. High-quality encoding increases transfer size; metadata preload and fast-start allow playback before the full file downloads.

Local Edge playback sample: 128 frames, zero dropped. This is a short local measurement, not proof for every device/network. Responsive test: 1288 checks across 14 viewports. Pause and reduced-motion checks passed. Desktop/mobile screenshots reviewed. Native 4K detail requires a new native 3840x2160 recording.
