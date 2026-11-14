# Who wrote what

| Source | Licence | How it is used here |
|---|---|---|
| `inmusic-software/mpc-plugin-builder-sdk` (`tools/gen_ui.py`, `tools/make_ui_kit.py`, `docs/ui-reference.md`) | MIT, © inMusic Brands, Inc. | `src/core/uiBuilder.ts` and `src/core/uiKit.ts` are TypeScript ports, gated against the SDK's own output. The UI reference defines every component shape emitted |
| Skin Studio v1 (`open-mpc/mpc-vst-plugins`, `tools/studio.py`, `skin_check.py`, `skin_assets.py`) | MIT | the skin checker, looks and layout knowledge are ported |

Nothing of Akai's firmware or stock skin art is in this repository, and none may be added. The kit pictures are drawn at
run time by the ported kit renderer.
